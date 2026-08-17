from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def write(path: str, content: str) -> None:
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content.rstrip() + "\n", encoding="utf-8")

def replace_once(path: str, pattern: str, repl: str, *, flags=0) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    new, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise RuntimeError(f"Expected one replacement in {path}, got {n}: {pattern[:80]}")
    p.write_text(new, encoding="utf-8")

write("lib/reading.ts", r'''
import type { Course, NewTaskInput, StudySession, Task } from './types';
import {
  countPages,
  extractPageRangesFromTitle,
  formatPageRanges,
  parsePageRanges,
  type PageRange,
} from './pageRanges';

export type ReadingMetrics = {
  originalPageRanges: string | null;
  remainingPageRanges: string | null;
  assignedPages: number;
  completedPages: number;
  remainingPages: number;
  percentComplete: number;
  loggedMinutes: number;
  estimatedMinutesRemaining: number;
  paceMinutesPerPage: number;
  paceSource: 'override' | 'learned' | 'default';
};

export function canonicalPageRanges(value?: string | null): string | null {
  if (!value) return null;
  const ranges = parsePageRanges(value);
  return ranges.length ? formatPageRanges(ranges) : null;
}

export function taskOriginalRanges(task: Pick<Task, 'originalPageRanges' | 'remainingPageRanges' | 'title'>): string | null {
  return canonicalPageRanges(task.originalPageRanges)
    || canonicalPageRanges(extractPageRangesFromTitle(task.title))
    || canonicalPageRanges(task.remainingPageRanges)
    || null;
}

export function taskRemainingRanges(task: Pick<Task, 'originalPageRanges' | 'remainingPageRanges' | 'title' | 'status'>): string | null {
  if (task.status === 'done') return null;
  return canonicalPageRanges(task.remainingPageRanges)
    || taskOriginalRanges(task)
    || null;
}

export function courseReadingPace(courseName: string | null | undefined, courses: Course[]): { mpp: number; source: ReadingMetrics['paceSource'] } {
  const key = (courseName || '').trim().toLowerCase();
  const course = courses.find(c => (c.title || '').trim().toLowerCase() === key || (c.code || '').trim().toLowerCase() === key);
  if (course?.overrideEnabled && typeof course.overrideMpp === 'number' && course.overrideMpp > 0) {
    return { mpp: Math.max(0.5, Math.min(6, course.overrideMpp)), source: 'override' };
  }
  if (typeof course?.learnedMpp === 'number' && course.learnedMpp > 0) {
    return { mpp: Math.max(0.5, Math.min(6, course.learnedMpp)), source: 'learned' };
  }
  return { mpp: 3, source: 'default' };
}

export function readingMetrics(task: Task, sessions: StudySession[], courses: Course[]): ReadingMetrics {
  const originalPageRanges = taskOriginalRanges(task);
  const remainingPageRanges = taskRemainingRanges(task);
  const originalCount = originalPageRanges ? countPages(parsePageRanges(originalPageRanges)) : Math.max(0, Number(task.pagesRead) || 0);
  const remainingCount = task.status === 'done'
    ? 0
    : remainingPageRanges
      ? countPages(parsePageRanges(remainingPageRanges))
      : originalCount;
  const assignedPages = Math.max(originalCount, remainingCount);
  const remainingPages = Math.min(assignedPages || remainingCount, remainingCount);
  const completedPages = Math.max(0, assignedPages - remainingPages);
  const percentComplete = assignedPages > 0 ? Math.max(0, Math.min(100, Math.round((completedPages / assignedPages) * 100))) : (task.status === 'done' ? 100 : 0);
  const loggedMinutes = sessions
    .filter(session => String(session.taskId || '') === String(task.id))
    .reduce((sum, session) => sum + Math.max(0, Number(session.minutes) || 0), 0);
  const pace = courseReadingPace(task.course, courses);
  const estimatedMinutesRemaining = task.status === 'done'
    ? 0
    : remainingPages > 0
      ? Math.max(0, Math.round(remainingPages * pace.mpp))
      : Math.max(0, Number(task.estimatedMinutes) || 0);
  return {
    originalPageRanges,
    remainingPageRanges,
    assignedPages,
    completedPages,
    remainingPages,
    percentComplete,
    loggedMinutes,
    estimatedMinutesRemaining,
    paceMinutesPerPage: Math.round(pace.mpp * 100) / 100,
    paceSource: pace.source,
  };
}

export function normalizeReadingTaskInput(input: NewTaskInput, courses: Course[]): NewTaskInput {
  const exactCourse = courses.find(c => {
    const key = (input.course || '').trim().toLowerCase();
    return key && ((c.title || '').trim().toLowerCase() === key || (c.code || '').trim().toLowerCase() === key);
  });
  const inferredRanges = canonicalPageRanges(input.originalPageRanges)
    || canonicalPageRanges(input.remainingPageRanges)
    || canonicalPageRanges(extractPageRangesFromTitle(input.title));
  const activity = input.activity || (inferredRanges ? 'reading' : null);
  const reading = activity === 'reading';
  const pageCount = reading && inferredRanges ? countPages(parsePageRanges(inferredRanges)) : input.pagesRead ?? null;
  return {
    ...input,
    courseId: input.courseId || exactCourse?.id || null,
    activity,
    pagesRead: pageCount,
    originalPageRanges: reading ? (canonicalPageRanges(input.originalPageRanges) || inferredRanges) : input.originalPageRanges ?? null,
    remainingPageRanges: reading ? (canonicalPageRanges(input.remainingPageRanges) || inferredRanges) : input.remainingPageRanges ?? null,
  };
}

export function splitRangesByCounts(ranges: PageRange[], requestedCounts: number[]): string[] {
  const pages: number[] = [];
  for (const range of ranges) for (let page = range.start; page <= range.end; page++) pages.push(page);
  const chunks: string[] = [];
  let cursor = 0;
  for (const requested of requestedCounts) {
    if (cursor >= pages.length) break;
    const size = Math.max(1, Math.min(Math.floor(requested), pages.length - cursor));
    const part = pages.slice(cursor, cursor + size);
    cursor += size;
    const grouped: PageRange[] = [];
    for (const page of part) {
      const last = grouped[grouped.length - 1];
      if (last && page === last.end + 1) last.end = page;
      else grouped.push({ start: page, end: page });
    }
    chunks.push(formatPageRanges(grouped));
  }
  if (cursor < pages.length) {
    const part = pages.slice(cursor);
    const grouped: PageRange[] = [];
    for (const page of part) {
      const last = grouped[grouped.length - 1];
      if (last && page === last.end + 1) last.end = page;
      else grouped.push({ start: page, end: page });
    }
    if (chunks.length) chunks[chunks.length - 1] = [chunks[chunks.length - 1], formatPageRanges(grouped)].filter(Boolean).join(', ');
    else chunks.push(formatPageRanges(grouped));
  }
  return chunks;
}
''')

