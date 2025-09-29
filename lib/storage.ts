import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { randomUUID as nodeRandomUUID } from 'crypto';
import { NewSessionInput, NewTaskInput, StudySession, Task, UpdateTaskInput } from './types';

const DB_URL = process.env.DATABASE_URL;
const DATA_FILE = path.join(process.cwd(), 'data', 'db.json');

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
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Tasks
export async function listTasks(): Promise<Task[]> {
  if (DB_URL) {
    const p = getPool();
    type TaskRow = { id: string; title: string; course: string | null; due_date: Date | string; status: 'todo' | 'done'; created_at: Date | string; estimated_minutes: number | null };
    const res = await p.query(`SELECT id, title, course, due_date, status, created_at, estimated_minutes FROM tasks ORDER BY due_date ASC`);
    const rows = res.rows as unknown as TaskRow[];
    return rows.map(r => ({
      id: r.id,
      title: r.title,
      course: r.course,
      dueDate: new Date(r.due_date).toISOString(),
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      estimatedMinutes: r.estimated_minutes ?? null,
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
      `INSERT INTO tasks (id, title, course, due_date, status, created_at, estimated_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, title, course, due_date, status, created_at, estimated_minutes`,
      [id, input.title, input.course ?? null, new Date(input.dueDate), input.status ?? 'todo', new Date(now), input.estimatedMinutes ?? null]
    );
    const r = res.rows[0];
    return { id: r.id, title: r.title, course: r.course, dueDate: new Date(r.due_date).toISOString(), status: r.status, createdAt: new Date(r.created_at).toISOString(), estimatedMinutes: r.estimated_minutes ?? null };
  }
  const db = await readJson();
  const task: Task = { id: uuid(), title: input.title, course: input.course ?? null, dueDate: input.dueDate, status: input.status ?? 'todo', createdAt: now, estimatedMinutes: input.estimatedMinutes ?? null };
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
    if (!fields.length) {
      const cur = await p.query(`SELECT id, title, course, due_date, status, created_at, estimated_minutes FROM tasks WHERE id=$1`, [id]);
      if (!cur.rowCount) return null;
      const r = cur.rows[0];
      return { id: r.id, title: r.title, course: r.course, dueDate: new Date(r.due_date).toISOString(), status: r.status, createdAt: new Date(r.created_at).toISOString(), estimatedMinutes: r.estimated_minutes ?? null };
    }
    const q = `UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, title, course, due_date, status, created_at, estimated_minutes`;
    values.push(id);
    const res = await p.query(q, values);
    if (!res.rowCount) return null;
    const r = res.rows[0];
    return { id: r.id, title: r.title, course: r.course, dueDate: new Date(r.due_date).toISOString(), status: r.status, createdAt: new Date(r.created_at).toISOString(), estimatedMinutes: r.estimated_minutes ?? null };
  }
  const db = await readJson();
  const i = db.tasks.findIndex(t => t.id === id);
  if (i === -1) return null;
  const updated: Task = { ...db.tasks[i], ...patch };
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

  return { upcoming7d, hoursThisWeek, avgFocusThisWeek };
}
