import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { randomUUID as nodeRandomUUID } from 'crypto';
import { put, list, del } from '@vercel/blob';
import { Course, CourseDocument, NewCourseDocumentInput, NewCourseInput, NewSessionInput, NewTaskInput, StudySession, Task, UpdateCourseInput, UpdateTaskInput } from './types';

function resolveDbUrl(): string | null {
  // Prefer DATABASE_URL, else fall back to Vercel Postgres envs
  const direct = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING
    || null;
  if (direct) return direct;
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env as Record<string, string | undefined>;
  if (PGHOST && PGUSER && PGPASSWORD && PGDATABASE) {
    const port = PGPORT ? `:${PGPORT}` : '';
    // Default to sslmode=require for hosted providers
    return `postgres://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}${port}/${PGDATABASE}?sslmode=require`;
  }
  return null;
}
// ---------------------------------------------------------------------------
// Write serialization
//
// The JSON/Blob store is a single document: every mutation is a read-modify-
// write of the whole file. Without serialization two overlapping requests both
// read the same snapshot and the second one writes back a document that still
// contains whatever the first one removed - which is how deleted tasks,
// sessions and courses used to reappear. Every JSON-mode mutation now runs
// inside `mutateJson`, which re-reads the document inside the lock so it always
// builds on the most recent state.
// ---------------------------------------------------------------------------
let storeLock: Promise<unknown> = Promise.resolve();

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = storeLock.then(fn, fn);
  // Keep the chain alive even when a caller rejects.
  storeLock = run.catch(() => undefined);
  return run;
}

async function mutateJson<T>(fn: (db: JsonStore) => T | Promise<T>): Promise<T> {
  return withStoreLock(async () => {
    const db = await readJson();
    const result = await fn(db);
    await writeJson(db);
    return result;
  });
}

export async function updateSession(id: string, patch: Partial<Pick<StudySession, 'when'|'minutes'|'focus'|'notes'|'pagesRead'|'outlinePages'|'practiceQs'|'activity'>>): Promise<StudySession | null> {
  if (DB_URL) {
    const p = getPool();
    const fields: string[] = []; const values: any[] = []; let idx = 1;
    const push = (col: string, val: any, cast?: string) => { fields.push(`${col} = $${idx}${cast?`::${cast}`:''}`); values.push(val); idx++; };
    if (patch.when !== undefined) push('when_ts', new Date(patch.when));
    if (patch.minutes !== undefined) push('minutes', patch.minutes);
    if (patch.focus !== undefined) push('focus', patch.focus);
    if (patch.notes !== undefined) push('notes', patch.notes);
    if (patch.pagesRead !== undefined) push('pages_read', patch.pagesRead);
    if (patch.outlinePages !== undefined) push('outline_pages', patch.outlinePages);
    if (patch.practiceQs !== undefined) push('practice_qs', patch.practiceQs);
    if (patch.activity !== undefined) push('activity', patch.activity);
    if (!fields.length) {
      const cur = await p.query(`SELECT id, task_id, when_ts, minutes, focus, notes, pages_read, outline_pages, practice_qs, activity, created_at FROM sessions WHERE id=$1`, [id]);
      if (!cur.rowCount) return null;
      const r = cur.rows[0];
      return { id: r.id, taskId: r.task_id, when: new Date(r.when_ts).toISOString(), minutes: r.minutes, focus: r.focus, notes: r.notes, pagesRead: r.pages_read, outlinePages: r.outline_pages, practiceQs: r.practice_qs, activity: r.activity, createdAt: new Date(r.created_at).toISOString() };
    }
    const q = `UPDATE sessions SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, task_id, when_ts, minutes, focus, notes, pages_read, outline_pages, practice_qs, activity, created_at`;
    values.push(id);
    const res = await p.query(q, values);
    if (!res.rowCount) return null;
    const r = res.rows[0];
    return { id: r.id, taskId: r.task_id, when: new Date(r.when_ts).toISOString(), minutes: r.minutes, focus: r.focus, notes: r.notes, pagesRead: r.pages_read, outlinePages: r.outline_pages, practiceQs: r.practice_qs, activity: r.activity, createdAt: new Date(r.created_at).toISOString() };
  }
  return mutateJson(db => {
    const i = db.sessions.findIndex(s => s.id === id);
    if (i === -1) return null;
    const updated: StudySession = { ...db.sessions[i], ...patch } as any;
    db.sessions[i] = updated;
    return updated;
  });
}

export async function deleteSession(id: string): Promise<boolean> {
  if (DB_URL) {
    const p = getPool();
    const res = await p.query(`DELETE FROM sessions WHERE id=$1`, [id]);
    return res.rowCount > 0;
  }
  return mutateJson(db => {
    const before = db.sessions.length;
    db.sessions = db.sessions.filter(s => s.id !== id);
    return db.sessions.length < before;
  });
}
 
const DB_URL = resolveDbUrl();
export const HAS_DB = !!DB_URL;
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'law-school-tracker') : path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const BLOB_URL = process.env.BLOB_URL || null; // public base URL, e.g. https://<store-id>.public.blob.vercel-storage.com
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || null; // optional for SDK when not bound
// When running on Vercel, Blob is expected via binding; env vars may be absent.
export const HAS_BLOB = !!process.env.VERCEL || !!BLOB_URL || !!BLOB_TOKEN;
export function storageMode(): 'db' | 'blob' | 'file' {
  if (HAS_DB) return 'db';
  if (IS_VERCEL && HAS_BLOB) return 'blob';
  return 'file';
}