write("lib/taskProgress.ts", r'''
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { StudySession, Task } from './types';
import { countPages, formatPageRanges, parsePageRanges, subtractPages, validateCompletedPages } from './pageRanges';
import { canonicalPageRanges, courseReadingPace, readingMetrics, taskOriginalRanges, taskRemainingRanges } from './reading';
import { createSession, listCourses, listScheduleBlocks, listSessions, listTasks, replaceAllScheduleBlocks, updateTask } from './storage';

export type TaskProgressInput = {
  mode: 'partial' | 'finish';
  minutes: number;
  focus: number;
  notes?: string | null;
  pagesCompleted?: string | null;
  moveToDay?: string | null;
  completionDate?: string | null;
};

function resolveDbUrl(): string | null {
  const direct = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING || null;
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
function getPool(): Pool {
  if (!DB_URL) throw new Error('No database URL');
  if (!pool) pool = new Pool({ connectionString: DB_URL, ssl: DB_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  return pool;
}

function rowToTask(r: any): Task {
  return {
    id: r.id, title: r.title, course: r.course ?? null, courseId: r.course_id ?? null,
    dueDate: new Date(r.due_date).toISOString(), status: r.status, createdAt: new Date(r.created_at).toISOString(),
    startTime: r.start_time ?? null, endTime: r.end_time ?? null, estimatedMinutes: r.estimated_minutes ?? null,
    estimateOrigin: r.estimate_origin ?? null, actualMinutes: r.actual_minutes ?? null, priority: r.priority ?? null,
    notes: r.notes ?? null, attachments: r.attachments ?? null, dependsOn: r.depends_on ?? null, tags: r.tags ?? null,
    term: r.term ?? null, completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    focus: r.focus ?? null, pagesRead: r.pages_read ?? null, activity: r.activity ?? null,
    originalPageRanges: r.original_page_ranges ?? null, remainingPageRanges: r.remaining_page_ranges ?? null,
  };
}

function sessionFromRow(r: any): StudySession {
  return { id: r.id, taskId: r.task_id ?? null, when: new Date(r.when_ts).toISOString(), minutes: r.minutes, focus: r.focus ?? null, notes: r.notes ?? null, pagesRead: r.pages_read ?? null, outlinePages: r.outline_pages ?? null, practiceQs: r.practice_qs ?? null, activity: r.activity ?? null, createdAt: new Date(r.created_at).toISOString() };
}

function completionDate(input: TaskProgressInput): Date {
  if (input.completionDate && /^\d{4}-\d{2}-\d{2}$/.test(input.completionDate)) return new Date(`${input.completionDate}T12:00:00`);
  return new Date();
}

export async function recordTaskProgress(taskId: string, input: TaskProgressInput): Promise<{ task: Task; session: StudySession; reading: ReturnType<typeof readingMetrics> }> {
  if (DB_URL) return recordDb(taskId, input);
  return recordFallback(taskId, input);
}

async function recordDb(taskId: string, input: TaskProgressInput) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const taskRes = await client.query(`SELECT id, title, course, course_id, due_date, status, created_at, estimated_minutes, estimate_origin, actual_minutes, priority, notes, attachments, depends_on, tags, term, completed_at, focus, pages_read, activity, start_time, end_time, original_page_ranges, remaining_page_ranges FROM tasks WHERE id=$1 FOR UPDATE`, [taskId]);
    if (!taskRes.rowCount) throw Object.assign(new Error('Task not found'), { status: 404 });
    const task = rowToTask(taskRes.rows[0]);
    const courseRes = await client.query(`SELECT id, title, code, learned_mpp, override_enabled, override_mpp, created_at FROM courses WHERE id=$1 OR lower(title)=lower($2) OR lower(COALESCE(code,''))=lower($2) ORDER BY CASE WHEN id=$1 THEN 0 ELSE 1 END LIMIT 1`, [task.courseId, task.course || '']);
    const course = courseRes.rows[0] ? [{ id: courseRes.rows[0].id, title: courseRes.rows[0].title, code: courseRes.rows[0].code, learnedMpp: courseRes.rows[0].learned_mpp, overrideEnabled: courseRes.rows[0].override_enabled, overrideMpp: courseRes.rows[0].override_mpp, createdAt: new Date(courseRes.rows[0].created_at).toISOString() } as any] : [];
    const pace = courseReadingPace(task.course, course);
    const original = taskOriginalRanges(task);
    const remainingBefore = taskRemainingRanges(task);
    const isReading = task.activity === 'reading' || Boolean(original || remainingBefore);
    let completedInput = canonicalPageRanges(input.pagesCompleted) || null;
    if (isReading && input.mode === 'finish' && !completedInput) completedInput = remainingBefore || original;
    let remainingAfter = remainingBefore;
    let pagesThisSession = 0;
    if (isReading && completedInput && remainingBefore) {
      const currentRanges = parsePageRanges(remainingBefore);
      const valid = validateCompletedPages(currentRanges, completedInput);
      if (!valid.valid) throw Object.assign(new Error(valid.error || 'Completed pages are outside the assigned range.'), { status: 400 });
      pagesThisSession = countPages(parsePageRanges(completedInput));
      remainingAfter = formatPageRanges(subtractPages(currentRanges, completedInput)) || null;
    }
    const remainingPages = remainingAfter ? countPages(parsePageRanges(remainingAfter)) : 0;
    const done = input.mode === 'finish' || (isReading && Boolean(original) && remainingPages === 0);
    const prior = await client.query(`SELECT COALESCE(SUM(minutes),0)::int AS minutes FROM sessions WHERE task_id=$1`, [taskId]);
    const totalLogged = Number(prior.rows[0]?.minutes || 0) + input.minutes;
    const when = completionDate(input);
    const sessionId = randomUUID();
    const sessionRes = await client.query(`INSERT INTO sessions (id, task_id, when_ts, minutes, focus, notes, pages_read, activity, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id, task_id, when_ts, minutes, focus, notes, pages_read, outline_pages, practice_qs, activity, created_at`, [sessionId, taskId, when, input.minutes, input.focus, input.notes || null, pagesThisSession || null, task.activity || (isReading ? 'reading' : null)]);
    const estimated = done ? 0 : isReading && remainingPages > 0 ? Math.max(1, Math.round(remainingPages * pace.mpp)) : Math.max(0, (Number(task.estimatedMinutes) || 0) - input.minutes);
    const updatedRes = await client.query(`UPDATE tasks SET original_page_ranges=$2, remaining_page_ranges=$3, estimated_minutes=$4, status=$5, actual_minutes=$6, focus=$7, completed_at=$8 WHERE id=$1 RETURNING id, title, course, course_id, due_date, status, created_at, estimated_minutes, estimate_origin, actual_minutes, priority, notes, attachments, depends_on, tags, term, completed_at, focus, pages_read, activity, start_time, end_time, original_page_ranges, remaining_page_ranges`, [taskId, original, done ? null : remainingAfter, estimated, done ? 'done' : task.status, done ? totalLogged : task.actualMinutes ?? null, done ? Math.round(input.focus) : task.focus ?? null, done ? when : task.completedAt ? new Date(task.completedAt) : null]);
    if (done) {
      await client.query(`DELETE FROM schedule_blocks WHERE task_id=$1`, [taskId]);
    } else if (input.moveToDay && /^\d{4}-\d{2}-\d{2}$/.test(input.moveToDay)) {
      await client.query(`DELETE FROM schedule_blocks WHERE task_id=$1`, [taskId]);
      await client.query(`INSERT INTO schedule_blocks (id, task_id, day, planned_minutes, guessed, title, course, pages, priority, catchup) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,FALSE)`, [`progress-${randomUUID()}`, taskId, input.moveToDay, estimated, pace.source === 'default', task.title, task.course || '', remainingPages || null, task.priority ?? null]);
    }
    await client.query('COMMIT');
    const updated = rowToTask(updatedRes.rows[0]);
    const session = sessionFromRow(sessionRes.rows[0]);
    return { task: updated, session, reading: readingMetrics(updated, [{ ...session }], course) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function recordFallback(taskId: string, input: TaskProgressInput) {
  const tasks = await listTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const [courses, sessions] = await Promise.all([listCourses(), listSessions()]);
  const pace = courseReadingPace(task.course, courses);
  const original = taskOriginalRanges(task);
  const remainingBefore = taskRemainingRanges(task);
  const isReading = task.activity === 'reading' || Boolean(original || remainingBefore);
  let completedInput = canonicalPageRanges(input.pagesCompleted) || null;
  if (isReading && input.mode === 'finish' && !completedInput) completedInput = remainingBefore || original;
  let remainingAfter = remainingBefore;
  let pagesThisSession = 0;
  if (isReading && completedInput && remainingBefore) {
    const currentRanges = parsePageRanges(remainingBefore);
    const valid = validateCompletedPages(currentRanges, completedInput);
    if (!valid.valid) throw Object.assign(new Error(valid.error || 'Completed pages are outside the assigned range.'), { status: 400 });
    pagesThisSession = countPages(parsePageRanges(completedInput));
    remainingAfter = formatPageRanges(subtractPages(currentRanges, completedInput)) || null;
  }
  const remainingPages = remainingAfter ? countPages(parsePageRanges(remainingAfter)) : 0;
  const done = input.mode === 'finish' || (isReading && Boolean(original) && remainingPages === 0);
  const session = await createSession({ taskId, minutes: input.minutes, focus: input.focus, notes: input.notes || null, pagesRead: pagesThisSession || null, activity: task.activity || (isReading ? 'reading' : null), when: completionDate(input).toISOString() });
  const totalLogged = sessions.filter(s => s.taskId === taskId).reduce((sum, s) => sum + s.minutes, 0) + input.minutes;
  const estimated = done ? 0 : isReading && remainingPages > 0 ? Math.max(1, Math.round(remainingPages * pace.mpp)) : Math.max(0, (task.estimatedMinutes || 0) - input.minutes);
  const updated = await updateTask(taskId, { originalPageRanges: original, remainingPageRanges: done ? null : remainingAfter, estimatedMinutes: estimated, status: done ? 'done' : task.status, actualMinutes: done ? totalLogged : task.actualMinutes ?? null, focus: done ? Math.round(input.focus) : task.focus ?? null, completedAt: done ? completionDate(input).toISOString() : task.completedAt ?? null });
  if (!updated) throw new Error('Unable to update task');
  const blocks = await listScheduleBlocks();
  if (done) await replaceAllScheduleBlocks(blocks.filter(b => b.taskId !== taskId));
  else if (input.moveToDay && /^\d{4}-\d{2}-\d{2}$/.test(input.moveToDay)) await replaceAllScheduleBlocks([...blocks.filter(b => b.taskId !== taskId), { id: `progress-${randomUUID()}`, taskId, day: input.moveToDay, plannedMinutes: estimated, guessed: pace.source === 'default', title: task.title, course: task.course || '', pages: remainingPages || null, priority: task.priority ?? null, catchup: false }]);
  return { task: updated, session, reading: readingMetrics(updated, [...sessions, session], courses) };
}
''')

