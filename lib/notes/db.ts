import { Pool } from 'pg';
import type { AiNoteSummary, NoteFilters, NoteNotebook, NoteSourceType } from './types';

function databaseUrl(): string | null {
  const direct = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING;
  if (direct) return direct;

  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  if (!PGHOST || !PGUSER || !PGPASSWORD || !PGDATABASE) return null;
  return `postgres://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}${PGPORT ? `:${PGPORT}` : ''}/${PGDATABASE}?sslmode=require`;
}

const DB_URL = databaseUrl();
let pool: Pool | null = null;

export function notesDb(): Pool {
  if (!DB_URL) throw new Error('A Postgres database is required for notes.');
  if (!pool) {
    pool = new Pool({
      connectionString: DB_URL,
      ssl: DB_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function ensureNotesSchema(): Promise<void> {
  const db = notesDb();
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_note_notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      course TEXT,
      semester TEXT,
      color TEXT,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      course TEXT,
      semester TEXT,
      class_date DATE,
      source_type TEXT NOT NULL DEFAULT 'other',
      topics TEXT[] NOT NULL DEFAULT '{}',
      original_filename TEXT,
      mime_type TEXT,
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS notebook_id TEXT`);
  await db.query(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'Notes'`);
  await db.query(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`CREATE INDEX IF NOT EXISTS ai_notes_course_idx ON ai_notes (LOWER(course))`);
  await db.query(`CREATE INDEX IF NOT EXISTS ai_notes_notebook_idx ON ai_notes (notebook_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS ai_notes_section_idx ON ai_notes (notebook_id, LOWER(section))`);
  await db.query(`CREATE INDEX IF NOT EXISTS ai_notes_class_date_idx ON ai_notes (class_date)`);
  await db.query(`CREATE INDEX IF NOT EXISTS ai_note_notebooks_semester_idx ON ai_note_notebooks (LOWER(semester))`);
  await db.query(`
    CREATE INDEX IF NOT EXISTS ai_notes_search_idx
    ON ai_notes USING GIN (
      to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(content, ''))
    )
  `);

  await db.query(`
    INSERT INTO ai_note_notebooks (id, name, course, semester)
    SELECT DISTINCT
      'legacy-' || md5(
        LOWER(TRIM(source.course)) || '|' ||
        LOWER(COALESCE(TRIM(source.semester), ''))
      ),
      TRIM(source.course),
      TRIM(source.course),
      NULLIF(TRIM(source.semester), '')
    FROM ai_notes source
    WHERE NULLIF(TRIM(source.course), '') IS NOT NULL
    ON CONFLICT (id) DO NOTHING
  `);
  await db.query(`
    UPDATE ai_notes note
    SET notebook_id = notebook.id
    FROM ai_note_notebooks notebook
    WHERE note.notebook_id IS NULL
      AND NULLIF(TRIM(note.course), '') IS NOT NULL
      AND LOWER(notebook.name) = LOWER(TRIM(note.course))
      AND COALESCE(LOWER(notebook.semester), '') =
          COALESCE(LOWER(NULLIF(TRIM(note.semester), '')), '')
  `);
}

export function cleanText(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result || null;
}

export function cleanTopics(values: string[] | undefined): string[] {
  return (values || [])
    .map(value => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.findIndex(item => item.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 50);
}

export function countWords(value: string): number {
  const cleaned = value.trim();
  return cleaned ? cleaned.split(/\s+/).length : 0;
}

export function clampLimit(value: number | undefined, maximum: number, fallback = 50): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(Math.floor(value as number), maximum))
    : Math.min(fallback, maximum);
}

function iso(value: unknown): string {
  return new Date(value as string | number | Date).toISOString();
}

export function toNoteSummary(row: any): AiNoteSummary {
  const previewText = String(row.preview_text ?? row.content ?? '').replace(/\s+/g, ' ').trim();
  return {
    id: row.id,
    title: row.title,
    notebookId: row.notebook_id ?? null,
    notebookName: row.notebook_name ?? null,
    course: row.course ?? null,
    semester: row.semester ?? null,
    section: row.section || 'Notes',
    classDate: row.class_date ? iso(row.class_date).slice(0, 10) : null,
    sourceType: row.source_type as NoteSourceType,
    topics: Array.isArray(row.topics) ? row.topics : [],
    originalFilename: row.original_filename ?? null,
    mimeType: row.mime_type ?? null,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    wordCount: Number(row.word_count) || 0,
    preview: previewText.slice(0, 240),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toNotebook(row: any): NoteNotebook {
  return {
    id: row.id,
    name: row.name,
    course: row.course ?? null,
    semester: row.semester ?? null,
    color: row.color ?? null,
    archived: Boolean(row.archived),
    noteCount: Number(row.note_count) || 0,
    sections: Array.isArray(row.sections) ? row.sections.filter(Boolean) : [],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function addNoteFilters(input: NoteFilters, clauses: string[], values: unknown[], alias = 'note'): void {
  if (input.notebookId?.trim()) {
    values.push(input.notebookId.trim());
    clauses.push(`${alias}.notebook_id = $${values.length}`);
  }
  if (input.course?.trim()) {
    values.push(`%${input.course.trim()}%`);
    clauses.push(`${alias}.course ILIKE $${values.length}`);
  }
  if (input.semester?.trim()) {
    values.push(input.semester.trim());
    clauses.push(`${alias}.semester = $${values.length}`);
  }
  if (input.section?.trim()) {
    values.push(input.section.trim());
    clauses.push(`${alias}.section = $${values.length}`);
  }
  if (input.from?.trim()) {
    values.push(input.from.trim());
    clauses.push(`${alias}.class_date >= $${values.length}::date`);
  }
  if (input.to?.trim()) {
    values.push(input.to.trim());
    clauses.push(`${alias}.class_date <= $${values.length}::date`);
  }
  values.push(input.archived === true);
  clauses.push(`${alias}.archived = $${values.length}`);
}

export async function getNotebookDefaults(id: string | null | undefined): Promise<{ course: string | null; semester: string | null } | null> {
  if (!id) return null;
  const result = await notesDb().query(`SELECT course, semester FROM ai_note_notebooks WHERE id = $1`, [id]);
  if (!result.rowCount) return null;
  return { course: result.rows[0].course ?? null, semester: result.rows[0].semester ?? null };
}
