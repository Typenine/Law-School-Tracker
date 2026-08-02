import { randomUUID } from 'crypto';
import { Pool, type PoolClient } from 'pg';

export type NoteSourceType =
  | 'class-notes'
  | 'reading-notes'
  | 'case-brief'
  | 'outline'
  | 'professor-material'
  | 'other';

export interface NoteNotebook {
  id: string;
  name: string;
  course: string | null;
  semester: string | null;
  color: string | null;
  archived: boolean;
  noteCount: number;
  sections: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AiNoteSummary {
  id: string;
  title: string;
  notebookId: string | null;
  notebookName: string | null;
  course: string | null;
  semester: string | null;
  section: string;
  classDate: string | null;
  sourceType: NoteSourceType;
  topics: string[];
  originalFilename: string | null;
  mimeType: string | null;
  pinned: boolean;
  archived: boolean;
  wordCount: number;
  preview: string;
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
  notebookId?: string | null;
  course?: string | null;
  semester?: string | null;
  section?: string | null;
  from?: string | null;
  to?: string | null;
  archived?: boolean;
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

  // Preserve any notes created before notebooks existed by grouping them into
  // course notebooks. Notes without a course remain available under Unfiled.
  await db.query(`
    INSERT INTO ai_note_notebooks (id, name, course, semester)
    SELECT
      'legacy-' || md5(LOWER(TRIM(course)) || '|' || LOWER(COALESCE(TRIM(semester), ''))),
      TRIM(course),
      TRIM(course),
      NULLIF(TRIM(semester), '')
    FROM ai_notes source
    WHERE NULLIF(TRIM(course), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM ai_note_notebooks notebook
        WHERE LOWER(notebook.name) = LOWER(TRIM(source.course))
          AND COALESCE(LOWER(notebook.semester), '') = COALESCE(LOWER(NULLIF(TRIM(source.semester), '')), '')
      )
    GROUP BY TRIM(course), NULLIF(TRIM(semester), '')
  `);

  await db.query(`
    UPDATE ai_notes note
    SET notebook_id = notebook.id
    FROM ai_note_notebooks notebook
    WHERE note.notebook_id IS NULL
      AND NULLIF(TRIM(note.course), '') IS NOT NULL
      AND LOWER(notebook.name) = LOWER(TRIM(note.course))
      AND COALESCE(LOWER(notebook.semester), '') = COALESCE(LOWER(NULLIF(TRIM(note.semester), '')), '')
  `);
}

function clampLimit(value: number | undefined, max: number): number {
  if (!Number.isFinite(value)) return Math.min(50, max);
  return Math.max(1, Math.min(Math.floor(value as number), max));
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanTopics(topics: string[] | undefined): string[] {
  return (topics || [])
    .map(topic => topic.trim())
    .filter(Boolean)
    .filter((topic, index, all) => all.findIndex(candidate => candidate.toLowerCase() === topic.toLowerCase()) === index)
    .slice(0, 50);
}

function countWords(content: string): number {
  const normalized = content.trim();
  return normalized ? normalized.split(/\s+/).length : 0;
}

function makePreview(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function toSummary(row: any): AiNoteSummary {
  const contentForPreview = String(row.preview_text ?? row.content ?? '');
  return {
    id: row.id,
    title: row.title,
    notebookId: row.notebook_id ?? null,
    notebookName: row.notebook_name ?? null,
    course: row.course ?? null,
    semester: row.semester ?? null,
    section: row.section || 'Notes',
    classDate: row.class_date ? new Date(row.class_date).toISOString().slice(0, 10) : null,
    sourceType: row.source_type as NoteSourceType,
    topics: Array.isArray(row.topics) ? row.topics : [],
    originalFilename: row.original_filename ?? null,
    mimeType: row.mime_type ?? null,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    wordCount: Number(row.word_count) || 0,
    preview: makePreview(contentForPreview),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toNotebook(row: any): NoteNotebook {
  return {
    id: row.id,
    name: row.name,
    course: row.course ?? null,
    semester: row.semester ?? null,
    color: row.color ?? null,
    archived: Boolean(row.archived),
    noteCount: Number(row.note_count) || 0,
    sections: Array.isArray(row.sections) ? row.sections.filter(Boolean) : [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function addFilters(
  filters: NoteFilters,
  clauses: string[],
  values: unknown[],
  alias = 'note',
): void {
  if (filters.notebookId?.trim()) {
    values.push(filters.notebookId.trim());
    clauses.push(`${alias}.notebook_id = $${values.length}`);
  }
  if (filters.course?.trim()) {
    values.push(`%${filters.course.trim()}%`);
    clauses.push(`${alias}.course ILIKE $${values.length}`);
  }
  if (filters.semester?.trim()) {
    values.push(filters.semester.trim());
    clauses.push(`${alias}.semester = $${values.length}`);
  }
  if (filters.section?.trim()) {
    values.push(filters.section.trim());
    clauses.push(`${alias}.section = $${values.length}`);
  }
  if (filters.from?.trim()) {
    values.push(filters.from.trim());
    clauses.push(`${alias}.class_date >= $${values.length}::date`);
  }
  if (filters.to?.trim()) {
    values.push(filters.to.trim());
    clauses.push(`${alias}.class_date <= $${values.length}::date`);
  }
  values.push(filters.archived === true);
  clauses.push(`${alias}.archived = $${values.length}`);
}

async function notebookDefaults(
  notebookId: string | null | undefined,
  client: Pool | PoolClient = getPool(),
): Promise<{ course: string | null; semester: string | null } | null> {
  if (!notebookId) return null;
  const result = await client.query(
    `SELECT course, semester FROM ai_note_notebooks WHERE id = $1`,
    [notebookId],
  );
  if (!result.rowCount) return null;
  return {
    course: result.rows[0].course ?? null,
    semester: result.rows[0].semester ?? null,
  };
}

export async function createNotebook(input: {
  name: string;
  course?: string | null;
  semester?: string | null;
  color?: string | null;
}): Promise<NoteNotebook> {
  await ensureAiNotesSchema();
  const name = input.name.trim();
  const id = randomUUID();
  const result = await getPool().query(
    `INSERT INTO ai_note_notebooks (id, name, course, semester, color)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *, 0::int AS note_count, ARRAY[]::text[] AS sections`,
    [
      id,
      name,
      cleanText(input.course) || name,
      cleanText(input.semester),
      cleanText(input.color),
    ],
  );
  return toNotebook(result.rows[0]);
}

export async function listNotebooks(archived = false): Promise<NoteNotebook[]> {
  await ensureAiNotesSchema();
  const result = await getPool().query(
    `SELECT
       notebook.*,
       COUNT(note.id)::int AS note_count,
       COALESCE(
         ARRAY_AGG(DISTINCT note.section ORDER BY note.section)
           FILTER (WHERE note.id IS NOT NULL AND note.archived = FALSE),
         ARRAY[]::text[]
       ) AS sections
     FROM ai_note_notebooks notebook
     LEFT JOIN ai_notes note ON note.notebook_id = notebook.id
     WHERE notebook.archived = $1
     GROUP BY notebook.id, notebook.name, notebook.course, notebook.semester,
              notebook.color, notebook.archived, notebook.created_at, notebook.updated_at
     ORDER BY COALESCE(notebook.semester, 'Unsorted') DESC, LOWER(notebook.name) ASC`,
    [archived],
  );
  return result.rows.map(toNotebook);
}

export async function getNotebook(id: string): Promise<NoteNotebook | null> {
  await ensureAiNotesSchema();
  const result = await getPool().query(
    `SELECT
       notebook.*,
       COUNT(note.id)::int AS note_count,
       COALESCE(
         ARRAY_AGG(DISTINCT note.section ORDER BY note.section)
           FILTER (WHERE note.id IS NOT NULL AND note.archived = FALSE),
         ARRAY[]::text[]
       ) AS sections
     FROM ai_note_notebooks notebook
     LEFT JOIN ai_notes note ON note.notebook_id = notebook.id
     WHERE notebook.id = $1
     GROUP BY notebook.id, notebook.name, notebook.course, notebook.semester,
              notebook.color, notebook.archived, notebook.created_at, notebook.updated_at`,
    [id],
  );
  return result.rowCount ? toNotebook(result.rows[0]) : null;
}

export async function updateNotebook(
  id: string,
  input: Partial<Pick<NoteNotebook, 'name' | 'course' | 'semester' | 'color' | 'archived'>>,
): Promise<NoteNotebook | null> {
  await ensureAiNotesSchema();
  const db = getPool();
  const existingResult = await db.query(`SELECT * FROM ai_note_notebooks WHERE id = $1`, [id]);
  if (!existingResult.rowCount) return null;
  const existing = existingResult.rows[0];

  const name = input.name === undefined ? existing.name : input.name.trim();
  const course = input.course === undefined ? existing.course : cleanText(input.course);
  const semester = input.semester === undefined ? existing.semester : cleanText(input.semester);
  const color = input.color === undefined ? existing.color : cleanText(input.color);
  const archived = input.archived === undefined ? existing.archived : input.archived;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ai_note_notebooks
       SET name = $2, course = $3, semester = $4, color = $5, archived = $6, updated_at = NOW()
       WHERE id = $1`,
      [id, name, course, semester, color, archived],
    );
    await client.query(
      `UPDATE ai_notes
       SET course = $2, semester = $3, updated_at = NOW()
       WHERE notebook_id = $1`,
      [id, course, semester],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getNotebook(id);
}

export async function deleteNotebook(id: string): Promise<boolean> {
  await ensureAiNotesSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ai_notes SET notebook_id = NULL, updated_at = NOW() WHERE notebook_id = $1`,
      [id],
    );
    const result = await client.query(`DELETE FROM ai_note_notebooks WHERE id = $1`, [id]);
    await client.query('COMMIT');
    return (result.rowCount || 0) > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createAiNote(input: {
  title: string;
  notebookId?: string | null;
  course?: string | null;
  semester?: string | null;
  section?: string | null;
  classDate?: string | null;
  sourceType?: NoteSourceType;
  topics?: string[];
  originalFilename?: string | null;
  mimeType?: string | null;
  pinned?: boolean;
  archived?: boolean;
  content?: string;
}): Promise<AiNote> {
  await ensureAiNotesSchema();
  const db = getPool();
  const id = randomUUID();
  const content = String(input.content || '').replace(/\u0000/g, '');
  const defaults = await notebookDefaults(input.notebookId, db);
  const course = input.course === undefined ? defaults?.course || null : cleanText(input.course);
  const semester = input.semester === undefined ? defaults?.semester || null : cleanText(input.semester);
  const topics = cleanTopics(input.topics);

  const result = await db.query(
    `INSERT INTO ai_notes (
      id, title, notebook_id, course, semester, section, class_date, source_type,
      topics, original_filename, mime_type, pinned, archived, content, word_count
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9::text[],$10,$11,$12,$13,$14,$15)
    RETURNING *,
      (SELECT name FROM ai_note_notebooks WHERE id = notebook_id) AS notebook_name`,
    [
      id,
      input.title.trim() || 'Untitled Page',
      input.notebookId || null,
      course,
      semester,
      cleanText(input.section) || 'Notes',
      cleanText(input.classDate),
      input.sourceType || 'class-notes',
      topics,
      cleanText(input.originalFilename),
      cleanText(input.mimeType),
      Boolean(input.pinned),
      Boolean(input.archived),
      content,
      countWords(content),
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
  values.push(clampLimit(filters.limit, 500));
  const result = await getPool().query(
    `SELECT note.*, notebook.name AS notebook_name, LEFT(note.content, 500) AS preview_text
     FROM ai_notes note
     LEFT JOIN ai_note_notebooks notebook ON notebook.id = note.notebook_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY note.pinned DESC, note.updated_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(toSummary);
}

export async function getAiNote(id: string): Promise<AiNote | null> {
  await ensureAiNotesSchema();
  const result = await getPool().query(
    `SELECT note.*, notebook.name AS notebook_name
     FROM ai_notes note
     LEFT JOIN ai_note_notebooks notebook ON notebook.id = note.notebook_id
     WHERE note.id = $1`,
    [id],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { ...toSummary(row), content: row.content };
}

export async function updateAiNote(
  id: string,
  input: Partial<{
    title: string;
    notebookId: string | null;
    course: string | null;
    semester: string | null;
    section: string | null;
    classDate: string | null;
    sourceType: NoteSourceType;
    topics: string[];
    pinned: boolean;
    archived: boolean;
    content: string;
  }>,
): Promise<AiNote | null> {
  await ensureAiNotesSchema();
  const db = getPool();
  const current = await getAiNote(id);
  if (!current) return null;

  const notebookId = input.notebookId === undefined ? current.notebookId : input.notebookId;
  const defaults = notebookId !== current.notebookId ? await notebookDefaults(notebookId, db) : null;
  const content = input.content === undefined
    ? current.content
    : String(input.content).replace(/\u0000/g, '');
  const course = input.course === undefined
    ? (defaults ? defaults.course : current.course)
    : cleanText(input.course);
  const semester = input.semester === undefined
    ? (defaults ? defaults.semester : current.semester)
    : cleanText(input.semester);

  const result = await db.query(
    `UPDATE ai_notes
     SET title = $2,
         notebook_id = $3,
         course = $4,
         semester = $5,
         section = $6,
         class_date = $7::date,
         source_type = $8,
         topics = $9::text[],
         pinned = $10,
         archived = $11,
         content = $12,
         word_count = $13,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *,
       (SELECT name FROM ai_note_notebooks WHERE id = notebook_id) AS notebook_name`,
    [
      id,
      input.title === undefined ? current.title : input.title.trim() || 'Untitled Page',
      notebookId,
      course,
      semester,
      input.section === undefined ? current.section : cleanText(input.section) || 'Notes',
      input.classDate === undefined ? current.classDate : cleanText(input.classDate),
      input.sourceType === undefined ? current.sourceType : input.sourceType,
      input.topics === undefined ? current.topics : cleanTopics(input.topics),
      input.pinned === undefined ? current.pinned : input.pinned,
      input.archived === undefined ? current.archived : input.archived,
      content,
      countWords(content),
    ],
  );
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
    return notes.map(note => ({ ...note, excerpt: note.preview, score: 0 }));
  }

  const clauses: string[] = [];
  const values: unknown[] = [q];
  addFilters(filters, clauses, values);
  clauses.unshift(`(
    to_tsvector('english', COALESCE(note.title, '') || ' ' || COALESCE(note.content, ''))
      @@ websearch_to_tsquery('english', $1)
    OR note.title ILIKE '%' || $1 || '%'
    OR note.content ILIKE '%' || $1 || '%'
    OR array_to_string(note.topics, ' ') ILIKE '%' || $1 || '%'
  )`);
  values.push(clampLimit(filters.limit, 100));

  const result = await getPool().query(
    `SELECT note.*, notebook.name AS notebook_name,
      ts_rank_cd(
        to_tsvector('english', COALESCE(note.title, '') || ' ' || COALESCE(note.content, '')),
        websearch_to_tsquery('english', $1)
      ) AS score,
      ts_headline(
        'english',
        note.content,
        websearch_to_tsquery('english', $1),
        'StartSel=,StopSel=,MaxWords=140,MinWords=45,ShortWord=2,HighlightAll=false'
      ) AS excerpt
     FROM ai_notes note
     LEFT JOIN ai_note_notebooks notebook ON notebook.id = note.notebook_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY note.pinned DESC, score DESC, note.updated_at DESC
     LIMIT $${values.length}`,
    values,
  );

  return result.rows.map((row: any) => ({
    ...toSummary(row),
    excerpt: String(row.excerpt || '').replace(/\s+/g, ' ').trim(),
    score: Number(row.score) || 0,
  }));
}