write("lib/readingSchedule.ts", r'''
import { randomUUID } from 'crypto';
import { countPages, parsePageRanges } from './pageRanges';
import { courseReadingPace, splitRangesByCounts, taskRemainingRanges } from './reading';
import { getSettings, listCourses, listScheduleBlocks, listTasks, replaceAllScheduleBlocks } from './storage';

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function smartSplitTaskSchedule(taskId: string) {
  const [tasks, courses, settings, blocks] = await Promise.all([
    listTasks(), listCourses(), getSettings(['availabilityTemplateV1']), listScheduleBlocks(),
  ]);
  const task = tasks.find(t => t.id === taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  const remaining = taskRemainingRanges(task);
  if (!remaining) throw Object.assign(new Error('This reading has no remaining page range to split.'), { status: 400 });
  const ranges = parsePageRanges(remaining);
  const totalPages = countPages(ranges);
  if (!totalPages) throw Object.assign(new Error('This reading has no remaining pages.'), { status: 400 });
  const pace = courseReadingPace(task.course, courses);
  const availability = (settings?.availabilityTemplateV1 && typeof settings.availabilityTemplateV1 === 'object') ? settings.availabilityTemplateV1 as Record<string, number> : {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let due = new Date(task.dueDate); due.setHours(0, 0, 0, 0);
  if (due < today) due = new Date(today);
  const other = blocks.filter(block => block.taskId !== taskId);
  const used = new Map<string, number>();
  for (const block of other) used.set(block.day, (used.get(block.day) || 0) + Math.max(0, Number(block.plannedMinutes) || 0));
  const slots: Array<{ day: string; pages: number }> = [];
  let remainingPages = totalPages;
  for (let i = 0; i < 31 && remainingPages > 0; i++) {
    const day = new Date(today); day.setDate(today.getDate() + i);
    if (day > due) break;
    const key = ymd(day);
    const configured = Number((availability as any)[day.getDay()]);
    const dailyCapacity = Number.isFinite(configured) && configured > 0 ? configured : (day.getDay() === 0 || day.getDay() === 6 ? 90 : 150);
    const free = Math.max(0, dailyCapacity - (used.get(key) || 0));
    const pageCapacity = Math.max(0, Math.floor(free / pace.mpp));
    if (pageCapacity <= 0) continue;
    const pages = Math.min(remainingPages, pageCapacity);
    slots.push({ day: key, pages });
    remainingPages -= pages;
  }
  if (!slots.length) slots.push({ day: ymd(due), pages: totalPages });
  else if (remainingPages > 0) slots[slots.length - 1].pages += remainingPages;
  const chunks = splitRangesByCounts(ranges, slots.map(slot => slot.pages));
  const plan = slots.slice(0, chunks.length).map((slot, index) => {
    const pages = countPages(parsePageRanges(chunks[index]));
    return {
      id: `reading-${randomUUID()}`,
      taskId,
      day: slot.day,
      plannedMinutes: Math.max(1, Math.round(pages * pace.mpp)),
      guessed: pace.source === 'default',
      title: `${task.title} — ${chunks[index]}`,
      course: task.course || '',
      pages,
      priority: task.priority ?? null,
      catchup: false,
      range: chunks[index],
    };
  });
  await replaceAllScheduleBlocks([...other, ...plan.map(({ range, ...block }) => block)]);
  return { taskId, paceMinutesPerPage: pace.mpp, paceSource: pace.source, plan };
}
''')

write("app/api/tasks/[id]/progress/route.ts", r'''
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSchema, listScheduleBlocks } from '@/lib/storage';
import { recordTaskProgress } from '@/lib/taskProgress';
import { smartSplitTaskSchedule } from '@/lib/readingSchedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const schema = z.object({
    mode: z.enum(['partial', 'finish']),
    minutes: z.number().int().min(1).max(1440),
    focus: z.number().min(1).max(10),
    notes: z.string().max(5000).nullable().optional(),
    pagesCompleted: z.string().max(500).nullable().optional(),
    moveToDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    completionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid progress entry.' }, { status: 400 });
  try {
    const beforeBlocks = await listScheduleBlocks().catch(() => []);
    const hadSplitPlan = beforeBlocks.filter(block => block.taskId === params.id).length > 1;
    const result = await recordTaskProgress(params.id, parsed.data);
    let schedule = null;
    if (result.task.status !== 'done' && !parsed.data.moveToDay && hadSplitPlan && result.reading.remainingPages > 0) {
      schedule = await smartSplitTaskSchedule(params.id).catch(() => null);
    }
    return Response.json({ ...result, schedule });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[task progress]', error);
    return Response.json({ error: error?.message || 'Unable to record progress.' }, { status });
  }
}
''')

