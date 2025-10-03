import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { randomUUID as nodeRandomUUID } from 'crypto';
import { Course, NewCourseInput, NewSessionInput, NewTaskInput, StudySession, Task, UpdateCourseInput, UpdateTaskInput } from './types';

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

// Courses
export async function listCourses(): Promise<Course[]> {
  let results: Course[] = [];
  if (DB_URL) {
    try {
      const p = getPool();
      type Row = {
        id: string; code: string | null; title: string; instructor: string | null; instructor_email: string | null; room: string | null; location: string | null;
        meeting_days: number[] | null; meeting_start: string | null; meeting_end: string | null; meeting_blocks: any | null; start_date: Date | string | null; end_date: Date | string | null;
        semester: string | null; year: number | null; created_at: Date | string
      };
      const res = await p.query(`SELECT id, code, title, instructor, instructor_email, room, location, color, meeting_days, meeting_start, meeting_end, meeting_blocks, start_date, end_date, semester, year, created_at FROM courses ORDER BY title`);
      results = (res.rows as Row[]).map(r => ({
        id: r.id, code: r.code, title: r.title, instructor: r.instructor, instructorEmail: r.instructor_email, room: r.room, location: r.location,
        color: (r as any).color ?? null,
        meetingDays: (r.meeting_days as any) ?? null, meetingStart: r.meeting_start, meetingEnd: r.meeting_end, meetingBlocks: (r.meeting_blocks as any) ?? null,
        startDate: r.start_date ? new Date(r.start_date).toISOString() : null, endDate: r.end_date ? new Date(r.end_date).toISOString() : null,
        semester: (r.semester as any) ?? null, year: r.year ?? null, createdAt: new Date(r.created_at as any).toISOString()
      }));
    } catch (e) {
      console.warn('listCourses: DB query failed, will use JSON store as well:', (e as any)?.message || e);
    }
  }
  // Always merge JSON courses (useful when DB is empty locally)
  try {
    const json = await readJson();
    const byId = new Map(results.map(c => [c.id, true] as const));
    for (const c of json.courses) {
      if (!byId.has(c.id)) results.push(c);
    }
  } catch { /* ignore */ }
  return results.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

export async function createCourse(input: NewCourseInput): Promise<Course> {
  const now = new Date().toISOString();
  if (DB_URL) {
    try {
      const p = getPool();
      const id = uuid();
      const res = await p.query(
        `INSERT INTO courses (id, code, title, instructor, instructor_email, room, location, color, meeting_days, meeting_start, meeting_end, meeting_blocks, start_date, end_date, semester, year, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id, code, title, instructor, instructor_email, room, location, color, meeting_days, meeting_start, meeting_end, meeting_blocks, start_date, end_date, semester, year, created_at`,
        [id, input.code ?? null, input.title, input.instructor ?? null, input.instructorEmail ?? null, input.room ?? null, input.location ?? null, (input as any).color ?? null, input.meetingDays ?? null, input.meetingStart ?? null, input.meetingEnd ?? null, input.meetingBlocks ?? null, input.startDate ? new Date(input.startDate) : null, input.endDate ? new Date(input.endDate) : null, input.semester ?? null, input.year ?? null, new Date(now)]
      );
      const r = res.rows[0];
      return {
        id: r.id, code: r.code, title: r.title, instructor: r.instructor, instructorEmail: r.instructor_email, room: r.room, location: r.location, color: r.color ?? null,
        meetingDays: r.meeting_days ?? null, meetingStart: r.meeting_start, meetingEnd: r.meeting_end, meetingBlocks: r.meeting_blocks ?? null,
        startDate: r.start_date ? new Date(r.start_date).toISOString() : null, endDate: r.end_date ? new Date(r.end_date).toISOString() : null,
        semester: r.semester ?? null, year: r.year ?? null, createdAt: new Date(r.created_at).toISOString()
      };
    } catch (e) {
      console.warn('createCourse: Postgres insert failed, falling back to JSON store:', (e as any)?.message || e);
      // Fall through to JSON implementation
    }
  }
  const db = await readJson();
  const c: Course = {
    id: uuid(), code: input.code ?? null, title: input.title, instructor: input.instructor ?? null, instructorEmail: input.instructorEmail ?? null,
    room: input.room ?? null, location: input.location ?? null, color: (input as any).color ?? null, meetingDays: input.meetingDays ?? null, meetingStart: input.meetingStart ?? null, meetingEnd: input.meetingEnd ?? null, meetingBlocks: input.meetingBlocks ?? null,
    startDate: input.startDate ?? null, endDate: input.endDate ?? null, semester: input.semester ?? null, year: input.year ?? null, createdAt: now
  };
  db.courses.push(c);
  await writeJson(db);
  return c;
}

export async function updateCourse(id: string, patch: UpdateCourseInput): Promise<Course | null> {
  if (DB_URL) {
    const p = getPool();
    const fields: string[] = []; const values: any[] = []; let idx = 1;
    if (patch.code !== undefined) { fields.push(`code = $${idx++}`); values.push(patch.code); }
    if (patch.title !== undefined) { fields.push(`title = $${idx++}`); values.push(patch.title); }
    if (patch.instructor !== undefined) { fields.push(`instructor = $${idx++}`); values.push(patch.instructor); }
    if (patch.instructorEmail !== undefined) { fields.push(`instructor_email = $${idx++}`); values.push(patch.instructorEmail); }
    if (patch.room !== undefined) { fields.push(`room = $${idx++}`); values.push(patch.room); }
    if (patch.location !== undefined) { fields.push(`location = $${idx++}`); values.push(patch.location); }
    if (patch.meetingDays !== undefined) { fields.push(`meeting_days = $${idx++}`); values.push(patch.meetingDays); }
    if (patch.meetingStart !== undefined) { fields.push(`meeting_start = $${idx++}`); values.push(patch.meetingStart); }
    if (patch.meetingEnd !== undefined) { fields.push(`meeting_end = $${idx++}`); values.push(patch.meetingEnd); }
    if (patch.meetingBlocks !== undefined) { fields.push(`meeting_blocks = $${idx++}`); values.push(patch.meetingBlocks as any); }
    if (patch.startDate !== undefined) { fields.push(`start_date = $${idx++}`); values.push(patch.startDate ? new Date(patch.startDate) : null); }
    if (patch.endDate !== undefined) { fields.push(`end_date = $${idx++}`); values.push(patch.endDate ? new Date(patch.endDate) : null); }
    if (patch.semester !== undefined) { fields.push(`semester = $${idx++}`); values.push(patch.semester); }
    if (patch.year !== undefined) { fields.push(`year = $${idx++}`); values.push(patch.year); }
    if (!fields.length) {
      const cur = await p.query(`SELECT id, code, title, instructor, instructor_email, room, location, color, meeting_days, meeting_start, meeting_end, meeting_blocks, start_date, end_date, semester, year, created_at FROM courses WHERE id=$1`, [id]);
      if (!cur.rowCount) return null;
      const r = cur.rows[0];
      return {
        id: r.id, code: r.code, title: r.title, instructor: r.instructor, instructorEmail: r.instructor_email, room: r.room, location: r.location, color: r.color ?? null,
        meetingDays: r.meeting_days ?? null, meetingStart: r.meeting_start, meetingEnd: r.meeting_end, meetingBlocks: r.meeting_blocks ?? null,
        startDate: r.start_date ? new Date(r.start_date).toISOString() : null, endDate: r.end_date ? new Date(r.end_date).toISOString() : null,
        semester: r.semester ?? null, year: r.year ?? null, createdAt: new Date(r.created_at).toISOString()
      };
    }
    const q = `UPDATE courses SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, code, title, instructor, instructor_email, room, location, color, meeting_days, meeting_start, meeting_end, meeting_blocks, start_date, end_date, semester, year, created_at`;
    values.push(id);
    const res = await p.query(q, values);
    if (!res.rowCount) return null;
    const r = res.rows[0];
    return {
      id: r.id, code: r.code, title: r.title, instructor: r.instructor, instructorEmail: r.instructor_email, room: r.room, location: r.location, color: r.color ?? null,
      meetingDays: r.meeting_days ?? null, meetingStart: r.meeting_start, meetingEnd: r.meeting_end, meetingBlocks: r.meeting_blocks ?? null,
      startDate: r.start_date ? new Date(r.start_date).toISOString() : null, endDate: r.end_date ? new Date(r.end_date).toISOString() : null,
      semester: r.semester ?? null, year: r.year ?? null, createdAt: new Date(r.created_at).toISOString()
    };
  }
  const db = await readJson();
  const i = db.courses.findIndex(c => c.id === id);
  if (i === -1) return null;
  const updated: Course = { ...db.courses[i], ...patch } as Course;
  db.courses[i] = updated;
  await writeJson(db);
  return updated;
}

export async function deleteCourse(id: string): Promise<boolean> {
  if (DB_URL) {
    const p = getPool();
    const res = await p.query(`DELETE FROM courses WHERE id=$1`, [id]);
    return res.rowCount > 0;
  }
  const db = await readJson();
  const before = db.courses.length;
  db.courses = db.courses.filter(c => c.id !== id);
  await writeJson(db);
  return db.courses.length < before;
}

export async function ensureSchema() {
  if (!DB_URL) return; // JSON mode doesn't need schema
  try {
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
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags jsonb;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS term text;
      CREATE TABLE IF NOT EXISTS courses (
        id uuid PRIMARY KEY,
        code text,
        title text NOT NULL,
        instructor text,
        instructor_email text,
        room text,
        location text,
        color text,
        meeting_days integer[],
        meeting_start text,
        meeting_end text,
        meeting_blocks jsonb,
        start_date date,
        end_date date,
        semester text,
        year integer,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS meeting_blocks jsonb;
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS color text;
      CREATE TABLE IF NOT EXISTS sessions (
        id uuid PRIMARY KEY,
        task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
        when_ts timestamptz NOT NULL DEFAULT now(),
        minutes integer NOT NULL,
        focus integer,
        notes text,
        pages_read integer,
        outline_pages integer,
        practice_qs integer,
        activity text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  } catch (e) {
    console.warn('ensureSchema: Postgres unavailable, continuing with JSON store:', (e as any)?.message || e);
  }
}

function uuid() {
  return (globalThis as any).crypto?.randomUUID?.() || nodeRandomUUID();
}

async function readJson(): Promise<{ tasks: Task[]; sessions: StudySession[]; courses: Course[] }> {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!('courses' in data)) data.courses = [];
    return data;
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      const empty = { tasks: [], sessions: [], courses: [] };
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(empty, null, 2), 'utf8');
      return empty;
    }
    throw e;
  }
}

