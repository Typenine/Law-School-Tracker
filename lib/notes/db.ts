import { Pool } from 'pg';
import type { AiNoteSummary, NoteFilters, NoteNotebook, NoteSection, NoteSourceType } from './types';

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

/** The notes schema check runs on every notes request; do the work once. */
let notesSchemaReady: Promise<void> | null = null;

export async function ensureNotesSchema(): Promise<void> {
  if (!notesSchemaReady) {
    notesSchemaReady = applyNotesSchema().catch(e => { notesSchemaReady = null; throw e; });
  }
  return notesSchemaReady;
}

/**
 * Postgres error codes for "this object already exists".
 *
 * `CREATE TABLE/INDEX IF NOT EXISTS` is not atomic against a concurrent
 * creator: two serverless instances warming up at the same time both see the
 * object missing and both try to create it, and the loser fails with a
 * duplicate key on the pg_class catalog index. That surfaced in the UI as
 * `duplicate key value violates unique constraint "pg_class_relname_nsp_index"`.
 * These races are harmless - the object exists either way - so they are
 * ignored.
 */
const ALREADY_EXISTS = new Set([
  '42P07', // duplicate_table (covers indexes too)
  '42710', // duplicate_object
  '23505', // unique_violation, which is how the catalog race reports itself
  '42P16', // invalid_table_definition, raised by some concurrent DDL paths
]);

function isBenignSchemaRace(error: any): boolean {
  const code = String(error?.code || '');
  if (ALREADY_EXISTS.has(code)) return true;
  const message = String(error?.message || '');
  return /already exists|pg_class_relname_nsp_index|pg_type_typname_nsp_index/i.test(message);
}

/** Arbitrary but stable key so all instances contend on the same lock. */
const NOTES_SCHEMA_LOCK = 4021977;