write("app/api/tasks/[id]/smart-split/route.ts", r'''
import { NextRequest } from 'next/server';
import { ensureSchema } from '@/lib/storage';
import { smartSplitTaskSchedule } from '@/lib/readingSchedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureSchema();
    return Response.json(await smartSplitTaskSchedule(params.id));
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[smart split]', error);
    return Response.json({ error: error?.message || 'Unable to split reading.' }, { status });
  }
}
''')

write("app/api/reading/overview/route.ts", r'''
import { NextRequest } from 'next/server';
import { listAiNotes } from '@/lib/aiNotes';
import { readingMetrics, taskOriginalRanges } from '@/lib/reading';
import { ensureSchema, listCourses, listSessions, listTasks } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  await ensureSchema();
  const includeDone = req.nextUrl.searchParams.get('includeDone') === 'true';
  const [tasks, sessions, courses, notes] = await Promise.all([
    listTasks(), listSessions(), listCourses(), listAiNotes({ limit: 500 }).catch(() => []),
  ]);
  const notesByTask = new Map<string, typeof notes>();
  for (const note of notes) {
    if (!note.taskId) continue;
    const list = notesByTask.get(note.taskId) || [];
    list.push(note);
    notesByTask.set(note.taskId, list);
  }
  const readings = tasks
    .filter(task => includeDone || task.status !== 'done')
    .filter(task => task.activity === 'reading' || Boolean(taskOriginalRanges(task)))
    .map(task => {
      const metrics = readingMetrics(task, sessions, courses);
      const linked = notesByTask.get(task.id) || [];
      const dueMs = new Date(task.dueDate).getTime();
      const hoursUntilDue = Number.isFinite(dueMs) ? (dueMs - Date.now()) / 36e5 : Infinity;
      const atRisk = task.status !== 'done' && (hoursUntilDue < 0 || (hoursUntilDue <= 24 && metrics.estimatedMinutesRemaining >= 60));
      return {
        ...task,
        ...metrics,
        atRisk,
        noteCount: linked.length,
        readingNoteCount: linked.filter(note => note.sourceType === 'reading-notes').length,
        caseBriefCount: linked.filter(note => note.sourceType === 'case-brief').length,
        classNoteCount: linked.filter(note => note.sourceType === 'class-notes').length,
        linkedNotes: linked.slice(0, 8).map(note => ({ id: note.id, title: note.title, sourceType: note.sourceType, section: note.section, notebookName: note.notebookName })),
      };
    })
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  const grouped = new Map<string, any>();
  for (const reading of readings) {
    const key = reading.course || 'Unassigned';
    const current = grouped.get(key) || { course: key, readings: 0, assignedPages: 0, completedPages: 0, remainingPages: 0, estimatedMinutesRemaining: 0, atRisk: 0 };
    current.readings += 1;
    current.assignedPages += reading.assignedPages;
    current.completedPages += reading.completedPages;
    current.remainingPages += reading.remainingPages;
    current.estimatedMinutesRemaining += reading.estimatedMinutesRemaining;
    current.atRisk += reading.atRisk ? 1 : 0;
    grouped.set(key, current);
  }
  return Response.json({
    generatedAt: new Date().toISOString(),
    summary: {
      readings: readings.filter(r => r.status !== 'done').length,
      assignedPages: readings.reduce((sum, r) => sum + r.assignedPages, 0),
      completedPages: readings.reduce((sum, r) => sum + r.completedPages, 0),
      remainingPages: readings.reduce((sum, r) => sum + r.remainingPages, 0),
      estimatedMinutesRemaining: readings.reduce((sum, r) => sum + r.estimatedMinutesRemaining, 0),
      atRisk: readings.filter(r => r.atRisk).length,
    },
    courses: Array.from(grouped.values()),
    readings,
  });
}
''')