async function writeJson(data: { tasks: Task[]; sessions: StudySession[]; courses: Course[] }) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Tasks
export async function listTasks(): Promise<Task[]> {
  if (DB_URL) {
    const p = getPool();
    type TaskRow = { id: string; title: string; course: string | null; due_date: Date | string; status: 'todo' | 'done'; created_at: Date | string; estimated_minutes: number | null; priority: number | null; notes: string | null; attachments: string[] | null; depends_on: string[] | null; tags: string[] | null; term: string | null };
    const res = await p.query(`SELECT id, title, course, due_date, status, created_at, estimated_minutes, priority, notes, attachments, depends_on, tags, term FROM tasks ORDER BY due_date ASC`);
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
      tags: (r.tags as any) ?? null,
      term: r.term ?? null,
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
      `INSERT INTO tasks (id, title, course, due_date, status, created_at, estimated_minutes, priority, notes, attachments, depends_on, tags, term) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, title, course, due_date, status, created_at, estimated_minutes, priority, notes, attachments, depends_on, tags, term`,
      [id, input.title, input.course ?? null, new Date(input.dueDate), input.status ?? 'todo', new Date(now), input.estimatedMinutes ?? null, input.priority ?? null, input.notes ?? null, input.attachments ?? null, input.dependsOn ?? null, input.tags ?? null, input.term ?? null]
    );
    const r = res.rows[0];
    return { id: r.id, title: r.title, course: r.course, dueDate: new Date(r.due_date).toISOString(), status: r.status, createdAt: new Date(r.created_at).toISOString(), estimatedMinutes: r.estimated_minutes ?? null, priority: r.priority ?? null, notes: r.notes ?? null, attachments: r.attachments ?? null, dependsOn: r.depends_on ?? null, tags: r.tags ?? null, term: r.term ?? null };
  }
  const db = await readJson();
  const task: Task = { id: uuid(), title: input.title, course: input.course ?? null, dueDate: input.dueDate, status: input.status ?? 'todo', createdAt: now, estimatedMinutes: input.estimatedMinutes ?? null, priority: input.priority ?? null, notes: input.notes ?? null, attachments: input.attachments ?? null, dependsOn: input.dependsOn ?? null, tags: input.tags ?? null, term: input.term ?? null };
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
    if (patch.tags !== undefined) { fields.push(`tags = $${idx++}`); values.push(patch.tags); }
    if (patch.term !== undefined) { fields.push(`term = $${idx++}`); values.push(patch.term); }
    if (!fields.length) {
      const cur = await p.query(`SELECT id, title, course, due_date, status, created_at, estimated_minutes, priority, notes, attachments, depends_on, tags, term FROM tasks WHERE id=$1`, [id]);
      if (!cur.rowCount) return null;
      const r = cur.rows[0];
      return { id: r.id, title: r.title, course: r.course, dueDate: new Date(r.due_date).toISOString(), status: r.status, createdAt: new Date(r.created_at).toISOString(), estimatedMinutes: r.estimated_minutes ?? null, priority: r.priority ?? null, notes: r.notes ?? null, attachments: r.attachments ?? null, dependsOn: r.depends_on ?? null, tags: r.tags ?? null, term: r.term ?? null };
    }
    const q = `UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, title, course, due_date, status, created_at, estimated_minutes, priority, notes, attachments, depends_on, tags, term`;
    values.push(id);
    const res = await p.query(q, values);
    if (!res.rowCount) return null;
    const r = res.rows[0];
    return { id: r.id, title: r.title, course: r.course, dueDate: new Date(r.due_date).toISOString(), status: r.status, createdAt: new Date(r.created_at).toISOString(), estimatedMinutes: r.estimated_minutes ?? null, priority: r.priority ?? null, notes: r.notes ?? null, attachments: r.attachments ?? null, dependsOn: r.depends_on ?? null, tags: r.tags ?? null, term: r.term ?? null };
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
    type SessionRow = { id: string; task_id: string | null; when_ts: Date | string; minutes: number; focus: number | null; notes: string | null; pages_read: number | null; outline_pages: number | null; practice_qs: number | null; activity: string | null; created_at: Date | string };
    const res = await p.query(`SELECT id, task_id, when_ts, minutes, focus, notes, pages_read, outline_pages, practice_qs, activity, created_at FROM sessions ORDER BY when_ts DESC`);
    const rows = res.rows as unknown as SessionRow[];
    return rows.map(r => ({ id: r.id, taskId: r.task_id, when: new Date(r.when_ts).toISOString(), minutes: r.minutes, focus: r.focus, notes: r.notes, pagesRead: r.pages_read, outlinePages: r.outline_pages, practiceQs: r.practice_qs, activity: r.activity, createdAt: new Date(r.created_at).toISOString() }));
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
      `INSERT INTO sessions (id, task_id, when_ts, minutes, focus, notes, pages_read, outline_pages, practice_qs, activity, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, task_id, when_ts, minutes, focus, notes, pages_read, outline_pages, practice_qs, activity, created_at`,
      [id, input.taskId ?? null, new Date(whenISO), input.minutes, input.focus ?? null, input.notes ?? null, input.pagesRead ?? null, input.outlinePages ?? null, input.practiceQs ?? null, input.activity ?? null, new Date(now)]
    );
    const r = res.rows[0];
    return { id: r.id, taskId: r.task_id, when: new Date(r.when_ts).toISOString(), minutes: r.minutes, focus: r.focus, notes: r.notes, pagesRead: r.pages_read, outlinePages: r.outline_pages, practiceQs: r.practice_qs, activity: r.activity, createdAt: new Date(r.created_at).toISOString() };
  }
  const db = await readJson();
  const s: StudySession = { id: uuid(), taskId: input.taskId ?? null, when: whenISO, minutes: input.minutes, focus: input.focus ?? null, notes: input.notes ?? null, pagesRead: input.pagesRead ?? null, outlinePages: input.outlinePages ?? null, practiceQs: input.practiceQs ?? null, activity: input.activity ?? null, createdAt: now };
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
