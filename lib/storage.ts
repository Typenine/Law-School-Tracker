import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { randomUUID as nodeRandomUUID } from 'crypto';
import { NewSessionInput, NewTaskInput, StudySession, Task, UpdateTaskInput } from './types';

const DB_URL = process.env.DATABASE_URL;
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'law-school-tracker') : path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

let pool: Pool | null = null;
function getPool(): Pool {
  if (!DB_URL) throw new Error('No DATABASE_URL');
  if (!pool) {
    pool = new Pool({ connectionString: DB_URL, ssl: DB_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  }
  return pool;
}

export async function ensureSchema() {
  if (!DB_URL) return; // JSON mode doesn't need schema
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id uuid PRIMARY KEY,
      title text NOT NULL,
      course text,
      due_date timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'todo',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_minutes integer;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority integer;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes text;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachments jsonb;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on uuid[];
    CREATE TABLE IF NOT EXISTS sessions (
      id uuid PRIMARY KEY,
      task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
      when_ts timestamptz NOT NULL DEFAULT now(),
      minutes integer NOT NULL,
      focus integer,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

function uuid() {
  return (globalThis as any).crypto?.randomUUID?.() || nodeRandomUUID();
}

async function readJson(): Promise<{ tasks: Task[]; sessions: StudySession[] }> {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      const empty = { tasks: [], sessions: [] };
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(empty, null, 2), 'utf8');
      return empty;
    }
    throw e;
  }
}

async function writeJson(data: { tasks: Task[]; sessions: StudySession[] }) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Tasks
export async function listTasks(): Promise<Task[]> {
  if (DB_URL) {
    const p = getPool();
    type TaskRow = { id: string; title: string; course: string | null; due_date: Date | string; status: 'todo' | 'done'; created_at: Date | string; estimated_minutes: number | null; priority: number | null; notes: string | null; attachments: string[] | null; depends_on: string[] | null };
    const res = await p.query(`SELECT id, title, course, due_date, status, created_at, estimated_minutes, priority, notes, attachments, depends_on FROM tasks ORDER BY due_date ASC`);
    const rows = res.rows as unknown as TaskRow[];
    return rows.map(r => ({
      id: r.id,
      title: r.title,
      course: r.course,
      dueDate: new Date(r.due_date).toISOString(),
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      estimatedMinutes: r.estimated_minutes ?? null,
      priority: r.priority ?? null,
      notes: r.notes ?? null,
      attachments: (r.attachments as any) ?? null,
      dependsOn: (r.depends_on as any) ?? null,
    }));
  }
  const db = await readJson();
  return db.tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export async function createTask(input: NewTaskInput): Promise<Task> {
  const now = new Date().toISOString();
  if (DB_URL) {
    const p = getPool();
    const id = uuid();
    const res = await p.query(
      `INSERT INTO tasks (id, title, course, due_date, status, created_at, estimated_minutes, priority, notes, attachments, depends_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, title, course, due_date, status, created_at, estimated_minutes, priority, notes, attachments, depends_on`,
      [id, input.title, input.course ?? null, new Date(input.dueDate), input.status ?? 'todo', new Date(now), input.estimatedMinutes ?? null, input.priority ?? null, input.notes ?? null, input.attachments ?? null, input.dependsOn ?? null]
    );
    const r = res.rows[0];
    return { id: r.id, title: r.title, course: r.course, dueDate: new Date(r.due_date).toISOString(), status: r.status, createdAt: new Date(r.created_at).toISOString(), estimatedMinutes: r.estimated_minutes ?? null, priority: r.priority ?? null, notes: r.notes ?? null, attachments: r.attachments ?? null, dependsOn: r.depends_on ?? null };
  }
  const db = await readJson();
  const task: Task = { id: uuid(), title: input.title, course: input.course ?? null, dueDate: input.dueDate, status: input.status ?? 'todo', createdAt: now, estimatedMinutes: input.estimatedMinutes ?? null, priority: input.priority ?? null, notes: input.notes ?? null, attachments: input.attachments ?? null, dependsOn: input.dependsOn ?? null };
  db.tasks.push(task);
  await writeJson(db);
  return task;
}

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<Task | null> {
  if (DB_URL) {
    const p = getPool();
    // Build dynamic update
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (patch.title !== undefined) { fields.push(`title = $${idx++}`); values.push(patch.title); }
    if (patch.course !== undefined) { fields.push(`course = $${idx++}`); values.push(patch.course); }
    if (patch.dueDate !== undefined) { fields.push(`due_date = $${idx++}`); values.push(new Date(patch.dueDate)); }
    if (patch.status !== undefined) { fields.push(`status = $${idx++}`); values.push(patch.status); }
    if (patch.estimatedMinutes !== undefined) { fields.push(`estimated_minutes = $${idx++}`); values.push(patch.estimatedMinutes); }
    if (patch.priority !== undefined) { fields.push(`priority = $${idx++}`); values.push(patch.priority); }
    if (patch.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(patch.notes); }
    if (patch.attachments !== undefined) { fields.push(`attachments = $${idx++}`); values.push(patch.attachments); }
    if (patch.dependsOn !== undefined) { fields.push(`depends_on = $${idx++}`); values.push(patch.dependsOn); }
    if (!fields.length) {
      const cur = await p.query(`SELECT id, title, course, due_date, status, created_at, estimated_minutes, priority, notes, attachments, depends_on FROM tasks WHERE id=$1`, [id]);
      if (!cur.rowCount) return null;
      const r = cur.rows[0];
      return { id: r.id, title: r.title, course: r.course, dueDate: new Date(r.due_date).toISOString(), status: r.status, createdAt: new Date(r.created_at).toISOString(), estimatedMinutes: r.estimated_minutes ?? null, priority: r.priority ?? null, notes: r.notes ?? null, attachments: r.attachments ?? null, dependsOn: r.depends_on ?? null };
    }
    const q = `UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, title, course, due_date, status, created_at, estimated_minutes, priority, notes, attachments, depends_on`;
    values.push(id);
    const res = await p.query(q, values);
    if (!res.rowCount) return null;
    const r = res.rows[0];
    return { id: r.id, title: r.title, course: r.course, dueDate: new Date(r.due_date).toISOString(), status: r.status, createdAt: new Date(r.created_at).toISOString(), estimatedMinutes: r.estimated_minutes ?? null, priority: r.priority ?? null, notes: r.notes ?? null, attachments: r.attachments ?? null, dependsOn: r.depends_on ?? null };
  }
  const db = await readJson();
  const i = db.tasks.findIndex(t => t.id === id);
  if (i === -1) return null;
  const updated: Task = { ...db.tasks[i], ...patch } as Task;
  db.tasks[i] = updated;
  await writeJson(db);
  return updated;
}

export async function deleteTask(id: string): Promise<boolean> {
  if (DB_URL) {
    const p = getPool();
    const res = await p.query(`DELETE FROM tasks WHERE id=$1`, [id]);
    return res.rowCount > 0;
  }
  const db = await readJson();
  const before = db.tasks.length;
  db.tasks = db.tasks.filter(t => t.id !== id);
  await writeJson(db);
  return db.tasks.length < before;
}

// Sessions
export async function listSessions(): Promise<StudySession[]> {
  if (DB_URL) {
    const p = getPool();
    type SessionRow = { id: string; task_id: string | null; when_ts: Date | string; minutes: number; focus: number | null; notes: string | null; created_at: Date | string };
    const res = await p.query(`SELECT id, task_id, when_ts, minutes, focus, notes, created_at FROM sessions ORDER BY when_ts DESC`);
    const rows = res.rows as unknown as SessionRow[];
    return rows.map(r => ({ id: r.id, taskId: r.task_id, when: new Date(r.when_ts).toISOString(), minutes: r.minutes, focus: r.focus, notes: r.notes, createdAt: new Date(r.created_at).toISOString() }));
  }
  const db = await readJson();
  return db.sessions.sort((a, b) => b.when.localeCompare(a.when));
}

export async function createSession(input: NewSessionInput): Promise<StudySession> {
  const now = new Date().toISOString();
  const whenISO = input.when ?? now;
  if (DB_URL) {
    const p = getPool();
    const id = uuid();
    const res = await p.query(
      `INSERT INTO sessions (id, task_id, when_ts, minutes, focus, notes, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, task_id, when_ts, minutes, focus, notes, created_at`,
      [id, input.taskId ?? null, new Date(whenISO), input.minutes, input.focus ?? null, input.notes ?? null, new Date(now)]
    );
    const r = res.rows[0];
    return { id: r.id, taskId: r.task_id, when: new Date(r.when_ts).toISOString(), minutes: r.minutes, focus: r.focus, notes: r.notes, createdAt: new Date(r.created_at).toISOString() };
  }
  const db = await readJson();
  const s: StudySession = { id: uuid(), taskId: input.taskId ?? null, when: whenISO, minutes: input.minutes, focus: input.focus ?? null, notes: input.notes ?? null, createdAt: now };
  db.sessions.unshift(s);
  await writeJson(db);
  return s;
}

export async function statsNow() {
  const tasks = await listTasks();
  const sessions = await listSessions();
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcoming7d = tasks.filter(t => new Date(t.dueDate) >= now && new Date(t.dueDate) <= in7 && t.status !== 'done').length;

  // Week boundaries (Mon-Sun)
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7; // 0 => Monday
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - diffToMonday);

  const weekSessions = sessions.filter(s => new Date(s.when) >= monday);
  const totalMinutes = weekSessions.reduce((acc, s) => acc + (s.minutes || 0), 0);
  const hoursThisWeek = Math.round((totalMinutes / 60) * 10) / 10;
  const focusVals = weekSessions.map(s => s.focus).filter((n): n is number => typeof n === 'number');
  const avgFocusThisWeek = focusVals.length ? Math.round((focusVals.reduce((a, b) => a + b, 0) / focusVals.length) * 10) / 10 : null;

  // Burndown: estimated minutes for TODO tasks due by end of this week
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const weekTodos = tasks.filter(t => t.status !== 'done' && new Date(t.dueDate) >= monday && new Date(t.dueDate) <= sunday);
  const estMinutesThisWeek = weekTodos.reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);
  const loggedMinutesThisWeek = totalMinutes;
  const remainingMinutesThisWeek = Math.max(0, estMinutesThisWeek - loggedMinutesThisWeek);

  // Per-course breakdown
  const byCourseEst = new Map<string | null, number>();
  for (const t of weekTodos) {
    const k = t.course ?? null;
    byCourseEst.set(k, (byCourseEst.get(k) || 0) + (t.estimatedMinutes || 0));
  }
  const taskById = new Map(tasks.map(t => [t.id, t] as const));
  const byCourseLogged = new Map<string | null, number>();
  for (const s of weekSessions) {
    const task = s.taskId ? taskById.get(s.taskId) : undefined;
    const k = task?.course ?? null;
    byCourseLogged.set(k, (byCourseLogged.get(k) || 0) + (s.minutes || 0));
  }
  const courseKeys = new Set([...byCourseEst.keys(), ...byCourseLogged.keys()]);
  const courseBreakdown = [...courseKeys].map(course => {
    const est = byCourseEst.get(course) || 0;
    const logged = byCourseLogged.get(course) || 0;
    const remaining = Math.max(0, est - logged);
    return { course, estMinutes: est, loggedMinutes: logged, remainingMinutes: remaining };
  }).sort((a, b) => (b.remainingMinutes - a.remainingMinutes));

  // Daily estimate forecast (next 7 days from today)
  const start = new Date(now); start.setHours(0,0,0,0);
  const daily: Array<{ date: string; estMinutes: number }> = [];
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const end = new Date(d); end.setHours(23,59,59,999);
    const est = tasks
      .filter(t => t.status !== 'done')
      .filter(t => { const due = new Date(t.dueDate); return due >= d && due <= end; })
      .reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);
    daily.push({ date: dayKey(d), estMinutes: est });
  }
  const maxDayMinutes = daily.reduce((m, x) => Math.max(m, x.estMinutes), 0);
  const heavyDays = daily.filter(x => x.estMinutes >= 240).length; // 4+ hrs considered heavy

  return { upcoming7d, hoursThisWeek, avgFocusThisWeek, estMinutesThisWeek, loggedMinutesThisWeek, remainingMinutesThisWeek, courseBreakdown, dailyEst: daily, heavyDays, maxDayMinutes };
}