write("components/ReadingDashboard.tsx", r'''
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { notifyTasksChanged } from '@/lib/taskBus';
import { notifySessionsChanged } from '@/lib/sessionsBus';
import { notifyToast } from '@/lib/toastBus';

type Reading = {
  id: string; title: string; course?: string | null; dueDate: string; status: 'todo' | 'done';
  originalPageRanges?: string | null; remainingPageRanges?: string | null;
  assignedPages: number; completedPages: number; remainingPages: number; percentComplete: number;
  loggedMinutes: number; estimatedMinutesRemaining: number; paceMinutesPerPage: number; paceSource: string;
  atRisk: boolean; noteCount: number; readingNoteCount: number; caseBriefCount: number; classNoteCount: number;
  linkedNotes: Array<{ id: string; title: string; sourceType: string; section?: string | null }>;
};

type Overview = {
  summary: { readings: number; assignedPages: number; completedPages: number; remainingPages: number; estimatedMinutesRemaining: number; atRisk: number };
  courses: Array<{ course: string; readings: number; assignedPages: number; completedPages: number; remainingPages: number; estimatedMinutesRemaining: number; atRisk: number }>;
  readings: Reading[];
};

function duration(minutes: number) {
  const m = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(m / 60); const r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`;
}

function dueLabel(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'No due date' : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ReadingDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState<Reading | null>(null);
  const [minutes, setMinutes] = useState('30');
  const [focus, setFocus] = useState('6');
  const [pages, setPages] = useState('');
  const [moveToDay, setMoveToDay] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try { setData(await apiFetch<Overview>('/api/reading/overview')); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const byCourse = useMemo(() => {
    const map = new Map<string, Reading[]>();
    for (const reading of data?.readings || []) {
      const key = reading.course || 'Unassigned';
      map.set(key, [...(map.get(key) || []), reading]);
    }
    return Array.from(map.entries());
  }, [data]);

  async function logProgress(mode: 'partial' | 'finish') {
    if (!logging) return;
    setBusyId(logging.id);
    try {
      await apiFetch(`/api/tasks/${logging.id}/progress`, { method: 'POST', body: {
        mode, minutes: Math.max(1, Math.round(Number(minutes) || 0)), focus: Math.max(1, Math.min(10, Number(focus) || 5)),
        pagesCompleted: pages.trim() || null, moveToDay: moveToDay || null,
      }});
      notifyTasksChanged(); notifySessionsChanged();
      notifyToast({ kind: 'success', message: mode === 'finish' ? 'Reading completed.' : 'Reading progress logged.' });
      setLogging(null); setPages(''); setMoveToDay('');
      await refresh();
    } catch (error: any) {
      notifyToast({ kind: 'error', message: error?.message || 'Unable to log reading progress.' });
    } finally { setBusyId(null); }
  }

  async function split(reading: Reading) {
    setBusyId(reading.id);
    try {
      await apiFetch(`/api/tasks/${reading.id}/smart-split`, { method: 'POST', body: {} });
      notifyToast({ kind: 'success', message: 'Reading split across your available days.' });
    } catch (error: any) {
      notifyToast({ kind: 'error', message: error?.message || 'Unable to split reading.' });
    } finally { setBusyId(null); }
  }

  if (loading && !data) return <div className="card p-6 text-sm text-slate-300">Loading reading tracker…</div>;
  const summary = data?.summary;
  return <div className="space-y-4">
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {[
        ['Open readings', summary?.readings ?? 0],
        ['Pages remaining', summary?.remainingPages ?? 0],
        ['Pages completed', summary?.completedPages ?? 0],
        ['Time remaining', duration(summary?.estimatedMinutesRemaining ?? 0)],
        ['At risk', summary?.atRisk ?? 0],
      ].map(([label, value]) => <div className="card p-4" key={String(label)}><div className="text-xs text-slate-400">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>)}
    </div>

    {!data?.readings?.length ? <div className="card p-6"><h2 className="font-medium">No active readings yet</h2><p className="mt-1 text-sm text-slate-400">Create reading tasks from Tasks. Page ranges, pace, progress, linked notes, and scheduling will appear here automatically.</p><Link href="/tasks" className="inline-block mt-3 underline">Go to Tasks</Link></div> : null}

    {byCourse.map(([course, readings]) => {
      const courseSummary = data?.courses.find(c => c.course === course);
      return <section className="card p-5 space-y-3" key={course}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><h2 className="text-lg font-semibold">{course}</h2><p className="text-xs text-slate-400">{courseSummary?.remainingPages || 0} pages left · {duration(courseSummary?.estimatedMinutesRemaining || 0)} estimated</p></div>
          <Link href="/notes" className="text-sm underline decoration-dotted">Open course notes</Link>
        </div>
        <div className="space-y-3">
          {readings.map(reading => <article key={reading.id} className="rounded border border-white/10 p-4 space-y-2">
            <div className="flex flex-wrap justify-between gap-2">
              <div><div className="font-medium">{reading.title}</div><div className="text-xs text-slate-400">Due {dueLabel(reading.dueDate)}{reading.atRisk ? ' · At risk' : ''}</div></div>
              <div className="text-right text-xs text-slate-400"><div>{reading.remainingPageRanges || 'No pages remaining'}</div><div>{reading.remainingPages} pages · {duration(reading.estimatedMinutesRemaining)}</div></div>
            </div>
            <div><div className="h-2 rounded bg-white/10 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${reading.percentComplete}%` }} /></div><div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>{reading.completedPages}/{reading.assignedPages} pages</span><span>{reading.percentComplete}%</span></div></div>
            <div className="grid sm:grid-cols-3 gap-2 text-xs text-slate-400">
              <div>Pace: {reading.paceMinutesPerPage} min/page ({reading.paceSource})</div>
              <div>Logged: {duration(reading.loggedMinutes)}</div>
              <div>Linked: {reading.readingNoteCount} reading notes · {reading.caseBriefCount} briefs</div>
            </div>
            {reading.linkedNotes.length ? <div className="text-xs text-slate-400">Materials: {reading.linkedNotes.map(n => n.title).join(' · ')}</div> : null}
            <div className="flex flex-wrap gap-2">
              <button className="px-3 py-1.5 rounded border border-white/10 text-sm" onClick={() => { setLogging(reading); setPages(''); setMoveToDay(''); setMinutes(reading.estimatedMinutesRemaining ? String(Math.min(60, reading.estimatedMinutesRemaining)) : '30'); }}>Log progress</button>
              <button className="px-3 py-1.5 rounded border border-white/10 text-sm disabled:opacity-50" disabled={busyId === reading.id || reading.remainingPages === 0} onClick={() => split(reading)}>Smart split</button>
            </div>
          </article>)}
        </div>
      </section>;
    })}

    {logging ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button className="absolute inset-0 bg-black/70" aria-label="Close" onClick={() => setLogging(null)} /><div className="relative w-full max-w-md rounded-lg border border-white/10 bg-[#0f172a] p-5 space-y-4"><div><h2 className="text-lg font-semibold">Log reading progress</h2><p className="text-sm text-slate-400">{logging.course} · {logging.remainingPageRanges}</p></div><label className="block text-sm">Minutes<input className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" value={minutes} onChange={e => setMinutes(e.target.value)} /></label><label className="block text-sm">Focus (1–10)<input type="number" min="1" max="10" className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" value={focus} onChange={e => setFocus(e.target.value)} /></label><label className="block text-sm">Pages completed<input className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" placeholder="e.g. 100–122" value={pages} onChange={e => setPages(e.target.value)} /></label><label className="block text-sm">Move remainder to day <span className="text-slate-500">(optional)</span><input type="date" className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" value={moveToDay} onChange={e => setMoveToDay(e.target.value)} /></label><div className="flex justify-end gap-2"><button className="px-3 py-2" onClick={() => setLogging(null)}>Cancel</button><button className="px-3 py-2 rounded border border-white/10" disabled={busyId === logging.id} onClick={() => logProgress('partial')}>Log partial</button><button className="px-3 py-2 rounded bg-emerald-600" disabled={busyId === logging.id} onClick={() => logProgress('finish')}>Complete</button></div></div></div> : null}
  </div>;
}
''')

write("app/reading/page.tsx", r'''
import ReadingDashboard from '@/components/ReadingDashboard';

export default function ReadingPage() {
  return <main className="space-y-4"><ReadingDashboard /></main>;
}
''')

write("app/api/tasks/route.ts", r'''
import { NextRequest } from 'next/server';
import { createTask, ensureSchema, listCourses, listTasks } from '@/lib/storage';
import { activeSemesterId } from '@/lib/collections';
import { NewTaskInput } from '@/lib/types';
import { normalizeReadingTaskInput } from '@/lib/reading';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await ensureSchema();
  const tasks = await listTasks();
  return Response.json({ tasks });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const schema = z.object({
    title: z.string().min(1),
    course: z.string().trim().min(1).nullable().optional(),
    courseId: z.string().trim().min(1).nullable().optional(),
    dueDate: z.string().min(1),
    status: z.enum(['todo', 'done']).optional(),
    startTime: z.string().trim().nullable().optional().or(z.literal('')).transform(v => v === '' ? null : v),
    endTime: z.string().trim().nullable().optional().or(z.literal('')).transform(v => v === '' ? null : v),
    estimatedMinutes: z.number().int().min(0).nullable().optional(),
    estimateOrigin: z.enum(['learned','default','manual']).nullable().optional(),
    priority: z.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    attachments: z.array(z.string().url()).nullable().optional(),
    dependsOn: z.array(z.string()).nullable().optional(),
    tags: z.array(z.string().trim().min(1)).nullable().optional(),
    term: z.string().trim().min(1).nullable().optional(),
    pagesRead: z.number().int().min(0).nullable().optional(),
    activity: z.string().trim().min(1).nullable().optional(),
    originalPageRanges: z.string().trim().max(500).nullable().optional(),
    remainingPageRanges: z.string().trim().max(500).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid task body', { status: 400 });
  const normalized = normalizeReadingTaskInput(parsed.data as NewTaskInput, await listCourses());
  const defaultTerm = normalized.term ?? await activeSemesterId();
  const task = await createTask({ ...normalized, term: defaultTerm ?? null });
  return Response.json({ task }, { status: 201 });
}
''')

write("app/api/tasks/bulk/route.ts", r'''
import { NextRequest } from 'next/server';
import { ensureSchema, createTask, listCourses } from '@/lib/storage';
import { activeSemesterId } from '@/lib/collections';
import { normalizeReadingTaskInput } from '@/lib/reading';
import { NewTaskInput, Task } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  await ensureSchema();
  const taskSchema = z.object({
    title: z.string().min(1), dueDate: z.string().min(1), course: z.string().trim().min(1).nullable().optional(), courseId: z.string().trim().min(1).nullable().optional(),
    status: z.enum(['todo', 'done']).optional(), estimatedMinutes: z.number().int().min(0).nullable().optional(), estimateOrigin: z.enum(['learned','default','manual']).nullable().optional(),
    priority: z.number().int().min(1).max(5).nullable().optional(), tags: z.array(z.string().trim().min(1)).nullable().optional(), term: z.string().trim().min(1).nullable().optional(),
    activity: z.string().trim().min(1).nullable().optional(), pagesRead: z.number().int().min(0).nullable().optional(), originalPageRanges: z.string().trim().max(500).nullable().optional(), remainingPageRanges: z.string().trim().max(500).nullable().optional(),
  });
  const parsed = z.object({ tasks: z.array(taskSchema).min(1) }).safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid bulk body', { status: 400 });
  const [courses, defaultTerm] = await Promise.all([listCourses(), activeSemesterId()]);
  const created: Task[] = [];
  for (const item of parsed.data.tasks as NewTaskInput[]) {
    const normalized = normalizeReadingTaskInput(item, courses);
    created.push(await createTask({ ...normalized, term: normalized.term ?? defaultTerm ?? null }));
  }
  return Response.json({ createdCount: created.length, tasks: created }, { status: 201 });
}
''')

