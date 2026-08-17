import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { Course, StudySession, Task, UpdateTaskInput } from './types';
import { countPages, formatPageRanges, parsePageRanges, subtractPages } from './pageRanges';
import { canonicalPageRanges, courseReadingPace, readingMetrics, taskOriginalRanges, taskRemainingRanges } from './reading';
import {
  deleteTask,
  ensureSchema,
  getSettings,
  listCourses,
  listScheduleBlocks,
  listSessions,
  listTasks,
  replaceAllScheduleBlocks,
  updateTask,
} from './storage';

export type WorkflowState = 'not-started' | 'in-progress' | 'done' | 'canceled';
export type DisplayState = WorkflowState | 'blocked';

export type ChecklistItem = {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
};

export type ScheduleBlockV2 = {
  id: string;
  taskId: string;
  day: string;
  plannedMinutes: number;
  guessed?: boolean;
  title: string;
  course: string;
  pages?: number | null;
  priority?: number | null;
  catchup?: boolean;
};

type CompletionSnapshot = {
  capturedAt: string;
  workflowState: WorkflowState;
  task: {
    status: Task['status'];
    remainingPageRanges: string | null;
    originalPageRanges: string | null;
    estimatedMinutes: number | null;
    actualMinutes: number | null;
    completedAt: string | null;
    focus: number | null;
  };
  schedule: ScheduleBlockV2[];
};

export type TaskV2Meta = {
  taskId: string;
  workflowState: WorkflowState;
  deletedAt: string | null;
  deletedSchedule: ScheduleBlockV2[];
  canceledSchedule: ScheduleBlockV2[];
  blockedSchedule: ScheduleBlockV2[];
  completionSnapshot: CompletionSnapshot | null;
  checklist: ChecklistItem[];
};

export type TaskWorkspaceItem = Task & {
  workflowState: WorkflowState;
  displayState: DisplayState;
  blocked: boolean;
  blockedBy: Array<{ id: string; title: string }>;
  checklist: ChecklistItem[];
  checklistPercent: number;
  loggedMinutes: number;
  remainingMinutes: number;
  percentComplete: number;
  scheduledMinutes: number;
  scheduleBlocks: ScheduleBlockV2[];
  sessionCount: number;
  averageFocus: number | null;
  atRisk: boolean;
  atRiskReason: string | null;
  reading: ReturnType<typeof readingMetrics> | null;
};

function resolveDbUrl(): string | null {
  const direct = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING
    || null;
  if (direct) return direct;
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env as Record<string, string | undefined>;
  if (PGHOST && PGUSER && PGPASSWORD && PGDATABASE) {
    const port = PGPORT ? `:${PGPORT}` : '';
    return `postgres://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}${port}/${PGDATABASE}?sslmode=require`;
  }
  return null;
}

const DB_URL = resolveDbUrl();
let pool: Pool | null = null;
let metaSchemaReady: Promise<void> | null = null;
const fallbackMeta = new Map<string, TaskV2Meta>();