async function applyNotesSchema(): Promise<void> {
  // The advisory lock is session-scoped, so it has to be taken, held and
  // released on one connection - going through the pool would unlock a
  // different session than the one holding it.
  const client = await notesDb().connect();

  /** Run a schema statement, tolerating a concurrent instance winning the race. */
  const run = async (sql: string) => {
    try {
      await client.query(sql);
    } catch (error) {
      if (isBenignSchemaRace(error)) return;
      console.warn('ensureNotesSchema: statement failed, continuing:', sql.replace(/\s+/g, ' ').slice(0, 110), (error as any)?.message || error);
    }
  };

  // Serialise migrations across instances. Best effort: if the lock cannot be
  // taken the statements below still tolerate losing the race.
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [NOTES_SCHEMA_LOCK]);
    locked = true;
  } catch {}

  try {
  await run(`
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
  await run(`
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
  await run(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS notebook_id TEXT`);
  await run(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'Notes'`);
  await run(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE`);
  await run(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE`);
  // Rich text for the editor. `content` stays plain text so search, previews
  // and the GPT endpoints keep working unchanged.
  await run(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS content_html TEXT`);
  await run(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0`);
  await run(`ALTER TABLE ai_note_notebooks ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0`);
  await run(`
    CREATE TABLE IF NOT EXISTS ai_note_sections (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Sections nest, so a name only has to be unique among its siblings:
  // "Week 1" can live under both Case Briefs and Reading Notes.
  await run(`ALTER TABLE ai_note_sections ADD COLUMN IF NOT EXISTS parent_id TEXT`);
  await run(`DROP INDEX IF EXISTS ai_note_sections_unique_idx`);
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_note_sections_sibling_idx
    ON ai_note_sections (notebook_id, COALESCE(parent_id, ''), LOWER(name))
  `);
  await run(`CREATE INDEX IF NOT EXISTS ai_note_sections_parent_idx ON ai_note_sections (parent_id)`);
  // Pages point at a section by id. The `section` name column stays as a
  // denormalised copy so search, the GPT endpoints and older rows keep working.
  await run(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS section_id TEXT`);
  // Deleting a page is recoverable: it goes to the trash rather than vanishing.
  await run(`ALTER TABLE ai_notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await run(`CREATE INDEX IF NOT EXISTS ai_notes_deleted_idx ON ai_notes (deleted_at)`);
  await run(`CREATE INDEX IF NOT EXISTS ai_notes_section_id_idx ON ai_notes (section_id)`);
  await run(`CREATE INDEX IF NOT EXISTS ai_notes_course_idx ON ai_notes (LOWER(course))`);
  await run(`CREATE INDEX IF NOT EXISTS ai_notes_notebook_idx ON ai_notes (notebook_id)`);
  await run(`CREATE INDEX IF NOT EXISTS ai_notes_section_idx ON ai_notes (notebook_id, LOWER(section))`);
  await run(`CREATE INDEX IF NOT EXISTS ai_notes_class_date_idx ON ai_notes (class_date)`);
  await run(`CREATE INDEX IF NOT EXISTS ai_note_notebooks_semester_idx ON ai_note_notebooks (LOWER(semester))`);
  await run(`
    CREATE INDEX IF NOT EXISTS ai_notes_search_idx
    ON ai_notes USING GIN (
      to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(content, ''))
    )
  `);

  await run(`
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
      -- Only pages that predate notebooks. Without this, every page filed in a
      -- real notebook also minted a duplicate "legacy" notebook for its course
      -- on each schema check.
      AND source.notebook_id IS NULL
    ON CONFLICT (id) DO NOTHING
  `);
  await run(`
    UPDATE ai_notes note
    SET notebook_id = notebook.id
    FROM ai_note_notebooks notebook
    WHERE note.notebook_id IS NULL
      AND NULLIF(TRIM(note.course), '') IS NOT NULL
      AND LOWER(notebook.name) = LOWER(TRIM(note.course))
      AND COALESCE(LOWER(notebook.semester), '') =
          COALESCE(LOWER(NULLIF(TRIM(note.semester), '')), '')
  `);

  // Promote the section names already stored on pages into real section rows
  // so they can be ordered, recoloured and renamed like OneNote tabs.
  //
  // Only pages that have never been filed qualify. Pages keep a denormalised
  // copy of their section name, so without the section_id guard this would run
  // on every boot and resurrect a top-level tab for every section anyone had
  // ever deleted. Pages in the trash are skipped for the same reason.
  await run(`
    INSERT INTO ai_note_sections (id, notebook_id, name)
    SELECT DISTINCT ON (note.notebook_id, LOWER(TRIM(note.section)))
      'section-' || md5(note.notebook_id || '|' || LOWER(TRIM(note.section))),
      note.notebook_id,
      TRIM(note.section)
    FROM ai_notes note
    WHERE note.notebook_id IS NOT NULL
      AND note.section_id IS NULL
      AND note.deleted_at IS NULL
      AND NULLIF(TRIM(note.section), '') IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
  // Attach existing pages to the section row matching their stored name.
  await run(`
    UPDATE ai_notes note
    SET section_id = section.id
    FROM ai_note_sections section
    WHERE note.section_id IS NULL
      AND note.deleted_at IS NULL
      AND section.notebook_id = note.notebook_id
      AND section.parent_id IS NULL
      AND LOWER(section.name) = LOWER(TRIM(note.section))
  `);

  // A page whose section was deleted out from under it would otherwise be
  // invisible: it is filed under an id that no longer resolves to anything.
  await run(`
    UPDATE ai_notes note
    SET section_id = NULL
    WHERE note.section_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ai_note_sections section WHERE section.id = note.section_id
      )
  `);

  // Every notebook gets at least one tab to write on.
  await run(`
    INSERT INTO ai_note_sections (id, notebook_id, name)
    SELECT 'section-' || md5(notebook.id || '|notes'), notebook.id, 'Notes'
    FROM ai_note_notebooks notebook
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_note_sections section WHERE section.notebook_id = notebook.id
    )
    ON CONFLICT DO NOTHING
  `);
  } finally {
    if (locked) { try { await client.query('SELECT pg_advisory_unlock($1)', [NOTES_SCHEMA_LOCK]); } catch {} }
    client.release();
  }
}

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => HTML_ENTITIES[char] || char);
}

/**
 * Reduce editor HTML to readable plain text. Block boundaries become newlines
 * and to-do items keep a visible checkbox so the exported/searched text still
 * reads the way the page looks.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<li([^>]*)data-checked="true"([^>]*)>/gi, '\n[x] ')
    .replace(/<li([^>]*)class="[^"]*nb-todo[^"]*"([^>]*)>/gi, '\n[ ] ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|h4|li|tr|blockquote|pre)>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<img[^>]*alt="([^"]+)"[^>]*>/gi, '\n[image: $1]\n')
    .replace(/<img[^>]*>/gi, '\n[image]\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Turn stored plain text into editor HTML. Used once per legacy page: notes
 * written before the rich editor existed are markdown-ish, so headings, list
 * markers and checkboxes are recognised rather than shown as literal syntax.
 */
export function plainTextToHtml(text: string): string {
  if (!text || !text.trim()) return '<p><br></p>';
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };
  const openList = (type: 'ul' | 'ol', className = '') => {
    if (listType !== type) {
      closeList();
      out.push(`<${type}${className ? ` class="${className}"` : ''}>`);
      listType = type;
    }
  };

  const inline = (value: string) => escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }

    const todo = /^\s*(?:[-*]\s*)?\[( |x|X)\]\s+(.*)$/.exec(line);
    if (todo) {
      openList('ul', 'nb-todo-list');
      out.push(`<li class="nb-todo" data-checked="${todo[1].toLowerCase() === 'x'}">${inline(todo[2])}</li>`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(4, Math.max(1, heading[1].length));
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      openList('ul');
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      openList('ol');
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('') || '<p><br></p>';
}

/**
 * Strip anything that should never round-trip through the editor. This is a
 * single-user private workspace, but pasted content can still carry scripts,
 * event handlers and remote resources.
 */
export function sanitizeNoteHtml(html: string): string {
  if (!html) return '<p><br></p>';
  const cleaned = html
    // Images are allowed, but only ones we serve: an arbitrary remote src is a
    // tracking pixel, and javascript:/data: are script vectors.
    .replace(/<img\b[^>]*>/gi, tag => {
      const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '';
      if (!/^https:\/\//i.test(src)) return '';
      const alt = /\salt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || '';
      return `<img src="${src.replace(/"/g, '&quot;')}" alt="${alt.replace(/"/g, '&quot;')}">`;
    })
    .replace(/<\s*(script|style|iframe|object|embed|form|input|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|link|meta)\b[^>]*\/?\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
  return cleaned || '<p><br></p>';
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
    sectionId: row.section_id ?? null,
    position: Number(row.position) || 0,
    classDate: row.class_date ? iso(row.class_date).slice(0, 10) : null,
    sourceType: row.source_type as NoteSourceType,
    topics: Array.isArray(row.topics) ? row.topics : [],
    originalFilename: row.original_filename ?? null,
    mimeType: row.mime_type ?? null,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    deletedAt: row.deleted_at ? iso(row.deleted_at) : null,
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
    position: Number(row.position) || 0,
    noteCount: Number(row.note_count) || 0,
    sections: Array.isArray(row.sections) ? row.sections.filter(Boolean) : [],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toSection(row: any): NoteSection {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    parentId: row.parent_id ?? null,
    name: row.name,
    color: row.color ?? null,
    position: Number(row.position) || 0,
    pageCount: Number(row.page_count) || 0,
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
  if (input.sectionId?.trim()) {
    values.push(input.sectionId.trim());
    clauses.push(`${alias}.section_id = $${values.length}`);
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
  // The trash is a separate view; everything else ignores deleted pages.
  clauses.push(input.deleted === true
    ? `${alias}.deleted_at IS NOT NULL`
    : `${alias}.deleted_at IS NULL`);
}

export async function getNotebookDefaults(id: string | null | undefined): Promise<{ course: string | null; semester: string | null } | null> {
  if (!id) return null;
  const result = await notesDb().query(`SELECT course, semester FROM ai_note_notebooks WHERE id = $1`, [id]);
  if (!result.rowCount) return null;
  return { course: result.rows[0].course ?? null, semester: result.rows[0].semester ?? null };
}