write("app/tasks/page.tsx", r'''
"use client";
import Link from 'next/link';
import TaskTable from '@/components/TaskTable';

export default function TasksPage() {
  return (
    <main className="space-y-4">
      <section className="card p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-lg font-medium">Tasks</h2><p className="text-xs text-slate-400">Assignments, readings, deadlines, and logged progress.</p></div>
          <Link href="/reading" className="px-3 py-2 rounded border border-white/10 text-sm">Reading tracker</Link>
        </div>
        <TaskTable />
      </section>
    </main>
  );
}
''')

write("app/api/gpt/assignments/route.ts", r'''
import { NextRequest } from 'next/server';
import { ensureSchema, getGptPool, listCourses, listSessions, listTasks } from '@/lib/storage';
import { countNotesByTask } from '@/lib/aiNotes';
import { notesGptDb } from '@/lib/notes/db';
import { readingMetrics } from '@/lib/reading';
import { noStoreJson, requireGptToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(req: NextRequest) {
  const denied = requireGptToken(req);
  if (denied) return denied;
  try {
    await ensureSchema();
    const params = req.nextUrl.searchParams;
    const status = params.get('status');
    const course = params.get('course')?.trim().toLowerCase() || '';
    const activity = params.get('activity')?.trim().toLowerCase() || '';
    const from = validDate(params.get('from')); const to = validDate(params.get('to'));
    const requestedLimit = Number(params.get('limit') || 50);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.floor(requestedLimit), 100)) : 50;
    const gptPool = getGptPool();
    const [tasks, sessions, courses, noteCounts] = await Promise.all([
      listTasks(gptPool), listSessions(gptPool), listCourses(gptPool), countNotesByTask(notesGptDb()).catch(() => ({} as Record<string, number>)),
    ]);
    const assignments = tasks
      .filter(task => !status || status === 'all' || task.status === status)
      .filter(task => !course || (task.course || '').toLowerCase().includes(course))
      .filter(task => !activity || (task.activity || '').toLowerCase() === activity)
      .filter(task => { const due = new Date(task.dueDate); return (!from || due >= from) && (!to || due <= to); })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, limit)
      .map(task => ({
        id: task.id, title: task.title, course: task.course ?? null, courseId: task.courseId ?? null, dueDate: task.dueDate, status: task.status,
        estimatedMinutes: task.estimatedMinutes ?? null, estimateOrigin: task.estimateOrigin ?? null, priority: task.priority ?? null, notes: task.notes ?? null,
        tags: task.tags ?? [], activity: task.activity ?? null, pagesRead: task.pagesRead ?? null, term: task.term ?? null, noteCount: noteCounts[task.id] || 0,
        ...(task.activity === 'reading' || task.originalPageRanges || task.remainingPageRanges ? readingMetrics(task, sessions, courses) : {}),
      }));
    return noStoreJson({ assignments, count: assignments.length });
  } catch (error) {
    console.error('[gpt/assignments]', error);
    return noStoreJson({ error: 'Unable to load assignments. Try again shortly.' }, { status: 500 });
  }
}
''')

write("app/api/gpt/overview/route.ts", r'''
import { NextRequest } from 'next/server';
import { ensureSchema, getGptPool, listCourses, listSessions, listTasks } from '@/lib/storage';
import { countNotesByTask, hybridSearchAiNotes, listNotebooks } from '@/lib/aiNotes';
import { notesGptDb } from '@/lib/notes/db';
import { readingMetrics } from '@/lib/reading';
import { noStoreJson, requireGptToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

export async function GET(req: NextRequest) {
  const denied = requireGptToken(req); if (denied) return denied;
  try {
    await ensureSchema();
    const days = boundedInteger(req.nextUrl.searchParams.get('days'), 14, 1, 60);
    const recentLimit = boundedInteger(req.nextUrl.searchParams.get('recentNotes'), 8, 1, 20);
    const now = new Date(); const horizon = new Date(now.getTime() + days * 864e5); const sevenDaysAgo = new Date(now.getTime() - 7 * 864e5);
    const gptPool = getGptPool(); const notePool = notesGptDb();
    const [courses, tasks, sessions, notebooks, noteCounts, recentNotes] = await Promise.all([
      listCourses(gptPool), listTasks(gptPool), listSessions(gptPool), listNotebooks(false, notePool), countNotesByTask(notePool).catch(() => ({} as Record<string, number>)), hybridSearchAiNotes('', { sort: 'recent', limit: recentLimit }, notePool),
    ]);
    const taskById = new Map(tasks.map(task => [String(task.id), task]));
    const summarizeTask = (task: any) => ({
      id: task.id, title: task.title, course: task.course ?? null, courseId: task.courseId ?? null, dueDate: task.dueDate, status: task.status,
      estimatedMinutes: task.estimatedMinutes ?? null, estimateOrigin: task.estimateOrigin ?? null, priority: task.priority ?? null, activity: task.activity ?? null,
      pagesRead: task.pagesRead ?? null, tags: task.tags ?? [], noteCount: noteCounts[String(task.id)] || 0,
      ...(task.activity === 'reading' || task.originalPageRanges || task.remainingPageRanges ? readingMetrics(task, sessions, courses) : {}),
    });
    const openTasks = tasks.filter(task => task.status !== 'done');
    const upcomingAssignments = openTasks.filter(task => { const due = new Date(task.dueDate); return !Number.isNaN(due.getTime()) && due >= now && due <= horizon; }).sort((a,b)=>+new Date(a.dueDate)-+new Date(b.dueDate)).map(summarizeTask);
    const overdueAssignments = openTasks.filter(task => { const due = new Date(task.dueDate); return !Number.isNaN(due.getTime()) && due < now; }).sort((a,b)=>+new Date(a.dueDate)-+new Date(b.dueDate)).map(summarizeTask);
    const recentSessions = sessions.filter(session => { const when = new Date(session.when); return !Number.isNaN(when.getTime()) && when >= sevenDaysAgo && when <= now; });
    const studyByCourse = new Map<string, { minutes: number; sessions: number; practiceQs: number; pagesRead: number }>();
    for (const session of recentSessions) {
      const task = session.taskId ? taskById.get(String(session.taskId)) : null; const course = task?.course || 'Unlinked';
      const current = studyByCourse.get(course) || { minutes:0, sessions:0, practiceQs:0, pagesRead:0 };
      current.minutes += Number(session.minutes)||0; current.sessions += 1; current.practiceQs += Number(session.practiceQs)||0; current.pagesRead += Number(session.pagesRead)||0; studyByCourse.set(course,current);
    }
    const scored = recentSessions.filter(session => typeof session.focus === 'number'); const totalMinutes = recentSessions.reduce((sum,s)=>sum+(Number(s.minutes)||0),0);
    const openReadings = openTasks.filter(task => task.activity === 'reading' || task.originalPageRanges || task.remainingPageRanges).map(task => summarizeTask(task));
    return noStoreJson({
      generatedAt: now.toISOString(), planningHorizonDays: days,
      semesters: Array.from(new Set([...courses.map(c=>c.semester).filter(Boolean), ...notebooks.map(n=>n.semester).filter(Boolean)])),
      courses: courses.map(course => ({ id:course.id, code:course.code??null, title:course.title, instructor:course.instructor??null, semester:course.semester??null, year:course.year??null, startDate:course.startDate??null, endDate:course.endDate??null })),
      upcomingAssignments, overdueAssignments, openReadings,
      notebooks: notebooks.map(notebook => ({ id:notebook.id, name:notebook.name, course:notebook.course, semester:notebook.semester, pageCount:notebook.noteCount })), recentNotes,
      studyLast7Days: { totalMinutes, totalHours: Math.round((totalMinutes/60)*10)/10, sessionCount: recentSessions.length, averageFocus: scored.length ? Math.round((scored.reduce((sum,s)=>sum+Number(s.focus),0)/scored.length)*10)/10 : null, byCourse:Array.from(studyByCourse.entries()).map(([course,totals])=>({course,...totals})).sort((a,b)=>b.minutes-a.minutes) },
    });
  } catch (error) {
    console.error('[gpt/overview]', error); return noStoreJson({ error: 'Unable to build the workspace overview. Try again shortly.' }, { status: 500 });
  }
}
''')