function getPool(): Pool {
  if (!DB_URL) throw new Error('No DATABASE_URL');
  if (!pool) pool = new Pool({ connectionString: DB_URL, ssl: DB_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  return pool;
}

function emptyMeta(taskId: string): TaskV2Meta {
  return {
    taskId,
    workflowState: 'not-started',
    deletedAt: null,
    deletedSchedule: [],
    canceledSchedule: [],
    blockedSchedule: [],
    completionSnapshot: null,
    checklist: [],
  };
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function rowToMeta(row: any): TaskV2Meta {
  return {
    taskId: String(row.task_id),
    workflowState: (['not-started', 'in-progress', 'done', 'canceled'].includes(row.workflow_state) ? row.workflow_state : 'not-started') as WorkflowState,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    deletedSchedule: safeArray<ScheduleBlockV2>(row.deleted_schedule),
    canceledSchedule: safeArray<ScheduleBlockV2>(row.canceled_schedule),
    blockedSchedule: safeArray<ScheduleBlockV2>(row.blocked_schedule),
    completionSnapshot: row.completion_snapshot && typeof row.completion_snapshot === 'object' ? row.completion_snapshot as CompletionSnapshot : null,
    checklist: safeArray<ChecklistItem>(row.checklist),
  };
}

export async function ensureTaskV2Schema(): Promise<void> {
  await ensureSchema();
  if (!DB_URL) return;
  if (!metaSchemaReady) {
    metaSchemaReady = (async () => {
      const p = getPool();
      await p.query(`CREATE TABLE IF NOT EXISTS task_v2_meta (
        task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        workflow_state text NOT NULL DEFAULT 'not-started',
        deleted_at timestamptz,
        deleted_schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
        canceled_schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
        blocked_schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
        completion_snapshot jsonb,
        checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await p.query(`CREATE INDEX IF NOT EXISTS task_v2_meta_deleted_idx ON task_v2_meta (deleted_at)`);
    })().catch(error => {
      metaSchemaReady = null;
      throw error;
    });
  }
  await metaSchemaReady;
}

async function getMetaMap(taskIds?: string[]): Promise<Map<string, TaskV2Meta>> {
  await ensureTaskV2Schema();
  if (!DB_URL) {
    const out = new Map<string, TaskV2Meta>();
    const ids = taskIds || Array.from(fallbackMeta.keys());
    for (const id of ids) if (fallbackMeta.has(id)) out.set(id, fallbackMeta.get(id)!);
    return out;
  }
  if (taskIds && taskIds.length === 0) return new Map();
  const p = getPool();
  const res = taskIds
    ? await p.query(`SELECT task_id, workflow_state, deleted_at, deleted_schedule, canceled_schedule, blocked_schedule, completion_snapshot, checklist FROM task_v2_meta WHERE task_id = ANY($1::uuid[])`, [taskIds])
    : await p.query(`SELECT task_id, workflow_state, deleted_at, deleted_schedule, canceled_schedule, blocked_schedule, completion_snapshot, checklist FROM task_v2_meta`);
  return new Map(res.rows.map((row: any) => [String(row.task_id), rowToMeta(row)]));
}

export async function getTaskMeta(taskId: string): Promise<TaskV2Meta> {
  const map = await getMetaMap([taskId]);
  return map.get(taskId) || emptyMeta(taskId);
}

export async function saveTaskMeta(taskId: string, patch: Partial<Omit<TaskV2Meta, 'taskId'>>): Promise<TaskV2Meta> {
  const current = await getTaskMeta(taskId);
  const next: TaskV2Meta = {
    ...current,
    ...patch,
    taskId,
    checklist: patch.checklist !== undefined ? patch.checklist : current.checklist,
    deletedSchedule: patch.deletedSchedule !== undefined ? patch.deletedSchedule : current.deletedSchedule,
    canceledSchedule: patch.canceledSchedule !== undefined ? patch.canceledSchedule : current.canceledSchedule,
    blockedSchedule: patch.blockedSchedule !== undefined ? patch.blockedSchedule : current.blockedSchedule,
  };
  if (!DB_URL) {
    fallbackMeta.set(taskId, next);
    return next;
  }
  await ensureTaskV2Schema();
  const p = getPool();
  const res = await p.query(
    `INSERT INTO task_v2_meta (task_id, workflow_state, deleted_at, deleted_schedule, canceled_schedule, blocked_schedule, completion_snapshot, checklist, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,NOW())
     ON CONFLICT (task_id) DO UPDATE SET
       workflow_state=EXCLUDED.workflow_state,
       deleted_at=EXCLUDED.deleted_at,
       deleted_schedule=EXCLUDED.deleted_schedule,
       canceled_schedule=EXCLUDED.canceled_schedule,
       blocked_schedule=EXCLUDED.blocked_schedule,
       completion_snapshot=EXCLUDED.completion_snapshot,
       checklist=EXCLUDED.checklist,
       updated_at=NOW()
     RETURNING task_id, workflow_state, deleted_at, deleted_schedule, canceled_schedule, blocked_schedule, completion_snapshot, checklist`,
    [
      taskId,
      next.workflowState,
      next.deletedAt ? new Date(next.deletedAt) : null,
      JSON.stringify(next.deletedSchedule || []),
      JSON.stringify(next.canceledSchedule || []),
      JSON.stringify(next.blockedSchedule || []),
      next.completionSnapshot ? JSON.stringify(next.completionSnapshot) : null,
      JSON.stringify(next.checklist || []),
    ],
  );
  return rowToMeta(res.rows[0]);
}

function sessionsFor(taskId: string, sessions: StudySession[]): StudySession[] {
  return sessions.filter(session => String(session.taskId || '') === String(taskId));
}

function taskDone(task: Task, meta?: TaskV2Meta): boolean {
  return task.status === 'done' || meta?.workflowState === 'done';
}

function blockersFor(task: Task, taskMap: Map<string, Task>, metaMap: Map<string, TaskV2Meta>): Array<{ id: string; title: string }> {
  const deps = safeArray<string>(task.dependsOn);
  const blockers: Array<{ id: string; title: string }> = [];
  for (const id of deps) {
    const dep = taskMap.get(String(id));
    const meta = metaMap.get(String(id));
    if (!dep || meta?.deletedAt || !taskDone(dep, meta)) blockers.push({ id: String(id), title: dep?.title || 'Missing prerequisite' });
  }
  return blockers;
}

export async function listVisibleTasks(options?: { includeCanceled?: boolean; includeBlocked?: boolean; overridePool?: Pool }): Promise<Task[]> {
  await ensureTaskV2Schema();
  const tasks = await listTasks(options?.overridePool);
  const metaMap = await getMetaMap(tasks.map(task => String(task.id)));
  const taskMap = new Map(tasks.map(task => [String(task.id), task]));
  return tasks.filter(task => {
    const meta = metaMap.get(String(task.id));
    if (meta?.deletedAt) return false;
    if (!options?.includeCanceled && meta?.workflowState === 'canceled') return false;
    if (!options?.includeBlocked && blockersFor(task, taskMap, metaMap).length > 0 && !taskDone(task, meta)) return false;
    return true;
  });
}

function checklistPercent(items: ChecklistItem[]): number {
  if (!items.length) return 0;
  return Math.round((items.filter(item => item.done).length / items.length) * 100);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function atRiskFor(task: Task, blocked: boolean, blockers: Array<{ id: string; title: string }>, remainingMinutes: number, blocks: ScheduleBlockV2[], availability: Record<string, number>): { atRisk: boolean; reason: string | null } {
  if (task.status === 'done' || remainingMinutes <= 0) return { atRisk: false, reason: null };
  const now = new Date();
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return { atRisk: false, reason: null };
  if (due.getTime() < now.getTime()) return { atRisk: true, reason: 'Overdue' };
  if (blocked) return { atRisk: true, reason: `Blocked by ${blockers.map(item => item.title).join(', ')}` };
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(due); end.setHours(23, 59, 59, 999);
  let available = 0;
  for (let i = 0; i < 60; i++) {
    const day = new Date(start); day.setDate(start.getDate() + i);
    if (day > end) break;
    const key = dateKey(day);
    const configured = Number((availability as any)[day.getDay()]);
    const cap = Number.isFinite(configured) && configured >= 0 ? configured : (day.getDay() === 0 || day.getDay() === 6 ? 90 : 150);
    const usedOther = blocks
      .filter(block => block.day === key && String(block.taskId) !== String(task.id))
      .reduce((sum, block) => sum + Math.max(0, Number(block.plannedMinutes) || 0), 0);
    available += Math.max(0, cap - usedOther);
  }
  if (remainingMinutes > available) return { atRisk: true, reason: `Needs ${remainingMinutes} min; about ${available} min is available before the deadline` };
  return { atRisk: false, reason: null };
}

export async function getTaskWorkspace(): Promise<{ tasks: TaskWorkspaceItem[]; trash: Array<Task & { deletedAt: string }>; summary: Record<string, number> }> {
  await ensureTaskV2Schema();
  const [tasks, sessions, courses, blocks, settings] = await Promise.all([
    listTasks(), listSessions(), listCourses(), listScheduleBlocks(), getSettings(['availabilityTemplateV1']),
  ]);
  const metaMap = await getMetaMap(tasks.map(task => String(task.id)));
  const taskMap = new Map(tasks.map(task => [String(task.id), task]));
  const availability = settings?.availabilityTemplateV1 && typeof settings.availabilityTemplateV1 === 'object'
    ? settings.availabilityTemplateV1 as Record<string, number>
    : {};
  const active: TaskWorkspaceItem[] = [];
  const trash: Array<Task & { deletedAt: string }> = [];
  for (const task of tasks) {
    const meta = metaMap.get(String(task.id)) || emptyMeta(String(task.id));
    if (meta.deletedAt) {
      trash.push({ ...task, deletedAt: meta.deletedAt });
      continue;
    }
    const ownSessions = sessionsFor(task.id, sessions);
    const blockers = blockersFor(task, taskMap, metaMap);
    const blocked = blockers.length > 0 && !taskDone(task, meta) && meta.workflowState !== 'canceled';
    const workflowState: WorkflowState = meta.workflowState === 'canceled'
      ? 'canceled'
      : task.status === 'done'
        ? 'done'
        : meta.workflowState === 'in-progress' || ownSessions.length > 0
          ? 'in-progress'
          : 'not-started';
    const displayState: DisplayState = blocked ? 'blocked' : workflowState;
    const reading = task.activity === 'reading' || task.originalPageRanges || task.remainingPageRanges
      ? readingMetrics(task, sessions, courses)
      : null;
    const loggedMinutes = ownSessions.reduce((sum, session) => sum + Math.max(0, Number(session.minutes) || 0), 0);
    const remainingMinutes = workflowState === 'done' || workflowState === 'canceled'
      ? 0
      : reading?.estimatedMinutesRemaining ?? Math.max(0, Number(task.estimatedMinutes) || 0);
    const checklist = safeArray<ChecklistItem>(meta.checklist);
    const checklistPct = checklistPercent(checklist);
    const percentComplete = reading
      ? reading.percentComplete
      : workflowState === 'done'
        ? 100
        : checklist.length
          ? checklistPct
          : loggedMinutes > 0
            ? Math.max(1, Math.min(99, Math.round((loggedMinutes / Math.max(1, loggedMinutes + remainingMinutes)) * 100)))
            : 0;
    const ownBlocks = (blocks as ScheduleBlockV2[]).filter(block => String(block.taskId) === String(task.id));
    const scored = ownSessions.filter(session => typeof session.focus === 'number');
    const averageFocus = scored.length ? Math.round((scored.reduce((sum, session) => sum + Number(session.focus), 0) / scored.length) * 10) / 10 : null;
    const risk = workflowState === 'canceled' ? { atRisk: false, reason: null } : atRiskFor(task, blocked, blockers, remainingMinutes, blocks as ScheduleBlockV2[], availability);
    active.push({
      ...task,
      workflowState,
      displayState,
      blocked,
      blockedBy: blockers,
      checklist,
      checklistPercent: checklistPct,
      loggedMinutes,
      remainingMinutes,
      percentComplete,
      scheduledMinutes: ownBlocks.reduce((sum, block) => sum + Math.max(0, Number(block.plannedMinutes) || 0), 0),
      scheduleBlocks: ownBlocks,
      sessionCount: ownSessions.length,
      averageFocus,
      atRisk: risk.atRisk,
      atRiskReason: risk.reason,
      reading,
    });
  }
  active.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  trash.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  return {
    tasks: active,
    trash,
    summary: {
      open: active.filter(task => !['done', 'canceled'].includes(task.workflowState)).length,
      inProgress: active.filter(task => task.workflowState === 'in-progress').length,
      blocked: active.filter(task => task.blocked).length,
      atRisk: active.filter(task => task.atRisk).length,
      done: active.filter(task => task.workflowState === 'done').length,
      canceled: active.filter(task => task.workflowState === 'canceled').length,
      trash: trash.length,
    },
  };
}

async function taskById(taskId: string): Promise<Task | null> {
  const tasks = await listTasks();
  return tasks.find(task => String(task.id) === String(taskId)) || null;
}

function normalizeScheduleRows(rows: any[]): ScheduleBlockV2[] {
  return rows.map(row => ({
    id: String(row.id),
    taskId: String(row.task_id ?? row.taskId ?? ''),
    day: row.day instanceof Date ? dateKey(row.day) : String(row.day).slice(0, 10),
    plannedMinutes: Number(row.planned_minutes ?? row.plannedMinutes) || 0,
    guessed: Boolean(row.guessed),
    title: String(row.title || ''),
    course: String(row.course || ''),
    pages: row.pages == null ? null : Number(row.pages),
    priority: row.priority == null ? null : Number(row.priority),
    catchup: Boolean(row.catchup),
  }));
}

async function replaceTaskSchedule(taskId: string, replacement: ScheduleBlockV2[]): Promise<void> {
  const blocks = await listScheduleBlocks() as ScheduleBlockV2[];
  await replaceAllScheduleBlocks([...blocks.filter(block => String(block.taskId) !== String(taskId)), ...replacement]);
}

export async function trashTask(taskId: string): Promise<void> {
  await ensureTaskV2Schema();
  const task = await taskById(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const meta = await getTaskMeta(taskId);
  if (meta.deletedAt) return;
  const currentBlocks = (await listScheduleBlocks() as ScheduleBlockV2[]).filter(block => String(block.taskId) === String(taskId));
  await saveTaskMeta(taskId, { deletedAt: new Date().toISOString(), deletedSchedule: currentBlocks });
  await replaceTaskSchedule(taskId, []);
}

export async function restoreTask(taskId: string): Promise<void> {
  const task = await taskById(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const meta = await getTaskMeta(taskId);
  if (!meta.deletedAt) return;
  await saveTaskMeta(taskId, { deletedAt: null, deletedSchedule: [] });
  if (meta.workflowState !== 'canceled' && meta.deletedSchedule.length) await replaceTaskSchedule(taskId, meta.deletedSchedule);
  await reconcileTaskSchedule(taskId, { onlyIfScheduled: true });
}

export async function purgeTask(taskId: string): Promise<void> {
  const ok = await deleteTask(taskId);
  if (!ok) throw Object.assign(new Error('Task not found'), { status: 404 });
  if (!DB_URL) fallbackMeta.delete(taskId);
}

export async function cancelTask(taskId: string): Promise<TaskV2Meta> {
  const task = await taskById(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  if (task.status === 'done') throw Object.assign(new Error('Completed tasks must be reopened before they can be canceled.'), { status: 409 });
  const blocks = (await listScheduleBlocks() as ScheduleBlockV2[]).filter(block => String(block.taskId) === String(taskId));
  const meta = await saveTaskMeta(taskId, { workflowState: 'canceled', canceledSchedule: blocks });
  await replaceTaskSchedule(taskId, []);
  await reconcileDependents(taskId);
  return meta;
}

export async function reactivateTask(taskId: string): Promise<TaskV2Meta> {
  const task = await taskById(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const meta = await getTaskMeta(taskId);
  const sessions = await listSessions();
  const nextState: WorkflowState = sessionsFor(taskId, sessions).length ? 'in-progress' : 'not-started';
  await saveTaskMeta(taskId, { workflowState: nextState, canceledSchedule: [] });
  if (meta.canceledSchedule.length) await replaceTaskSchedule(taskId, meta.canceledSchedule);
  await reconcileTaskSchedule(taskId, { onlyIfScheduled: true });
  await reconcileDependents(taskId);
  return getTaskMeta(taskId);
}

export async function captureCompletionSnapshot(taskId: string): Promise<CompletionSnapshot> {
  const task = await taskById(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const meta = await getTaskMeta(taskId);
  const schedule = (await listScheduleBlocks() as ScheduleBlockV2[]).filter(block => String(block.taskId) === String(taskId));
  const snapshot: CompletionSnapshot = {
    capturedAt: new Date().toISOString(),
    workflowState: meta.workflowState === 'done' ? 'in-progress' : meta.workflowState,
    task: {
      status: task.status,
      remainingPageRanges: task.remainingPageRanges ?? null,
      originalPageRanges: task.originalPageRanges ?? null,
      estimatedMinutes: task.estimatedMinutes ?? null,
      actualMinutes: task.actualMinutes ?? null,
      completedAt: task.completedAt ?? null,
      focus: task.focus ?? null,
    },
    schedule,
  };
  await saveTaskMeta(taskId, { completionSnapshot: snapshot });
  return snapshot;
}

export async function markWorkflowAfterProgress(taskId: string, done: boolean): Promise<void> {
  await saveTaskMeta(taskId, { workflowState: done ? 'done' : 'in-progress' });
  if (done) await reconcileDependents(taskId);
}

export async function completeTaskWithoutSession(taskId: string): Promise<Task> {
  const task = await taskById(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  if (task.status === 'done') return task;
  await captureCompletionSnapshot(taskId);
  const sessions = await listSessions();
  const logged = sessionsFor(taskId, sessions).reduce((sum, session) => sum + Math.max(0, Number(session.minutes) || 0), 0);
  const updated = await updateTask(taskId, {
    status: 'done',
    completedAt: new Date().toISOString(),
    actualMinutes: logged || task.actualMinutes || null,
    estimatedMinutes: 0,
    remainingPageRanges: null,
  } as UpdateTaskInput);
  if (!updated) throw Object.assign(new Error('Task not found'), { status: 404 });
  await saveTaskMeta(taskId, { workflowState: 'done' });
  await replaceTaskSchedule(taskId, []);
  await reconcileDependents(taskId);
  return updated;
}

export async function reopenTask(taskId: string): Promise<Task> {
  const task = await taskById(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const meta = await getTaskMeta(taskId);
  const sessions = await listSessions();
  let updated: Task | null;
  if (meta.completionSnapshot) {
    const snap = meta.completionSnapshot;
    updated = await updateTask(taskId, {
      status: snap.task.status === 'done' ? 'todo' : snap.task.status,
      remainingPageRanges: snap.task.remainingPageRanges,
      originalPageRanges: snap.task.originalPageRanges,
      estimatedMinutes: snap.task.estimatedMinutes,
      actualMinutes: snap.task.actualMinutes,
      completedAt: snap.task.completedAt,
      focus: snap.task.focus,
    } as UpdateTaskInput);
    await replaceTaskSchedule(taskId, snap.schedule || []);
    const nextState: WorkflowState = snap.workflowState === 'done'
      ? (sessionsFor(taskId, sessions).length ? 'in-progress' : 'not-started')
      : snap.workflowState;
    await saveTaskMeta(taskId, { workflowState: nextState, completionSnapshot: null });
  } else {
    const [courses] = await Promise.all([listCourses()]);
    const original = taskOriginalRanges(task);
    const pace = courseReadingPace(task.course, courses);
    const remaining = original;
    const pages = remaining ? countPages(parsePageRanges(remaining)) : 0;
    updated = await updateTask(taskId, {
      status: 'todo',
      completedAt: null,
      actualMinutes: null,
      focus: null,
      remainingPageRanges: remaining,
      estimatedMinutes: pages > 0 ? Math.max(1, Math.round(pages * pace.mpp)) : task.estimatedMinutes,
    } as UpdateTaskInput);
    await saveTaskMeta(taskId, { workflowState: sessionsFor(taskId, sessions).length ? 'in-progress' : 'not-started', completionSnapshot: null });
  }
  if (!updated) throw Object.assign(new Error('Task not found'), { status: 404 });
  await reconcileTaskSchedule(taskId, { onlyIfScheduled: true });
  await reconcileDependents(taskId);
  return updated;
}

function completedRangeString(original: string | null, remaining: string | null): string | null {
  if (!original) return null;
  const originalPages = new Set<number>();
  for (const range of parsePageRanges(original)) for (let page = range.start; page <= range.end; page++) originalPages.add(page);
  const remainingPages = new Set<number>();
  for (const range of parsePageRanges(remaining || '')) for (let page = range.start; page <= range.end; page++) remainingPages.add(page);
  const completed = Array.from(originalPages).filter(page => !remainingPages.has(page)).sort((a, b) => a - b);
  if (!completed.length) return null;
  const ranges: Array<{ start: number; end: number }> = [];
  for (const page of completed) {
    const last = ranges[ranges.length - 1];
    if (last && page === last.end + 1) last.end = page;
    else ranges.push({ start: page, end: page });
  }
  return formatPageRanges(ranges);
}

export async function validateDependencies(taskId: string, dependencies: string[] | null | undefined): Promise<string[]> {
  const deps = Array.from(new Set((dependencies || []).map(String).filter(Boolean)));
  if (deps.includes(String(taskId))) throw Object.assign(new Error('A task cannot depend on itself.'), { status: 400 });
  const tasks = await listTasks();
  const taskMap = new Map(tasks.map(task => [String(task.id), task]));
  for (const dep of deps) if (!taskMap.has(dep)) throw Object.assign(new Error('One of the selected prerequisite tasks no longer exists.'), { status: 400 });
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    const current = taskMap.get(from);
    return safeArray<string>(current?.dependsOn).some(next => reaches(String(next), target, seen));
  };
  for (const dep of deps) if (reaches(dep, String(taskId))) throw Object.assign(new Error('That dependency would create a cycle.'), { status: 400 });
  return deps;
}

export async function editTaskStructured(taskId: string, rawPatch: UpdateTaskInput): Promise<Task> {
  const task = await taskById(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const courses = await listCourses();
  const patch: UpdateTaskInput = { ...rawPatch };

  if (rawPatch.courseId !== undefined) {
    if (rawPatch.courseId === null) {
      patch.courseId = null;
      patch.course = rawPatch.course ?? null;
    } else {
      const course = courses.find(item => String(item.id) === String(rawPatch.courseId));
      if (!course) throw Object.assign(new Error('Course not found.'), { status: 400 });
      patch.courseId = course.id;
      patch.course = course.title;
    }
  } else if (rawPatch.course !== undefined) {
    const key = (rawPatch.course || '').trim().toLowerCase();
    const course = key ? courses.find(item => (item.title || '').trim().toLowerCase() === key || (item.code || '').trim().toLowerCase() === key) : null;
    patch.course = course?.title ?? rawPatch.course ?? null;
    patch.courseId = course?.id ?? null;
  }

  if (rawPatch.dependsOn !== undefined) patch.dependsOn = await validateDependencies(taskId, rawPatch.dependsOn);

  const effectiveActivity = rawPatch.activity !== undefined ? rawPatch.activity : task.activity;
  if (rawPatch.activity !== undefined && rawPatch.activity !== 'reading') {
    patch.originalPageRanges = null;
    patch.remainingPageRanges = null;
    patch.pagesRead = null;
  } else if (effectiveActivity === 'reading' && rawPatch.originalPageRanges !== undefined) {
    const newOriginal = canonicalPageRanges(rawPatch.originalPageRanges);
    if (rawPatch.originalPageRanges && !newOriginal) throw Object.assign(new Error('Invalid page range.'), { status: 400 });
    const oldOriginal = taskOriginalRanges(task);
    const oldRemaining = taskRemainingRanges(task);
    const completed = completedRangeString(oldOriginal, oldRemaining);
    let newRemaining = newOriginal;
    if (newOriginal && completed && task.status !== 'done') newRemaining = formatPageRanges(subtractPages(parsePageRanges(newOriginal), completed)) || null;
    if (task.status === 'done') newRemaining = null;
    patch.originalPageRanges = newOriginal;
    patch.remainingPageRanges = newRemaining;
    patch.pagesRead = newOriginal ? countPages(parsePageRanges(newOriginal)) : null;
    if (rawPatch.estimatedMinutes === undefined && task.status !== 'done') {
      const courseName = patch.course !== undefined ? patch.course : task.course;
      const pace = courseReadingPace(courseName, courses);
      const remainingPages = newRemaining ? countPages(parsePageRanges(newRemaining)) : 0;
      patch.estimatedMinutes = remainingPages > 0 ? Math.max(1, Math.round(remainingPages * pace.mpp)) : 0;
      patch.estimateOrigin = pace.source === 'default' ? 'default' : 'learned';
    }
  } else if (effectiveActivity === 'reading' && rawPatch.remainingPageRanges !== undefined) {
    const remaining = canonicalPageRanges(rawPatch.remainingPageRanges);
    if (rawPatch.remainingPageRanges && !remaining) throw Object.assign(new Error('Invalid remaining page range.'), { status: 400 });
    patch.remainingPageRanges = task.status === 'done' ? null : remaining;
  }

  const updated = await updateTask(taskId, patch);
  if (!updated) throw Object.assign(new Error('Task not found'), { status: 404 });
  if (rawPatch.dependsOn !== undefined) await reconcileTaskSchedule(taskId, { onlyIfScheduled: true });
  if (rawPatch.dueDate !== undefined || rawPatch.estimatedMinutes !== undefined || rawPatch.course !== undefined || rawPatch.courseId !== undefined || rawPatch.originalPageRanges !== undefined || rawPatch.remainingPageRanges !== undefined || rawPatch.priority !== undefined) {
    await reconcileTaskSchedule(taskId, { onlyIfScheduled: true });
  }
  return updated;
}

export async function saveChecklist(taskId: string, items: ChecklistItem[]): Promise<TaskV2Meta> {
  const task = await taskById(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const cleaned = items.slice(0, 100).map(item => ({
    id: String(item.id || randomUUID()),
    title: String(item.title || '').trim().slice(0, 240),
    done: Boolean(item.done),
    createdAt: item.createdAt || new Date().toISOString(),
  })).filter(item => item.title);
  const current = await getTaskMeta(taskId);
  const nextState: WorkflowState = task.status === 'done'
    ? 'done'
    : current.workflowState === 'canceled'
      ? 'canceled'
      : cleaned.some(item => item.done) || current.workflowState === 'in-progress'
        ? 'in-progress'
        : 'not-started';
  return saveTaskMeta(taskId, { checklist: cleaned, workflowState: nextState });
}

export async function reconcileTaskSchedule(taskId: string, options?: { onlyIfScheduled?: boolean }): Promise<void> {
  const [tasks, sessions, courses, blocks] = await Promise.all([listTasks(), listSessions(), listCourses(), listScheduleBlocks()]);
  const task = tasks.find(item => String(item.id) === String(taskId));
  if (!task) return;
  const metaMap = await getMetaMap(tasks.map(item => String(item.id)));
  const meta = metaMap.get(String(taskId)) || emptyMeta(String(taskId));
  const taskMap = new Map(tasks.map(item => [String(item.id), item]));
  const blocked = blockersFor(task, taskMap, metaMap).length > 0 && !taskDone(task, meta) && meta.workflowState !== 'canceled';
  const allBlocks = blocks as ScheduleBlockV2[];
  const own = allBlocks.filter(block => String(block.taskId) === String(taskId));
  const other = allBlocks.filter(block => String(block.taskId) !== String(taskId));

  if (meta.deletedAt || meta.workflowState === 'canceled' || task.status === 'done') {
    if (own.length) await replaceAllScheduleBlocks(other);
    return;
  }

  if (blocked) {
    if (own.length) {
      await saveTaskMeta(taskId, { blockedSchedule: own });
      await replaceAllScheduleBlocks(other);
    }
    return;
  }

  if (!own.length && meta.blockedSchedule.length) {
    await replaceAllScheduleBlocks([...other, ...meta.blockedSchedule]);
    await saveTaskMeta(taskId, { blockedSchedule: [] });
    return reconcileTaskSchedule(taskId, { onlyIfScheduled: true });
  }

  if (!own.length && options?.onlyIfScheduled !== false) return;
  const reading = task.activity === 'reading' || Boolean(taskOriginalRanges(task));
  if (reading && own.length) {
    const { smartSplitTaskSchedule } = await import('./readingSchedule');
    await smartSplitTaskSchedule(taskId).catch(() => undefined);
    return;
  }

  const logged = sessionsFor(taskId, sessions).reduce((sum, session) => sum + Math.max(0, Number(session.minutes) || 0), 0);
  const remaining = Math.max(0, Number(task.estimatedMinutes) || 0);
  if (remaining <= 0) {
    if (own.length) await replaceAllScheduleBlocks(other);
    return;
  }
  if (!own.length) return;
  const today = dateKey(new Date());
  const future = own.filter(block => block.day >= today).sort((a, b) => a.day.localeCompare(b.day));
  const source = future.length ? future : own.sort((a, b) => a.day.localeCompare(b.day));
  let left = remaining;
  const revised: ScheduleBlockV2[] = [];
  for (let i = 0; i < source.length && left > 0; i++) {
    const block = source[i];
    const isLast = i === source.length - 1;
    const minutes = isLast ? left : Math.min(left, Math.max(1, Number(block.plannedMinutes) || 0));
    revised.push({ ...block, plannedMinutes: minutes, title: task.title, course: task.course || '', priority: task.priority ?? null });
    left -= minutes;
  }
  if (left > 0) {
    const due = dateKey(new Date(task.dueDate));
    revised.push({ id: `task-${randomUUID()}`, taskId, day: due, plannedMinutes: left, guessed: task.estimateOrigin !== 'manual', title: task.title, course: task.course || '', pages: null, priority: task.priority ?? null, catchup: false });
  }
  void logged;
  await replaceAllScheduleBlocks([...other, ...revised]);
}

export async function reconcileDependents(taskId: string): Promise<void> {
  const tasks = await listTasks();
  const dependents = tasks.filter(task => safeArray<string>(task.dependsOn).map(String).includes(String(taskId)));
  for (const dependent of dependents) await reconcileTaskSchedule(dependent.id, { onlyIfScheduled: true });
}

export async function taskIsBlocked(taskId: string): Promise<{ blocked: boolean; blockers: Array<{ id: string; title: string }> }> {
  const tasks = await listTasks();
  const metaMap = await getMetaMap(tasks.map(task => String(task.id)));
  const task = tasks.find(item => String(item.id) === String(taskId));
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const blockers = blockersFor(task, new Map(tasks.map(item => [String(item.id), item])), metaMap);
  return { blocked: blockers.length > 0 && !taskDone(task, metaMap.get(String(taskId))), blockers };
}
