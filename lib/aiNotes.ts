import { randomUUID } from 'crypto';
import { Pool } from 'pg';

export type NoteSourceType =
  | 'class-notes'
  | 'reading-notes'
  | 'case-brief'
  | 'outline'
  | 'professor-material'
  | 'other';

export interface AiNoteSummary {
  id: string;
  title: string;
  course: string | null;
  semester: string | null;
  classDate: string | null;
  sourceType: NoteSourceType;
  topics: string[];
  originalFilename: string | null;
  mimeType: string | null;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiNote extends AiNoteSummary {
  content: string;
}

export interface AiNoteSearchResult extends AiNoteSummary {
  excerpt: string;
  score: number;
}

export interface NoteFilters {
  course?: string | null;
  semester?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}

function resolveDbUrl(): string | null {
  const direct = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING
    || null;
  if (direct) return direct;

  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env as Record<string, string | undefined>;
  if (!PGHOST || !PGUSER || !PGPASSWORD || !PGDATABASE) return null;
  const port = PGPORT ? `:${PGPORT}` : '';
  return `postgres://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}${port}/${PGDATABASE}?sslmode=require`;
}

const DB_URL = resolveDbUrl();
let pool: Pool | null = null;

function getPool(): Pool {
  if (!DB_URL) {
    throw new Error('A Postgres database is required for the notes system. Set DATABASE_URL in Vercel.');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: DB_URL,
      ssl: DB_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function ensureAiNotesSchema(): Promise<void> {
  const db = getPool();
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
  await db.query(`CREATE INDEX IF NOT EXISTS ai_notes_course_idx ON ai_notes (LOWER(course))`);
  await db.query(`CREATE INDEX IF NOT EXISTS ai_notes_class_date_idx ON ai_notes (class_date)`);
  await db.query(`
    CREATE INDEX IF NOT EXISTS ai_notes_search_idx
    ON ai_notes USING GIN (
      to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(content, ''))
    )
  `);
}

function clampLimit(value: number | undefined, max: number): number {
  if (!Number.isFinite(value)) return Math.min(20, max);
  return Math.max(1, Math.min(Math.floor(value as number), max));
}

function toSummary(row: any): AiNoteSummary {
  return {
    id: row.id,
    title: row.title,
    course: row.course ?? null,
    semester: row.semester ?? null,
    classDate: row.class_date ? new Date(row.class_date).toISOString().slice(0, 10) : null,
    sourceType: row.source_type as NoteSourceType,
    topics: Array.isArray(row.topics) ? row.topics : [],
    originalFilename: row.original_filename ?? null,
    mimeType: row.mime_type ?? null,
    wordCount: Number(row.word_count) || 0,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function addFilters(
  filters: NoteFilters,
  clauses: string[],
  values: unknown[],
): void {
  if (filters.course?.trim()) {
    values.push(`%${filters.course.trim()}%`);
    clauses.push(`course ILIKE $${values.length}`);
  }
  if (filters.semester?.trim()) {
    values.push(filters.semester.trim());
    clauses.push(`semester = $${values.length}`);
  }
  if (filters.from?.trim()) {
    values.push(filters.from.trim());
    clauses.push(`class_date >= $${values.length}::date`);
  }
  if (filters.to?.trim()) {
    values.push(filters.to.trim());
    clauses.push(`class_date <= $${values.length}::date`);
  }
}

export async function createAiNote(input: {
  title: string;
  course?: string | null;
  semester?: string | null;
  classDate?: string | null;
  sourceType?: NoteSourceType;
  topics?: string[];
  originalFilename?: string | null;
  mimeType?: string | null;
  content: string;
}): Promise<AiNote> {
  await ensureAiNotesSchema();
  const db = getPool();
  const id = randomUUID();
  const content = input.content.trim();
  const wordCount = content ? content.split(/\s+/).length : 0;
  const topics = (input.topics || [])
    .map(topic => topic.trim())
    .filter(Boolean)
    .slice(0, 50);

  const result = await db.query(
    `INSERT INTO ai_notes (
      id, title, course, semester, class_date, source_type, topics,
      original_filename, mime_type, content, word_count
    ) VALUES ($1,$2,$3,$4,$5::date,$6,$7::text[],$8,$9,$10,$11)
    RETURNING *`,
    [
      id,
      input.title.trim(),
      input.course?.trim() || null,
      input.semester?.trim() || null,
      input.classDate?.trim() || null,
      input.sourceType || 'other',
      topics,
      input.originalFilename || null,
      input.mimeType || null,
      content,
      wordCount,
    ],
  );
  const row = result.rows[0];
  return { ...toSummary(row), content: row.content };
}

export async function listAiNotes(filters: NoteFilters = {}): Promise<AiNoteSummary[]> {
  await ensureAiNotesSchema();
  const clauses: string[] = [];
  const values: unknown[] = [];
  addFilters(filters, clauses, values);
  values.push(clampLimit(filters.limit, 100));
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await getPool().query(
    `SELECT * FROM ai_notes ${where}
     ORDER BY COALESCE(class_date, created_at::date) DESC, created_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(toSummary);
}

export async function getAiNote(id: string): Promise<AiNote | null> {
  await ensureAiNotesSchema();
  const result = await getPool().query(`SELECT * FROM ai_notes WHERE id = $1`, [id]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { ...toSummary(row), content: row.content };
}

export async function deleteAiNote(id: string): Promise<boolean> {
  await ensureAiNotesSchema();
  const result = await getPool().query(`DELETE FROM ai_notes WHERE id = $1`, [id]);
  return (result.rowCount || 0) > 0;
}

export async function searchAiNotes(
  query: string,
  filters: NoteFilters = {},
): Promise<AiNoteSearchResult[]> {
  await ensureAiNotesSchema();
  const q = query.trim();
  if (!q) {
    const notes = await listAiNotes(filters);
    return notes.map(note => ({ ...note, excerpt: '', score: 0 }));
  }

  const clauses: string[] = [];
  const values: unknown[] = [q];
  addFilters(filters, clauses, values);
  clauses.unshift(`(
    to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(content, ''))
      @@ websearch_to_tsquery('english', $1)
    OR title ILIKE '%' || $1 || '%'
    OR content ILIKE '%' || $1 || '%'
  )`);
  values.push(clampLimit(filters.limit, 30));

  const result = await getPool().query(
    `SELECT *,
      ts_rank_cd(
        to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(content, '')),
        websearch_to_tsquery('english', $1)
      ) AS score,
      ts_headline(
        'english',
        content,
        websearch_to_tsquery('english', $1),
        'StartSel=,StopSel=,MaxWords=140,MinWords=45,ShortWord=2,HighlightAll=false'
      ) AS excerpt
     FROM ai_notes
     WHERE ${clauses.join(' AND ')}
     ORDER BY score DESC, COALESCE(class_date, created_at::date) DESC
     LIMIT $${values.length}`,
    values,
  );

  return result.rows.map((row: any) => ({
    ...toSummary(row),
    excerpt: String(row.excerpt || '').replace(/\s+/g, ' ').trim(),
    score: Number(row.score) || 0,
  }));
}