write("tests/reading-tracker.test.mjs", r'''
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/app.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });
beforeEach(async () => { await app.reset(); });

async function course() {
  return (await app.api('POST', '/api/courses', { title: 'Evidence', code: 'LAW 7191', semester: 'Fall', year: 2026, overrideEnabled: true, overrideMpp: 2 })).body.course;
}

async function reading() {
  await course();
  return (await app.api('POST', '/api/tasks', { title: 'Read pp. 100-150', course: 'Evidence', dueDate: new Date(Date.now() + 3 * 864e5).toISOString(), activity: 'reading', estimatedMinutes: 102 })).body.task;
}

describe('reading tracker v2', () => {
  it('stores page ranges and the real course relationship on creation', async () => {
    const task = await reading();
    assert.equal(task.originalPageRanges, '100–150');
    assert.equal(task.remainingPageRanges, '100–150');
    assert.equal(task.pagesRead, 51);
    assert.ok(task.courseId, 'courseId is persisted');
  });

  it('records partial progress atomically and keeps exact remaining pages', async () => {
    const task = await reading();
    const res = await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'partial', minutes: 40, focus: 7, pagesCompleted: '100-119' });
    assert.equal(res.status, 200);
    assert.equal(res.body.task.remainingPageRanges, '120–150');
    assert.equal(res.body.reading.completedPages, 20);
    assert.equal(res.body.reading.remainingPages, 31);
    const sessions = (await app.api('GET', '/api/sessions')).body.sessions.filter(s => s.taskId === task.id);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].pagesRead, 20);
  });

  it('rejects pages outside the remaining assignment without writing a session', async () => {
    const task = await reading();
    const res = await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'partial', minutes: 10, focus: 5, pagesCompleted: '90-99' });
    assert.equal(res.status, 400);
    const sessions = (await app.api('GET', '/api/sessions')).body.sessions.filter(s => s.taskId === task.id);
    assert.equal(sessions.length, 0);
  });

  it('finishes a reading, clears remaining pages, and removes planned blocks', async () => {
    const task = await reading();
    await app.api('PUT', '/api/schedule', { blocks: [{ id:'block-1', taskId:task.id, day:new Date().toISOString().slice(0,10), plannedMinutes:60, title:task.title, course:'Evidence' }] });
    const res = await app.api('POST', `/api/tasks/${task.id}/progress`, { mode: 'finish', minutes: 90, focus: 8 });
    assert.equal(res.status, 200);
    assert.equal(res.body.task.status, 'done');
    assert.equal(res.body.task.remainingPageRanges, null);
    assert.equal((await app.api('GET', '/api/schedule')).body.blocks.filter(b => b.taskId === task.id).length, 0);
  });

  it('builds a reading dashboard and exposes linked note categories', async () => {
    const task = await reading();
    const notebook = (await app.api('POST', '/api/notes/notebooks', { name:'Evidence', course:'Evidence', semester:'Fall 2026' })).body.notebook;
    const briefs = (await app.api('POST', '/api/notes/sections', { notebookId:notebook.id, name:'Case Briefs' })).body.section;
    await app.api('POST', '/api/notes', { notebookId:notebook.id, sectionId:briefs.id, title:'Old Chief', content:'Rule 403', sourceType:'case-brief', taskId:task.id });
    const overview = await app.api('GET', '/api/reading/overview');
    const found = overview.body.readings.find(r => r.id === task.id);
    assert.equal(found.caseBriefCount, 1);
    assert.equal(found.assignedPages, 51);
  });

  it('smart-splits remaining pages into schedule blocks before the due date', async () => {
    const task = await reading();
    const split = await app.api('POST', `/api/tasks/${task.id}/smart-split`, {});
    assert.equal(split.status, 200);
    assert.ok(split.body.plan.length >= 1);
    const total = split.body.plan.reduce((sum, block) => sum + block.pages, 0);
    assert.equal(total, 51);
    const blocks = (await app.api('GET', '/api/schedule')).body.blocks.filter(b => b.taskId === task.id);
    assert.equal(blocks.length, split.body.plan.length);
  });

  it('gives the GPT exact reading progress for study planning', async () => {
    const task = await reading();
    await app.api('POST', `/api/tasks/${task.id}/progress`, { mode:'partial', minutes:30, focus:6, pagesCompleted:'100-109' });
    const { body } = await app.gpt('/api/gpt/assignments?activity=reading&status=all');
    const found = body.assignments.find(a => a.id === task.id);
    assert.equal(found.originalPageRanges, '100–150');
    assert.equal(found.remainingPageRanges, '110–150');
    assert.equal(found.assignedPages, 51);
    assert.equal(found.completedPages, 10);
    assert.equal(found.loggedMinutes, 30);
    assert.equal(typeof found.estimatedMinutesRemaining, 'number');
    const overview = await app.gpt('/api/gpt/overview');
    assert.ok(overview.body.openReadings.some(r => r.id === task.id));
  });
});
''')

# Route-level schema-order hardening: ensure courses exists before adding the FK.
p = ROOT / "lib/storage.ts"
text = p.read_text(encoding="utf-8")
old = """    // Real reference to courses(id), so renaming a course doesn't orphan its\n    // tasks the way matching on the free-text `course` label used to.\n    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES courses(id) ON DELETE SET NULL`,\n    `CREATE TABLE IF NOT EXISTS courses ("""
new = """    `CREATE TABLE IF NOT EXISTS courses ("""
if old not in text:
    raise RuntimeError("storage schema course ordering anchor missing")
text = text.replace(old, new, 1)
anchor = """     )`,\n    `ALTER TABLE courses ADD COLUMN IF NOT EXISTS meeting_blocks jsonb`,"""
replacement = """     )`,\n    // Real reference to courses(id), after courses exists, so fresh databases\n    // get the FK in the same schema pass instead of waiting for another boot.\n    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES courses(id) ON DELETE SET NULL`,\n    `ALTER TABLE courses ADD COLUMN IF NOT EXISTS meeting_blocks jsonb`,"""
if anchor not in text:
    raise RuntimeError("storage schema post-course anchor missing")