let pool: Pool | null = null;
/** ensureSchema runs on nearly every request; only do the work once per process. */
let schemaReady: Promise<void> | null = null;
function getPool(): Pool {
  if (!DB_URL) throw new Error('No DATABASE_URL');
  if (!pool) {
    pool = new Pool({ connectionString: DB_URL, ssl: DB_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  }
  return pool;
}

// ---------------------------------------------------------------------------
// Read-only pool for the GPT connector
//
// The GPT Action never needs to write. GPT_DATABASE_URL lets it connect as a
// separate, SELECT-only Postgres role (see scripts/gpt-readonly-role.sql) so
// that guarantee is enforced by the database, not just by which functions the
// route handlers happen to call. Unset, this is exactly getPool() - same
// connection, same behavior as before this existed.
// ---------------------------------------------------------------------------
let gptPool: Pool | null = null;
export function getGptPool(): Pool {
  const gptUrl = process.env.GPT_DATABASE_URL?.trim();
  if (!gptUrl) return getPool();
  if (!gptPool) {
    gptPool = new Pool({ connectionString: gptUrl, ssl: gptUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  }
  return gptPool;
}

// Courses
export async function listCourses(overridePool?: Pool): Promise<Course[]> {
  if (DB_URL) {
    try {
      const p = overridePool || getPool();
      type Row = {
        id: string; code: string | null; title: string; instructor: string | null; instructor_email: string | null; room: string | null; location: string | null;
        color: string | null; meeting_days: number[] | null; meeting_start: string | null; meeting_end: string | null; meeting_blocks: any | null;
        start_date: Date | string | null; end_date: Date | string | null; semester: string | null; year: number | null; created_at: Date | string;
        learned_mpp: number | null; learned_sample: number | null; learned_updated_at: Date | string | null; override_enabled: boolean | null; override_mpp: number | null; default_activity: string | null
      };
      const res = await p.query(`SELECT id, code, title, instructor, instructor_email, room, location, color, meeting_days, meeting_start, meeting_end, meeting_blocks, start_date, end_date, semester, year, created_at, learned_mpp, learned_sample, learned_updated_at, override_enabled, override_mpp, default_activity FROM courses ORDER BY title`);
      const rows = res.rows as Row[];
      return rows.map(r => ({
        id: r.id,
        code: r.code,
        title: r.title,
        instructor: r.instructor,
        instructorEmail: r.instructor_email,
        room: r.room,
        location: r.location,
        color: r.color ?? null,
        meetingDays: (r.meeting_days as any) ?? null,
        meetingStart: r.meeting_start,
        meetingEnd: r.meeting_end,
        meetingBlocks: (r.meeting_blocks as any) ?? null,
        startDate: r.start_date ? new Date(r.start_date).toISOString() : null,
        endDate: r.end_date ? new Date(r.end_date).toISOString() : null,
        semester: (r.semester as any) ?? null,
        year: r.year ?? null,
        createdAt: new Date(r.created_at as any).toISOString(),
        learnedMpp: r.learned_mpp ?? null,
        learnedSample: r.learned_sample ?? null,
        learnedUpdatedAt: r.learned_updated_at ? new Date(r.learned_updated_at as any).toISOString() : null,
        overrideEnabled: (r.override_enabled as any) ?? null,
        overrideMpp: r.override_mpp ?? null,
        defaultActivity: r.default_activity ?? null,
      }));
    } catch (e) {
      // DB is configured; do not fall back to JSON to avoid split brain
      throw e;
    }
  }
  // No DB configured: use JSON/Blob store
  const json = await readJson();
  return json.courses.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

export async function createCourse(input: NewCourseInput): Promise<Course> {
  const now = new Date().toISOString();
  if (DB_URL) {
    try {
      const p = getPool();
      const id = uuid();
      const res = await p.query(
        `INSERT INTO courses (
           id, code, title, instructor, instructor_email, room, location, color,
           meeting_days, meeting_start, meeting_end, meeting_blocks,
           start_date, end_date, semester, year, created_at,
           learned_mpp, learned_sample, learned_updated_at, override_enabled, override_mpp, default_activity
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9::int[], $10, $11, $12::jsonb,
           $13::date, $14::date, $15, $16::int, $17,
           $18, $19, $20, $21, $22, $23
         )
         RETURNING id, code, title, instructor, instructor_email, room, location, color, meeting_days, meeting_start, meeting_end, meeting_blocks, start_date, end_date, semester, year, created_at, learned_mpp, learned_sample, learned_updated_at, override_enabled, override_mpp, default_activity`,
        [
          id,
          input.code ?? null,
          input.title,
          input.instructor ?? null,
          input.instructorEmail ?? null,
          input.room ?? null,
          input.location ?? null,
          (input as any).color ?? null,
          (input.meetingDays && input.meetingDays.length ? input.meetingDays : null),
          input.meetingStart ?? null,
          input.meetingEnd ?? null,
          (input.meetingBlocks && (input.meetingBlocks as any[]).length ? JSON.stringify(input.meetingBlocks) : null),
          input.startDate ? new Date(input.startDate) : null,
          input.endDate ? new Date(input.endDate) : null,
          input.semester ?? null,
          (typeof input.year === 'number' ? input.year : (input.year as any) ?? null),
          new Date(now),
          null, // learned_mpp
          null, // learned_sample
          null, // learned_updated_at
          null, // override_enabled
          null, // override_mpp
          null  // default_activity
        ]
      );
      const r = res.rows[0];
      return {
        id: r.id, code: r.code, title: r.title, instructor: r.instructor, instructorEmail: r.instructor_email, room: r.room, location: r.location, color: r.color ?? null,
        meetingDays: r.meeting_days ?? null, meetingStart: r.meeting_start, meetingEnd: r.meeting_end, meetingBlocks: r.meeting_blocks ?? null,
        startDate: r.start_date ? new Date(r.start_date).toISOString() : null, endDate: r.end_date ? new Date(r.end_date).toISOString() : null,
        semester: r.semester ?? null, year: r.year ?? null, createdAt: new Date(r.created_at).toISOString(), defaultActivity: null
      };
    } catch (e) {
      // DB is configured; do not fall back to JSON to avoid split brain
      throw e;
    }
  }
  const c: Course = { id: uuid(), code: input.code ?? null, title: input.title, instructor: input.instructor ?? null, instructorEmail: input.instructorEmail ?? null, room: input.room ?? null, location: input.location ?? null, color: (input as any).color ?? null, meetingDays: input.meetingDays ?? null, meetingStart: input.meetingStart ?? null, meetingEnd: input.meetingEnd ?? null, meetingBlocks: input.meetingBlocks ?? null, startDate: input.startDate ?? null, endDate: input.endDate ?? null, semester: input.semester ?? null, year: input.year ?? null, createdAt: now };
  await mutateJson(db => { db.courses.push(c); });
  return c;
}

export async function updateCourse(id: string, patch: UpdateCourseInput): Promise<Course | null> {
  if (DB_URL) {
    try {
      const p = getPool();
      const fields: string[] = []; const values: any[] = []; let idx = 1;
      const push = (col: string, val: any, cast?: string) => {
        fields.push(`${col} = $${idx}${cast ? `::${cast}` : ''}`);
        values.push(val); idx++;
      };
      if (patch.code !== undefined) push('code', patch.code);
      if (patch.title !== undefined) push('title', patch.title);
      if (patch.instructor !== undefined) push('instructor', patch.instructor);
      if (patch.instructorEmail !== undefined) push('instructor_email', patch.instructorEmail);
      if (patch.room !== undefined) push('room', patch.room);
      if (patch.location !== undefined) push('location', patch.location);
      if (patch.color !== undefined) push('color', patch.color);
      if (patch.meetingDays !== undefined) push('meeting_days', (patch.meetingDays && patch.meetingDays.length ? patch.meetingDays : null), 'int[]');
      if (patch.meetingStart !== undefined) push('meeting_start', patch.meetingStart);
      if (patch.meetingEnd !== undefined) push('meeting_end', patch.meetingEnd);
      if (patch.meetingBlocks !== undefined) push('meeting_blocks', (patch.meetingBlocks && (patch.meetingBlocks as any[]).length ? JSON.stringify(patch.meetingBlocks) : null), 'jsonb');
      if (patch.startDate !== undefined) push('start_date', patch.startDate ? new Date(patch.startDate) : null, 'date');
      if (patch.endDate !== undefined) push('end_date', patch.endDate ? new Date(patch.endDate) : null, 'date');
      if (patch.semester !== undefined) push('semester', patch.semester);
      if (patch.year !== undefined) push('year', (typeof patch.year === 'number' ? patch.year : (patch.year as any) ?? null), 'int');
      if ((patch as any).overrideEnabled !== undefined) push('override_enabled', (patch as any).overrideEnabled);
      if ((patch as any).overrideMpp !== undefined) push('override_mpp', (patch as any).overrideMpp);
      if ((patch as any).defaultActivity !== undefined) push('default_activity', (patch as any).defaultActivity);
      if (!fields.length) {
        const cur = await p.query(`SELECT id, code, title, instructor, instructor_email, room, location, color, meeting_days, meeting_start, meeting_end, meeting_blocks, start_date, end_date, semester, year, created_at, learned_mpp, learned_sample, learned_updated_at, override_enabled, override_mpp FROM courses WHERE id=$1`, [id]);
        if (!cur.rowCount) return null;
        const r = cur.rows[0];
        return { id: r.id, code: r.code, title: r.title, instructor: r.instructor, instructorEmail: r.instructor_email, room: r.room, location: r.location, color: r.color ?? null, meetingDays: r.meeting_days ?? null, meetingStart: r.meeting_start, meetingEnd: r.meeting_end, meetingBlocks: r.meeting_blocks ?? null, startDate: r.start_date ? new Date(r.start_date).toISOString() : null, endDate: r.end_date ? new Date(r.end_date).toISOString() : null, semester: r.semester ?? null, year: r.year ?? null, createdAt: new Date(r.created_at).toISOString(), learnedMpp: r.learned_mpp ?? null, learnedSample: r.learned_sample ?? null, learnedUpdatedAt: r.learned_updated_at ? new Date(r.learned_updated_at).toISOString() : null, overrideEnabled: r.override_enabled ?? null, overrideMpp: r.override_mpp ?? null, defaultActivity: (r as any).default_activity ?? null };
      }
      const q = `UPDATE courses SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, code, title, instructor, instructor_email, room, location, color, meeting_days, meeting_start, meeting_end, meeting_blocks, start_date, end_date, semester, year, created_at, learned_mpp, learned_sample, learned_updated_at, override_enabled, override_mpp, default_activity`;
      values.push(id);
      const res = await p.query(q, values);
      if (!res.rowCount) return null;
      const r = res.rows[0];
      return { id: r.id, code: r.code, title: r.title, instructor: r.instructor, instructorEmail: r.instructor_email, room: r.room, location: r.location, color: r.color ?? null, meetingDays: r.meeting_days ?? null, meetingStart: r.meeting_start, meetingEnd: r.meeting_end, meetingBlocks: r.meeting_blocks ?? null, startDate: r.start_date ? new Date(r.start_date).toISOString() : null, endDate: r.end_date ? new Date(r.end_date).toISOString() : null, semester: r.semester ?? null, year: r.year ?? null, createdAt: new Date(r.created_at).toISOString(), learnedMpp: r.learned_mpp ?? null, learnedSample: r.learned_sample ?? null, learnedUpdatedAt: r.learned_updated_at ? new Date(r.learned_updated_at).toISOString() : null, overrideEnabled: r.override_enabled ?? null, overrideMpp: r.override_mpp ?? null, defaultActivity: (r as any).default_activity ?? null };
    } catch (e) {
      // DB is configured; do not fall back to JSON to avoid split brain
      throw e;
    }
  }
  return mutateJson(db => {
    const i = db.courses.findIndex(c => c.id === id);
    if (i === -1) return null;
    const updated: Course = { ...db.courses[i], ...patch } as Course;
    db.courses[i] = updated;
    return updated;
  });
}

export async function deleteCourse(id: string): Promise<boolean> {
  if (DB_URL) {
    try {
      const p = getPool();
      const res = await p.query(`DELETE FROM courses WHERE id=$1`, [id]);
      return res.rowCount > 0;
    } catch (e) {
      // DB is configured; do not fall back to JSON to avoid split brain
      throw e;
    }
  }
  return mutateJson(db => {
    const before = db.courses.length;
    db.courses = db.courses.filter(c => c.id !== id);
    return db.courses.length < before;
  });
}

// Course documents (syllabus, slides, etc.)
function rowToCourseDocument(r: any): CourseDocument {
  return {
    id: r.id, courseId: r.course_id, title: r.title, filename: r.filename,
    mimeType: r.mime_type, size: r.size, url: r.url,
    category: (r.category as any) || 'other',
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function listCourseDocuments(courseId: string): Promise<CourseDocument[]> {
  if (DB_URL) {
    const p = getPool();
    const res = await p.query(
      `SELECT id, course_id, title, filename, mime_type, size, url, category, created_at FROM course_documents WHERE course_id=$1 ORDER BY created_at DESC`,
      [courseId],
    );
    return res.rows.map(rowToCourseDocument);
  }
  const json = await readJson();
  return (json.documents || [])
    .filter(d => d.courseId === courseId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getCourseDocument(id: string): Promise<CourseDocument | null> {
  if (DB_URL) {
    const p = getPool();
    const res = await p.query(
      `SELECT id, course_id, title, filename, mime_type, size, url, category, created_at FROM course_documents WHERE id=$1`,
      [id],
    );
    if (!res.rowCount) return null;
    return rowToCourseDocument(res.rows[0]);
  }
  const json = await readJson();
  return (json.documents || []).find(d => d.id === id) || null;
}

export async function createCourseDocument(input: NewCourseDocumentInput): Promise<CourseDocument> {
  const now = new Date().toISOString();
  const category = input.category || 'other';
  if (DB_URL) {
    const p = getPool();
    const id = uuid();
    const res = await p.query(
      `INSERT INTO course_documents (id, course_id, title, filename, mime_type, size, url, category, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, course_id, title, filename, mime_type, size, url, category, created_at`,
      [id, input.courseId, input.title, input.filename, input.mimeType, input.size, input.url, category, new Date(now)],
    );
    return rowToCourseDocument(res.rows[0]);
  }
  return mutateJson(db => {
    const doc: CourseDocument = { id: uuid(), createdAt: now, ...input, category };
    db.documents = [...(db.documents || []), doc];
    return doc;
  });
}

export async function deleteCourseDocument(id: string): Promise<boolean> {
  if (DB_URL) {
    const p = getPool();
    const res = await p.query(`DELETE FROM course_documents WHERE id=$1`, [id]);
    return res.rowCount > 0;
  }
  return mutateJson(db => {
    const before = (db.documents || []).length;
    db.documents = (db.documents || []).filter(d => d.id !== id);
    return db.documents.length < before;
  });
}

// One-time helper to migrate JSON/Blob courses into DB if DB is empty
export async function migrateCoursesToDbIfEmpty() {
  if (!DB_URL) return;
  const p = getPool();
  try {
    const cnt = await p.query('SELECT COUNT(*)::int AS n FROM courses');
    const n = cnt.rows?.[0]?.n ?? 0;
    if (n > 0) return;
  } catch (e) {
    // If table not ready yet, ensure schema and retry count once
    await ensureSchema().catch(() => {});
    const cnt2 = await p.query('SELECT COUNT(*)::int AS n FROM courses');
    const n2 = cnt2.rows?.[0]?.n ?? 0;
    if (n2 > 0) return;
  }
  // Load from JSON/Blob and insert
  const json = await readJson();
  if (!Array.isArray(json.courses) || json.courses.length === 0) return;
  // Insert rows individually without an explicit transaction to avoid Pool.connect typings
  for (const c of json.courses) {
    await p.query(
      `INSERT INTO courses (id, code, title, instructor, instructor_email, room, location, color, meeting_days, meeting_start, meeting_end, meeting_blocks, start_date, end_date, semester, year, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO NOTHING`,
      [
        c.id,
        c.code ?? null,
        c.title,
        c.instructor ?? null,
        c.instructorEmail ?? null,
        c.room ?? null,
        c.location ?? null,
        (c as any).color ?? null,
        c.meetingDays ?? null,
        c.meetingStart ?? null,
        c.meetingEnd ?? null,
        c.meetingBlocks ?? null,
        c.startDate ? new Date(c.startDate) : null,
        c.endDate ? new Date(c.endDate) : null,
        c.semester ?? null,
        c.year ?? null,
        new Date(c.createdAt || Date.now()),
      ],
    );
  }
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function baselineMpp(): number { return 2.0; }
function zscoreTrim(values: number[]): number[] {
  if (values.length === 0) return values;
  const mean = values.reduce((a,b)=>a+b,0)/values.length;
  const variance = values.reduce((a,b)=>a + Math.pow(b-mean,2),0) / values.length;
  const sd = Math.sqrt(variance);
  if (!isFinite(sd) || sd === 0) return values;
  return values.filter(v => Math.abs(v - mean) <= 2 * sd);
}

export async function recomputeLearnedMppForCourse(courseTitle: string): Promise<void> {
  if (!courseTitle) return;
  const alpha = 0.3;
  if (DB_URL) {
    const p = getPool();
    // Gather session mpp for this course
    const q = `
      SELECT s.minutes, s.pages_read, s.when_ts
      FROM sessions s
      JOIN tasks t ON t.id = s.task_id
      WHERE t.course = $1 AND s.pages_read IS NOT NULL AND s.minutes IS NOT NULL
      ORDER BY s.when_ts ASC
    `;
    const res = await p.query(q, [courseTitle]);
    const raw: Array<{minutes: number|null; pages_read: number|null; when_ts: Date|string}> = res.rows as any;
    let mpps = raw
      .filter(r => typeof r.minutes === 'number' && typeof r.pages_read === 'number')
      .map(r => ({ mpp: (r.minutes as number) / Math.max(1, r.pages_read as number), minutes: r.minutes as number, pages: r.pages_read as number }))
      .filter(x => x.minutes >= 5 && x.minutes <= 240 && x.pages >= 2 && x.pages <= 150)
      .map(x => x.mpp);
    mpps = zscoreTrim(mpps);
    const sample = mpps.length;
    let learned: number | null = null;
    if (sample > 0) {
      let ema = baselineMpp();
      for (const v of mpps) ema = alpha * v + (1 - alpha) * ema;
      learned = clamp(ema, 0.5, 6.0);
    }
    await p.query(`UPDATE courses SET learned_mpp = $1, learned_sample = $2, learned_updated_at = now() WHERE title = $3`, [learned, sample || null, courseTitle]);
    return;
  }
  // JSON/Blob mode
  await mutateJson(db => {
  const tasks = db.tasks.filter(t => (t.course || '') === courseTitle);
  const taskIds = new Set(tasks.map(t => t.id));
  let mpps = db.sessions
    .filter(s => s.taskId && taskIds.has(s.taskId) && typeof s.minutes === 'number' && typeof s.pagesRead === 'number')
    .sort((a,b) => a.when.localeCompare(b.when))
    .map(s => ({ mpp: (s.minutes as number) / Math.max(1, s.pagesRead as number), minutes: s.minutes as number, pages: s.pagesRead as number }))
    .filter(x => x.minutes >= 5 && x.minutes <= 240 && x.pages >= 2 && x.pages <= 150)
    .map(x => x.mpp);
  mpps = zscoreTrim(mpps);
  const sample = mpps.length;
  let learned: number | null = null;
  if (sample > 0) {
    let ema = baselineMpp();
    for (const v of mpps) ema = alpha * v + (1 - alpha) * ema;
    learned = clamp(ema, 0.5, 6.0);
  }
  const i = db.courses.findIndex(c => (c.title || '') === courseTitle);
  if (i !== -1) {
    (db.courses[i] as any).learnedMpp = learned;
    (db.courses[i] as any).learnedSample = sample || null;
    (db.courses[i] as any).learnedUpdatedAt = new Date().toISOString();
  }
  });
}

export async function ensureSchema() {
  if (!DB_URL) return; // JSON mode doesn't need schema
  if (schemaReady) return schemaReady;
  // Clear the cache on failure so a transient outage doesn't leave the process
  // permanently convinced the schema can never be applied.
  schemaReady = applySchema().catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}

/**
 * Statements are applied one at a time on purpose.
 *
 * Postgres runs a multi-statement query as a single implicit transaction, so
 * when this was one big string a single failing statement rolled back every
 * other change - and the error was swallowed. The result was a database that
 * silently never migrated, and then every query failed with "column does not
 * exist", which is what filled pages with red error toasts. Applied
 * individually, one problem statement no longer blocks the rest, and it is
 * logged with the statement that caused it.
 */
async function applySchema(): Promise<void> {
  const p = getPool();
  const statements: string[] = [
    `CREATE TABLE IF NOT EXISTS tasks (
       id uuid PRIMARY KEY,
       title text NOT NULL,
       course text,
       due_date timestamptz NOT NULL,
       status text NOT NULL DEFAULT 'todo',
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_minutes integer`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimate_origin text`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_minutes integer`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority integer`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes text`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachments jsonb`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on uuid[]`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags jsonb`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS term text`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS focus integer`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pages_read integer`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS activity text`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_time text`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS end_time text`,
    // Partial-completion page tracking. The Task type and the Today card have
    // always read these, but there was nowhere to store them.
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS original_page_ranges text`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remaining_page_ranges text`,
    `CREATE TABLE IF NOT EXISTS courses (
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
     )`,
    // Real reference to courses(id), after courses exists, so fresh databases
    // get the FK in the same schema pass instead of waiting for another boot.
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES courses(id) ON DELETE SET NULL`,
    `ALTER TABLE courses ADD COLUMN IF NOT EXISTS meeting_blocks jsonb`,
    `ALTER TABLE courses ADD COLUMN IF NOT EXISTS color text`,
    `ALTER TABLE courses ADD COLUMN IF NOT EXISTS learned_mpp double precision`,
    `ALTER TABLE courses ADD COLUMN IF NOT EXISTS learned_sample integer`,
    `ALTER TABLE courses ADD COLUMN IF NOT EXISTS learned_updated_at timestamptz`,
    `ALTER TABLE courses ADD COLUMN IF NOT EXISTS override_enabled boolean`,
    `ALTER TABLE courses ADD COLUMN IF NOT EXISTS override_mpp double precision`,
    `ALTER TABLE courses ADD COLUMN IF NOT EXISTS default_activity text`,
    `CREATE TABLE IF NOT EXISTS course_documents (
       id uuid PRIMARY KEY,
       course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
       title text NOT NULL,
       filename text NOT NULL,
       mime_type text NOT NULL,
       size integer NOT NULL,
       url text NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `ALTER TABLE course_documents ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other'`,
    // Settings key/value store (single-user)
    `CREATE TABLE IF NOT EXISTS settings (
       key text PRIMARY KEY,
       value jsonb NOT NULL
     )`,
    // Week Plan schedule blocks.
    // ids are text, not uuid: the week planner mints its own block ids and a
    // block can also point at a backlog item that is not a task row. When
    // these columns were uuid with a foreign key, every save of a hand-placed
    // block failed on "invalid input syntax for type uuid" and the whole
    // schedule silently never reached the server.
    `CREATE TABLE IF NOT EXISTS schedule_blocks (
       id text PRIMARY KEY,
       task_id text,
       day date NOT NULL,
       planned_minutes integer NOT NULL,
       guessed boolean,
       title text NOT NULL,
       course text,
       pages integer,
       priority integer,
       catchup boolean,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    // Migrate installations created with the original uuid columns.
    `ALTER TABLE schedule_blocks DROP CONSTRAINT IF EXISTS schedule_blocks_task_id_fkey`,
    `DO $$ BEGIN
       ALTER TABLE schedule_blocks ALTER COLUMN id TYPE text USING id::text;
     EXCEPTION WHEN others THEN NULL; END $$`,
    `DO $$ BEGIN
       ALTER TABLE schedule_blocks ALTER COLUMN task_id TYPE text USING task_id::text;
     EXCEPTION WHEN others THEN NULL; END $$`,
    `CREATE TABLE IF NOT EXISTS sessions (
       id uuid PRIMARY KEY,
       task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
       when_ts timestamptz NOT NULL DEFAULT now(),
       minutes integer NOT NULL,
       focus double precision,
       notes text,
       pages_read integer,
       outline_pages integer,
       practice_qs integer,
       activity text,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    // Ensure focus supports decimals
    `DO $$ BEGIN
       ALTER TABLE sessions ALTER COLUMN focus TYPE double precision USING focus::double precision;
     EXCEPTION WHEN others THEN NULL; END $$`,
  ];

  for (const statement of statements) {
    try {
      await p.query(statement);
    } catch (e) {
      // `CREATE ... IF NOT EXISTS` is not atomic against a concurrent creator:
      // two instances warming up together both see the object missing, and the
      // loser fails with a duplicate key on the pg_class catalog. Harmless.
      if (isBenignSchemaRace(e)) continue;
      console.warn(
        'ensureSchema: statement failed, continuing:',
        statement.replace(/\s+/g, ' ').slice(0, 120),
        (e as any)?.message || e,
      );
    }
  }
}

function isBenignSchemaRace(error: any): boolean {
  const code = String(error?.code || '');
  if (['42P07', '42710', '23505', '42P16'].includes(code)) return true;
  const message = String(error?.message || '');
  return /already exists|pg_class_relname_nsp_index|pg_type_typname_nsp_index/i.test(message);
}

function uuid() {
  return (globalThis as any).crypto?.randomUUID?.() || nodeRandomUUID();
}

type JsonStore = { tasks: Task[]; sessions: StudySession[]; courses: Course[]; documents?: CourseDocument[]; scheduleBlocks?: Array<{ id: string; taskId: string; day: string; plannedMinutes: number; guessed?: boolean; title: string; course: string; pages?: number | null; priority?: number | null; catchup?: boolean }>; settings?: Record<string, any> };

async function readJson(): Promise<JsonStore> {
  // On Vercel without DB, we REQUIRE Blob store. No local fallback.
  if (IS_VERCEL && !HAS_DB) {
    if (!HAS_BLOB) {
      throw new Error('Blob store not configured. Bind Vercel Blob or set BLOB_URL/BLOB_READ_WRITE_TOKEN.');
    }
    try {
      // Read via Blob listing with robust selection (binding only)
      const { blobs } = await list();
      // Prefer exact 'db.json'
      const exact = blobs.find((b: any) => (b.pathname || '') === 'db.json');
      if (exact?.url) {
        const bust = `${exact.url}${exact.url.includes('?') ? '&' : '?'}_ts=${Date.now()}`;
        const res = await fetch(bust, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to read blob ${exact.pathname}: HTTP ${res.status}`);
        const data = await res.json();
        if (!('courses' in data)) data.courses = [];
        if (!('tasks' in data)) data.tasks = [];
        if (!('sessions' in data)) data.sessions = [];
        if (!('scheduleBlocks' in data)) data.scheduleBlocks = [];
        if (!('documents' in data)) data.documents = [];
        if (!('settings' in data)) data.settings = {};
        return data;
      }
      // Next, any path ending with '/db.json'
      const nested = blobs.find((b: any) => (b.pathname || '').endsWith('/db.json'));
      if (nested?.url) {
        const bust = `${nested.url}${nested.url.includes('?') ? '&' : '?'}_ts=${Date.now()}`;
        const res = await fetch(bust, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to read blob ${nested.pathname}: HTTP ${res.status}`);
        const data = await res.json();
        if (!('courses' in data)) data.courses = [];
        if (!('tasks' in data)) data.tasks = [];
        if (!('sessions' in data)) data.sessions = [];
        return data;
      }
      // Finally, newest 'db.json-*' if present
      const suffixed = blobs
        .filter((b: any) => (b.pathname || '').startsWith('db.json-'))
        .sort((a: any, b: any) => new Date(b.uploadedAt || b.createdAt || b.lastModified || 0).getTime() - new Date(a.uploadedAt || a.createdAt || a.lastModified || 0).getTime())[0];
      if (suffixed?.url) {
        const bust = `${suffixed.url}${suffixed.url.includes('?') ? '&' : '?'}_ts=${Date.now()}`;
        const res = await fetch(bust, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to read blob ${suffixed.pathname}: HTTP ${res.status}`);
        const data = await res.json();
        if (!('courses' in data)) data.courses = [];
        if (!('tasks' in data)) data.tasks = [];
        if (!('sessions' in data)) data.sessions = [];
        if (!('scheduleBlocks' in data)) data.scheduleBlocks = [];
        if (!('documents' in data)) data.documents = [];
        if (!('settings' in data)) data.settings = {};
        return data;
      }
      // Initialize if no existing blob
      const empty: JsonStore = { tasks: [], sessions: [], courses: [], documents: [], scheduleBlocks: [], settings: {} };
      await writeJson(empty);
      return empty;
    } catch (err) {
      // On Vercel without a working Blob binding, do not silently fall back
      // to ephemeral local file. Surface the error so API returns a failure
      // instead of pretending it worked.
      throw err;
    }
  }
  // Local file storage (development or fallback)
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!('courses' in data)) data.courses = [];
    if (!('tasks' in data)) data.tasks = [];
    if (!('sessions' in data)) data.sessions = [];
    if (!('scheduleBlocks' in data)) data.scheduleBlocks = [];
    if (!('documents' in data)) data.documents = [];
    if (!('settings' in data)) data.settings = {};
    return data as JsonStore;
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      const empty: JsonStore = { tasks: [], sessions: [], courses: [], documents: [], scheduleBlocks: [], settings: {} };
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(empty, null, 2), 'utf8');
      return empty;
    }
    throw e;
  }
}

async function writeJson(data: JsonStore) {
  // On Vercel without DB, we REQUIRE Blob store. No local fallback.
  if (IS_VERCEL && !HAS_DB) {
    if (!HAS_BLOB) {
      throw new Error('Blob store not configured. Bind Vercel Blob or set BLOB_URL/BLOB_READ_WRITE_TOKEN.');
    }
    try {
      const rev = Date.now();
      const payload = { tasks: data.tasks || [], sessions: data.sessions || [], courses: data.courses || [], documents: data.documents || [], scheduleBlocks: data.scheduleBlocks || [], settings: data.settings || {}, __rev: rev } as any;
      await put('db.json', JSON.stringify(payload, null, 2), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        cacheControlMaxAge: 0,
      } as any);
      // Clean up any legacy suffixed blobs to avoid stale reads
      try {
        const { blobs } = await list();
        const legacy = blobs.filter((b: any) => (b.pathname || '').startsWith('db.json-'));
        if (legacy.length) await Promise.all(legacy.map((b: any) => del(b.pathname)));
      } catch {}
      // Read-after-write verification: ensure CDN serves the new rev
      try {
        const url = BLOB_URL ? `${BLOB_URL}/db.json` : (await (async () => {
          const { blobs } = await list();
          const exact = blobs.find((b: any) => (b.pathname || '') === 'db.json');
          return exact?.url || '';
        })());
        if (url) {
          for (let i = 0; i < 10; i++) {
            const res = await fetch(`${url}?_ts=${Date.now()}`, { cache: 'no-store' });
            if (res.ok) {
              const d = await res.json().catch(() => null as any);
              if (d && typeof d.__rev === 'number' && d.__rev === rev) break;
            }
            await new Promise(r => setTimeout(r, 100));
          }
        }
      } catch {}
      return;
    } catch (err) {
      // On Vercel, failing to write to Blob should not fall back to
      // ephemeral local file which disappears on cold start. Surface error.
      throw err as any;
    }
  }
  // Local file storage (development or fallback)
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const payload = { tasks: data.tasks || [], sessions: data.sessions || [], courses: data.courses || [], documents: data.documents || [], scheduleBlocks: data.scheduleBlocks || [], settings: data.settings || {}, __rev: Date.now() } as any;
  await fs.writeFile(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

// Settings helpers
export async function getSettings(keys?: string[]): Promise<Record<string, any>> {
  if (DB_URL) {
    const p = getPool();
    if (keys && keys.length) {
      const res = await p.query(`SELECT key, value FROM settings WHERE key = ANY($1::text[])`, [keys]);
      const out: Record<string, any> = {};
      for (const row of res.rows as any[]) out[row.key] = row.value;
      return out;
    }
    const res = await p.query(`SELECT key, value FROM settings`);
    const out: Record<string, any> = {};
    for (const row of res.rows as any[]) out[row.key] = row.value;
    return out;
  }
  const db = await readJson();
  return db.settings || {};
}

export async function patchSettings(patch: Record<string, any>): Promise<void> {
  if (!patch || typeof patch !== 'object') return;
  if (DB_URL) {
    const p = getPool();
    for (const [k, v] of Object.entries(patch)) {
      await p.query(`INSERT INTO settings(key, value) VALUES ($1,$2::jsonb)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, JSON.stringify(v)]);
    }
    return;
  }
  await mutateJson(db => { db.settings = { ...(db.settings || {}), ...patch }; });
}

/**
 * Read-modify-write a single settings key without losing concurrent updates.
 * In Postgres the row is locked for the duration of the transaction; in JSON
 * mode the whole document is locked. Callers get the stored value, return the
 * next value, and the result they want handed back.
 */
export async function mutateSetting<T>(
  key: string,
  mutator: (current: any) => { value: any; result: T },
): Promise<T> {
  if (DB_URL) {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO settings(key, value) VALUES ($1, 'null'::jsonb) ON CONFLICT (key) DO NOTHING`,
        [key],
      );
      const res = await client.query(`SELECT value FROM settings WHERE key = $1 FOR UPDATE`, [key]);
      const current = res.rows?.[0]?.value ?? null;
      const { value, result } = mutator(current);
      await client.query(`UPDATE settings SET value = $2::jsonb WHERE key = $1`, [key, JSON.stringify(value ?? null)]);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
  return mutateJson(db => {
    const settings = db.settings || (db.settings = {});
    const { value, result } = mutator(settings[key] ?? null);
    settings[key] = value;
    return result;
  });
}

// Week Plan schedule blocks helpers
export type ScheduleBlockRow = { id: string; taskId: string; day: string; plannedMinutes: number; guessed?: boolean; title: string; course: string; pages?: number | null; priority?: number | null; catchup?: boolean };

export async function listScheduleBlocks(): Promise<ScheduleBlockRow[]> {
  if (DB_URL) {
    const p = getPool();
    const res = await p.query(`SELECT id, task_id, day, planned_minutes, guessed, title, course, pages, priority, catchup FROM schedule_blocks ORDER BY day ASC, title ASC`);
    return (res.rows as any[]).map(r => ({ id: r.id, taskId: r.task_id, day: (r.day instanceof Date ? (r.day as Date).toISOString().slice(0,10) : r.day), plannedMinutes: r.planned_minutes, guessed: r.guessed ?? undefined, title: r.title, course: r.course ?? '', pages: r.pages ?? null, priority: r.priority ?? null, catchup: r.catchup ?? undefined }));
  }
  const db = await readJson();
  return (db.scheduleBlocks || []) as ScheduleBlockRow[];
}

/** Drop rows the store cannot represent so one bad block can't fail the save. */
function sanitizeScheduleBlocks(blocks: ScheduleBlockRow[]): ScheduleBlockRow[] {
  const seen = new Set<string>();
  const out: ScheduleBlockRow[] = [];
  for (const b of (blocks || [])) {
    if (!b || typeof b.id !== 'string' || !b.id) continue;
    if (typeof b.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.day)) continue;
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push({
      ...b,
      taskId: typeof b.taskId === 'string' && b.taskId ? b.taskId : '',
      title: String(b.title ?? '').slice(0, 500) || 'Untitled block',
      course: String(b.course ?? ''),
      plannedMinutes: Math.max(0, Math.round(Number(b.plannedMinutes) || 0)),
    });
  }
  return out;
}

export async function replaceAllScheduleBlocks(input: ScheduleBlockRow[]): Promise<void> {
  const blocks = sanitizeScheduleBlocks(input);
  if (DB_URL) {
    // A pool-level BEGIN/COMMIT can land on different connections, which left
    // the delete uncommitted and readers seeing a half-written week. Pin the
    // whole replacement to one client.
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM schedule_blocks');
      for (const b of (blocks || [])) {
        await client.query(
          `INSERT INTO schedule_blocks (id, task_id, day, planned_minutes, guessed, title, course, pages, priority, catchup, created_at)
           VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10, now())
           ON CONFLICT (id) DO UPDATE SET task_id=EXCLUDED.task_id, day=EXCLUDED.day, planned_minutes=EXCLUDED.planned_minutes, guessed=EXCLUDED.guessed, title=EXCLUDED.title, course=EXCLUDED.course, pages=EXCLUDED.pages, priority=EXCLUDED.priority, catchup=EXCLUDED.catchup`,
          [b.id, b.taskId || null, b.day, b.plannedMinutes, b.guessed ?? null, b.title, b.course || null, b.pages ?? null, b.priority ?? null, b.catchup ?? null]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    return;
  }
  await mutateJson(db => { db.scheduleBlocks = (blocks || []).slice(); });
}

// Tasks

/**
 * One place that turns a tasks row into a Task. The mapping used to be
 * copy-pasted at every call site, which is how actual_minutes, completed_at
 * and focus ended up missing from several of them.
 */
function rowToTask(r: any): Task {
  return {
    id: r.id,
    title: r.title,
    course: r.course,
    courseId: r.course_id ?? null,
    dueDate: new Date(r.due_date).toISOString(),
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    estimatedMinutes: r.estimated_minutes ?? null,
    estimateOrigin: (r.estimate_origin as any) ?? null,
    actualMinutes: r.actual_minutes ?? null,
    priority: r.priority ?? null,
    notes: r.notes ?? null,
    attachments: (r.attachments as any) ?? null,
    dependsOn: (r.depends_on as any) ?? null,
    tags: (r.tags as any) ?? null,
    term: r.term ?? null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    focus: r.focus ?? null,
    pagesRead: r.pages_read ?? null,
    activity: r.activity ?? null,
    originalPageRanges: r.original_page_ranges ?? null,
    remainingPageRanges: r.remaining_page_ranges ?? null,
  };
}

export async function listTasks(overridePool?: Pool): Promise<Task[]> {
  if (DB_URL) {
    const p = overridePool || getPool();
    type TaskRow = { id: string; title: string; course: string | null; course_id: string | null; due_date: Date | string; status: 'todo' | 'done'; created_at: Date | string; estimated_minutes: number | null; estimate_origin: string | null; actual_minutes: number | null; priority: number | null; notes: string | null; attachments: string[] | null; depends_on: string[] | null; tags: string[] | null; term: string | null; completed_at: Date | string | null; focus: number | null; pages_read: number | null; activity: string | null; start_time: string | null; end_time: string | null };
    const res = await p.query(`SELECT id, title, course, course_id, due_date, status, created_at, estimated_minutes, estimate_origin, actual_minutes, priority, notes, attachments, depends_on, tags, term, completed_at, focus, pages_read, activity, start_time, end_time, original_page_ranges, remaining_page_ranges FROM tasks ORDER BY due_date ASC, COALESCE(start_time,'99:99') ASC`);
    return (res.rows as any[]).map(rowToTask);
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
      `INSERT INTO tasks (id, title, course, course_id, due_date, status, created_at, estimated_minutes, estimate_origin, priority, notes, attachments, depends_on, tags, term, start_time, end_time, pages_read, activity, original_page_ranges, remaining_page_ranges)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id, title, course, course_id, due_date, status, created_at, estimated_minutes, estimate_origin, actual_minutes, completed_at, focus, priority, notes, attachments, depends_on, tags, term, start_time, end_time, pages_read, activity, original_page_ranges, remaining_page_ranges`,
      [id, input.title, input.course ?? null, input.courseId ?? null, new Date(input.dueDate), input.status ?? 'todo', new Date(now), input.estimatedMinutes ?? null, (input as any).estimateOrigin ?? null, input.priority ?? null, input.notes ?? null, input.attachments ?? null, input.dependsOn ?? null, input.tags ?? null, input.term ?? null, (input as any).startTime ?? null, (input as any).endTime ?? null, (input as any).pagesRead ?? null, (input as any).activity ?? null, input.originalPageRanges ?? null, input.remainingPageRanges ?? null]
    );
    return rowToTask(res.rows[0]);
  }
  const task: Task = { id: uuid(), title: input.title, course: input.course ?? null, courseId: input.courseId ?? null, dueDate: input.dueDate, status: input.status ?? 'todo', createdAt: now, startTime: (input as any).startTime ?? null, endTime: (input as any).endTime ?? null, estimatedMinutes: input.estimatedMinutes ?? null, estimateOrigin: (input as any).estimateOrigin ?? null, priority: input.priority ?? null, notes: input.notes ?? null, attachments: input.attachments ?? null, dependsOn: input.dependsOn ?? null, tags: input.tags ?? null, term: input.term ?? null, pagesRead: (input as any).pagesRead ?? null, activity: (input as any).activity ?? null, originalPageRanges: input.originalPageRanges ?? null, remainingPageRanges: input.remainingPageRanges ?? null };
  await mutateJson(db => { db.tasks.push(task); });
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
    if (patch.courseId !== undefined) { fields.push(`course_id = $${idx++}`); values.push(patch.courseId); }
    if (patch.dueDate !== undefined) { fields.push(`due_date = $${idx++}`); values.push(new Date(patch.dueDate)); }
    if (patch.status !== undefined) { fields.push(`status = $${idx++}`); values.push(patch.status); }
    if (patch.estimatedMinutes !== undefined) { fields.push(`estimated_minutes = $${idx++}`); values.push(patch.estimatedMinutes); }
    if ((patch as any).estimateOrigin !== undefined) { fields.push(`estimate_origin = $${idx++}`); values.push((patch as any).estimateOrigin); }
    if (patch.priority !== undefined) { fields.push(`priority = $${idx++}`); values.push(patch.priority); }
    if (patch.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(patch.notes); }
    if (patch.attachments !== undefined) { fields.push(`attachments = $${idx++}`); values.push(patch.attachments); }
    if (patch.dependsOn !== undefined) { fields.push(`depends_on = $${idx++}`); values.push(patch.dependsOn); }
    if (patch.tags !== undefined) { fields.push(`tags = $${idx++}`); values.push(patch.tags); }
    if (patch.term !== undefined) { fields.push(`term = $${idx++}`); values.push(patch.term); }
    // These were accepted by the API and silently discarded here, so finishing
    // a task never recorded how long it actually took, how focused it was, or
    // when it was completed - which also left the predictive timing card with
    // nothing to learn from.
    if (patch.actualMinutes !== undefined) { fields.push(`actual_minutes = $${idx++}`); values.push(patch.actualMinutes); }
    if (patch.completedAt !== undefined) { fields.push(`completed_at = $${idx++}`); values.push(patch.completedAt ? new Date(patch.completedAt) : null); }
    if (patch.focus !== undefined) { fields.push(`focus = $${idx++}`); values.push(patch.focus); }
    if (patch.originalPageRanges !== undefined) { fields.push(`original_page_ranges = $${idx++}`); values.push(patch.originalPageRanges); }
    if (patch.remainingPageRanges !== undefined) { fields.push(`remaining_page_ranges = $${idx++}`); values.push(patch.remainingPageRanges); }
    if ((patch as any).pagesRead !== undefined) { fields.push(`pages_read = $${idx++}`); values.push((patch as any).pagesRead); }
    if ((patch as any).activity !== undefined) { fields.push(`activity = $${idx++}`); values.push((patch as any).activity); }
    if ((patch as any).startTime !== undefined) { fields.push(`start_time = $${idx++}`); values.push((patch as any).startTime); }
    if ((patch as any).endTime !== undefined) { fields.push(`end_time = $${idx++}`); values.push((patch as any).endTime); }
    if (!fields.length) {
      const cur = await p.query(`SELECT id, title, course, course_id, due_date, status, created_at, estimated_minutes, estimate_origin, actual_minutes, completed_at, focus, priority, notes, attachments, depends_on, tags, term, start_time, end_time, pages_read, activity, original_page_ranges, remaining_page_ranges FROM tasks WHERE id=$1`, [id]);
      if (!cur.rowCount) return null;
      const r = cur.rows[0];
      return rowToTask(r);
    }
    const q = `UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, title, course, course_id, due_date, status, created_at, estimated_minutes, estimate_origin, actual_minutes, completed_at, focus, priority, notes, attachments, depends_on, tags, term, start_time, end_time, pages_read, activity, original_page_ranges, remaining_page_ranges`;
    values.push(id);
    const res = await p.query(q, values);
    if (!res.rowCount) return null;
    const r = res.rows[0];
    return rowToTask(r);
  }
  return mutateJson(db => {
    const i = db.tasks.findIndex(t => t.id === id);
    if (i === -1) return null;
    const updated: Task = { ...db.tasks[i], ...patch } as Task;
    db.tasks[i] = updated;
    return updated;
  });
}

export async function deleteTask(id: string): Promise<boolean> {
  if (DB_URL) {
    const p = getPool();
    await p.query(`DELETE FROM schedule_blocks WHERE task_id=$1`, [id]).catch(() => undefined);
    const res = await p.query(`DELETE FROM tasks WHERE id=$1`, [id]);
    return res.rowCount > 0;
  }
  return mutateJson(db => {
    const before = db.tasks.length;
    db.tasks = db.tasks.filter(t => t.id !== id);
    // Drop schedule blocks that pointed at the task so a deleted task cannot
    // be re-planned onto the week grid.
    db.scheduleBlocks = (db.scheduleBlocks || []).filter(b => b.taskId !== id);
    return db.tasks.length < before;
  });
}

// Sessions
export async function listSessions(overridePool?: Pool): Promise<StudySession[]> {
  if (DB_URL) {
    const p = overridePool || getPool();
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
    const created: StudySession = { id: r.id, taskId: r.task_id, when: new Date(r.when_ts).toISOString(), minutes: r.minutes, focus: r.focus, notes: r.notes, pagesRead: r.pages_read, outlinePages: r.outline_pages, practiceQs: r.practice_qs, activity: r.activity, createdAt: new Date(r.created_at).toISOString() };
    try {
      if (input.taskId) {
        const tc = await p.query(`SELECT course FROM tasks WHERE id=$1`, [input.taskId]);
        const courseTitle = tc.rows?.[0]?.course as string | null;
        if (courseTitle) await recomputeLearnedMppForCourse(courseTitle);
      }
    } catch {}
    return created;
  }
  const s: StudySession = { id: uuid(), taskId: input.taskId ?? null, when: whenISO, minutes: input.minutes, focus: input.focus ?? null, notes: input.notes ?? null, pagesRead: input.pagesRead ?? null, outlinePages: input.outlinePages ?? null, practiceQs: input.practiceQs ?? null, activity: input.activity ?? null, createdAt: now };
  await mutateJson(db => {
  db.sessions.unshift(s);
  // Recompute learned MPP for the affected course (if any)
  try {
    const courseTitle = s.taskId ? (db.tasks.find(t => t.id === s.taskId)?.course || null) : null;
    if (courseTitle) {
      // Update on the in-memory db and persist
      const tasks = db.tasks.filter(t => (t.course || '') === courseTitle);
      const taskIds = new Set(tasks.map(t => t.id));
      let mpps = db.sessions
        .filter(ss => ss.taskId && taskIds.has(ss.taskId) && typeof ss.minutes === 'number' && typeof ss.pagesRead === 'number')
        .sort((a,b) => a.when.localeCompare(b.when))
        .map(ss => ({ mpp: (ss.minutes as number) / Math.max(1, ss.pagesRead as number), minutes: ss.minutes as number, pages: ss.pagesRead as number }))
        .filter(x => x.minutes >= 5 && x.minutes <= 240 && x.pages >= 2 && x.pages <= 150)
        .map(x => x.mpp);
      mpps = zscoreTrim(mpps);
      const sample = mpps.length;
      let learned: number | null = null;
      if (sample > 0) {
        const alpha = 0.3;
        let ema = baselineMpp();
        for (const v of mpps) ema = alpha * v + (1 - alpha) * ema;
        learned = clamp(ema, 0.5, 6.0);
      }
      const i = db.courses.findIndex(c => (c.title || '') === courseTitle);
      if (i !== -1) {
        (db.courses[i] as any).learnedMpp = learned;
        (db.courses[i] as any).learnedSample = sample || null;
        (db.courses[i] as any).learnedUpdatedAt = new Date().toISOString();
      }
    }
  } catch {}
  });
  return s;
}

// Reset all study sessions. Returns number of rows removed (best-effort in JSON mode)
export async function resetAllSessions(): Promise<number> {
  if (DB_URL) {
    const p = getPool();
    const res = await p.query(`DELETE FROM sessions`);
    // rowCount may be undefined for some drivers; treat as 0
    return (res as any)?.rowCount ?? 0;
  }
  return mutateJson(db => {
    const n = db.sessions.length;
    db.sessions = [];
    return n;
  });
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

  // 7-day rolling averages (past 7 days)
  const past7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const past7Sessions = sessions.filter(s => new Date(s.when) >= past7Start && new Date(s.when) <= now);
  const past7Minutes = past7Sessions.reduce((acc, s) => acc + (s.minutes || 0), 0);
  const avgHours7d = past7Minutes > 0 ? Math.round((past7Minutes / 60 / 7) * 10) / 10 : null;
  const past7Focus = past7Sessions.map(s => s.focus).filter((n): n is number => typeof n === 'number');
  const avgFocus7d = past7Focus.length ? Math.round((past7Focus.reduce((a, b) => a + b, 0) / past7Focus.length) * 10) / 10 : null;

  // Subject averages for predictive timing (completed tasks with actual minutes)
  const completedTasks = tasks.filter(t => t.status === 'done' && t.actualMinutes && t.actualMinutes > 0);
  const subjectMap = new Map<string, { totalMinutes: number; totalFocus: number; count: number }>();
  
  for (const task of completedTasks) {
    const subject = task.course || 'Other';
    const existing = subjectMap.get(subject) || { totalMinutes: 0, totalFocus: 0, count: 0 };
    existing.totalMinutes += task.actualMinutes!;
    existing.count += 1;
    if (task.focus && task.focus > 0) {
      existing.totalFocus += task.focus;
    }
    subjectMap.set(subject, existing);
  }
  
  const subjectAverages = Array.from(subjectMap.entries())
    .map(([subject, data]) => ({
      subject,
      avgMinutesPerTask: Math.round(data.totalMinutes / data.count),
      avgFocus: data.totalFocus > 0 ? Math.round((data.totalFocus / data.count) * 10) / 10 : 0,
      totalTasks: data.count,
    }))
    .filter(item => item.totalTasks >= 2) // Only include subjects with at least 2 completed tasks
    .sort((a, b) => b.totalTasks - a.totalTasks);

  return { 
    upcoming7d, 
    hoursThisWeek, 
    avgFocusThisWeek, 
    estMinutesThisWeek, 
    loggedMinutesThisWeek, 
    remainingMinutesThisWeek, 
    courseBreakdown, 
    dailyEst: daily, 
    heavyDays, 
    maxDayMinutes,
    avgHours7d,
    avgFocus7d,
    subjectAverages
  };
}