text = text.replace(anchor, replacement, 1)
p.write_text(text, encoding="utf-8")

# Make the existing task completion modal use the atomic progress endpoint.
p = ROOT / "components/TaskTable.tsx"
text = p.read_text(encoding="utf-8")
pattern = r"  async function handleLogSubmit\(data: LogSubmitData\) \{.*?\n  \}\n\n  async function toggleDone"
replacement = r'''  async function handleLogSubmit(data: LogSubmitData) {
    if (!logModalTask) return;
    const t = logModalTask;
    try {
      await apiFetch(`/api/tasks/${t.id}/progress`, { method: 'POST', body: {
        mode: data.isPartial ? 'partial' : 'finish',
        minutes: data.minutes,
        focus: data.focus,
        notes: data.notes || null,
        pagesCompleted: data.pagesCompleted || null,
        moveToDay: data.moveToDay || null,
        completionDate: data.completionDate || null,
      }});
      try { notifyTasksChanged(); notifySessionsChanged(); } catch {}
      try { notifyToast({ kind: 'success', message: data.isPartial ? 'Progress logged.' : 'Task completed.' }); } catch {}
      clearTimerFor(t.id);
      setLogModalOpen(false);
      setLogModalTask(null);
      await refresh();
      await refreshSessions();
    } catch (error: any) {
      try { notifyToast({ kind: 'error', message: error?.message || 'Unable to record progress.' }); } catch {}
    }
  }

  async function toggleDone'''
new_text, n = re.subn(pattern, replacement, text, count=1, flags=re.S)
if n != 1:
    raise RuntimeError(f"TaskTable progress handler replacement failed: {n}")
p.write_text(new_text, encoding="utf-8")

# Ensure the normal Add Task flow sends the structured course and reading range.
p = ROOT / "components/AddTaskPanel.tsx"
text = p.read_text(encoding="utf-8")
old = """        course: course || null,\n        dueDate: new Date(due).toISOString(),\n        status: 'todo',\n        estimatedMinutes: est || null,\n        estimateOrigin: estimateOrigin || null,\n        pagesRead: activity==='reading' ? (pages||null) : null,\n        activity: activity || null,"""
new = """        course: course || null,\n        courseId: courseId || null,\n        dueDate: new Date(due).toISOString(),\n        status: 'todo',\n        estimatedMinutes: est || null,\n        estimateOrigin: estimateOrigin || null,\n        pagesRead: activity==='reading' ? (pages||null) : null,\n        activity: activity || null,\n        originalPageRanges: activity==='reading' && parsed.valid && parsed.normLabel ? parsed.normLabel : null,\n        remainingPageRanges: activity==='reading' && parsed.valid && parsed.normLabel ? parsed.normLabel : null,"""
if old not in text:
    raise RuntimeError("AddTaskPanel payload anchor missing")
text = text.replace(old, new, 1)
p.write_text(text, encoding="utf-8")

# OpenAPI: advertise reading progress fields and the activity filter.
p = ROOT / "app/api/gpt/openapi/route.ts"
text = p.read_text(encoding="utf-8")
text = text.replace("version: '2.0.0'", "version: '2.1.0'", 1)
text = text.replace("'For study planning, begin with getWorkspaceOverview, then inspect upcoming assignments and relevant notes.", "'For study planning, begin with getWorkspaceOverview, then inspect upcoming assignments, openReadings, exact remaining page ranges, pace, and relevant notes.", 1)
needle = """            { name: 'course', in: 'query', description: 'Case-insensitive partial course-title match.', schema: { type: 'string' } },\n            { name: 'from', in: 'query', description: 'Inclusive ISO date or datetime.', schema: { type: 'string' } },"""
repl = """            { name: 'course', in: 'query', description: 'Case-insensitive partial course-title match.', schema: { type: 'string' } },\n            { name: 'activity', in: 'query', description: 'Restrict assignments to an activity such as reading, review, outline, or practice.', schema: { type: 'string' } },\n            { name: 'from', in: 'query', description: 'Inclusive ISO date or datetime.', schema: { type: 'string' } },"""
if needle not in text:
    raise RuntimeError("OpenAPI assignment parameter anchor missing")
text = text.replace(needle, repl, 1)
old = """            id: { type: 'string' }, title: { type: 'string' }, course: { type: ['string', 'null'] }, dueDate: { type: 'string' },\n            status: { type: 'string', enum: ['todo', 'done'] }, estimatedMinutes: { type: ['integer', 'null'] }, priority: { type: ['integer', 'null'] },\n            notes: { type: ['string', 'null'] }, tags: { type: 'array', items: { type: 'string' } }, activity: { type: ['string', 'null'] },\n            pagesRead: { type: ['integer', 'null'] }, term: { type: ['string', 'null'] }, noteCount: { type: 'integer' },"""
new = """            id: { type: 'string' }, title: { type: 'string' }, course: { type: ['string', 'null'] }, courseId: { type: ['string', 'null'] }, dueDate: { type: 'string' },\n            status: { type: 'string', enum: ['todo', 'done'] }, estimatedMinutes: { type: ['integer', 'null'] }, estimateOrigin: { type: ['string', 'null'] }, priority: { type: ['integer', 'null'] },\n            notes: { type: ['string', 'null'] }, tags: { type: 'array', items: { type: 'string' } }, activity: { type: ['string', 'null'] },\n            pagesRead: { type: ['integer', 'null'] }, term: { type: ['string', 'null'] }, noteCount: { type: 'integer' },\n            originalPageRanges: { type: ['string', 'null'] }, remainingPageRanges: { type: ['string', 'null'] },\n            assignedPages: { type: 'integer' }, completedPages: { type: 'integer' }, remainingPages: { type: 'integer' }, percentComplete: { type: 'integer' },\n            loggedMinutes: { type: 'integer' }, estimatedMinutesRemaining: { type: 'integer' }, paceMinutesPerPage: { type: 'number' }, paceSource: { type: 'string', enum: ['override', 'learned', 'default'] },"""
if old not in text:
    raise RuntimeError("OpenAPI Assignment schema anchor missing")
text = text.replace(old, new, 1)
old = """            upcomingAssignments: { type: 'array', items: { $ref: '#/components/schemas/Assignment' } },\n            overdueAssignments: { type: 'array', items: { $ref: '#/components/schemas/Assignment' } },"""
new = """            upcomingAssignments: { type: 'array', items: { $ref: '#/components/schemas/Assignment' } },\n            overdueAssignments: { type: 'array', items: { $ref: '#/components/schemas/Assignment' } },\n            openReadings: { type: 'array', items: { $ref: '#/components/schemas/Assignment' } },"""
if old not in text:
    raise RuntimeError("OpenAPI WorkspaceOverview anchor missing")
text = text.replace(old, new, 1)
p.write_text(text, encoding="utf-8")

# The Task type already declared progress fields; clarify pagesRead's role on tasks.
p = ROOT / "lib/types.ts"
text = p.read_text(encoding="utf-8")
text = text.replace("pagesRead?: number | null; // pages read for this task", "pagesRead?: number | null; // assigned page count for reading tasks; session.pagesRead records actual pages completed", 1)
p.write_text(text, encoding="utf-8")

# Remove this one-shot script and workflow from the resulting branch diff.
(ROOT / "scripts/apply_reading_tracker_v2.py").unlink(missing_ok=True)
(ROOT / ".github/workflows/apply-reading-v2.yml").unlink(missing_ok=True)
