import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import {
  addNoteFilters,
  clampLimit,
  cleanText,
  cleanTopics,
  countWords,
  ensureNotesSchema,
  getNotebookDefaults,
  htmlToPlainText,
  notesDb,
  plainTextToHtml,
  sanitizeNoteHtml,
  toNoteSummary,
} from './db';
import { resolveSection } from './sections';
import type {
  AiNote,
  AiNoteSearchResult,
  AiNoteSummary,
  NoteFilters,
  NoteSourceType,
} from './types';

/**
 * A page carries two representations of the same text: `contentHtml` is what
 * the editor shows, `content` is the plain-text projection used for search,
 * previews, word counts and the read-only GPT endpoints. Callers may supply
 * either one; the other is derived.
 */
function resolveContent(
  input: { content?: string; contentHtml?: string },
  fallback?: { content: string; contentHtml: string },
): { content: string; contentHtml: string } {
  const strip = (value: string) => value.replace(/\u0000/g, '');
  if (input.contentHtml !== undefined) {
    const html = sanitizeNoteHtml(strip(String(input.contentHtml)));
    return { contentHtml: html, content: htmlToPlainText(html) };
  }
  if (input.content !== undefined) {
    const text = strip(String(input.content));
    return { content: text, contentHtml: plainTextToHtml(text) };
  }
  return fallback ?? { content: '', contentHtml: '<p><br></p>' };
}

/** Thrown when a save would overwrite a newer version of the same page. */
export class NoteConflictError extends Error {
  readonly current: AiNote;
  constructor(current: AiNote) {
    super('This page was changed somewhere else since you opened it.');
    this.name = 'NoteConflictError';
    this.current = current;
  }
}

function toNote(row: any): AiNote {
  const content: string = row.content ?? '';
  // Legacy rows predate the rich editor; render their markdown-ish text.
  const contentHtml: string = row.content_html || plainTextToHtml(content);
  return { ...toNoteSummary(row), content, contentHtml };
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
  contentHtml?: string;
  sectionId?: string | null;
  taskId?: string | null;
}): Promise<AiNote> {
  await ensureNotesSchema();
  const { content, contentHtml } = resolveContent(input);
  const defaults = await getNotebookDefaults(input.notebookId);
  // A page belongs to a section row; the name is kept alongside it for search.
  const target = await resolveSection(input.notebookId || null, input.sectionId, input.section);
  const section = target?.name || cleanText(input.section) || 'Notes';
  const sectionId = target?.id ?? null;

  const nextPosition = await notesDb().query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS position FROM ai_notes
     WHERE COALESCE(section_id,'') = COALESCE($1,'')`,
    [sectionId],
  );

  const result = await notesDb().query(
    `INSERT INTO ai_notes (
       id,title,notebook_id,course,semester,section,section_id,class_date,source_type,topics,
       original_filename,mime_type,pinned,archived,content,content_html,word_count,position,task_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10::text[],$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *, (SELECT name FROM ai_note_notebooks WHERE id=notebook_id) AS notebook_name`,
    [
      randomUUID(), input.title.trim() || 'Untitled Page', input.notebookId || null,
      input.course === undefined ? defaults?.course || null : cleanText(input.course),
      input.semester === undefined ? defaults?.semester || null : cleanText(input.semester),
      section, sectionId, cleanText(input.classDate), input.sourceType || 'class-notes',
      cleanTopics(input.topics), cleanText(input.originalFilename), cleanText(input.mimeType),
      Boolean(input.pinned), Boolean(input.archived), content, contentHtml, countWords(content),
      Number(nextPosition.rows[0]?.position) || 0, cleanText(input.taskId),
    ],
  );
  return toNote(result.rows[0]);
}

export async function listAiNotes(input: NoteFilters = {}, overridePool?: Pool): Promise<AiNoteSummary[]> {
  await ensureNotesSchema();
  const clauses: string[] = [];
  const values: unknown[] = [];
  addNoteFilters(input, clauses, values);
  values.push(clampLimit(input.limit, 500));
  const result = await (overridePool || notesDb()).query(
    `SELECT note.*, notebook.name AS notebook_name, LEFT(note.content,500) AS preview_text
     FROM ai_notes note
     LEFT JOIN ai_note_notebooks notebook ON notebook.id=note.notebook_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY note.pinned DESC, note.position ASC, note.updated_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(toNoteSummary);
}

export async function getAiNote(id: string, overridePool?: Pool): Promise<AiNote | null> {
  await ensureNotesSchema();
  const result = await (overridePool || notesDb()).query(
    `SELECT note.*, notebook.name AS notebook_name
     FROM ai_notes note
     LEFT JOIN ai_note_notebooks notebook ON notebook.id=note.notebook_id
     WHERE note.id=$1`,
    [id],
  );
  if (!result.rowCount) return null;
  return toNote(result.rows[0]);
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
    contentHtml: string;
    position: number;
    sectionId: string | null;
    /** null unlinks the page from its reading assignment. */
    taskId: string | null;
    /**
     * The updatedAt the caller last saw. When supplied and the row has moved
     * on since, the save is refused instead of silently overwriting whatever
     * another device wrote.
     */
    expectedUpdatedAt: string | null;
  }>,
): Promise<AiNote | null> {
  await ensureNotesSchema();
  const current = await getAiNote(id);
  if (!current) return null;
  if (input.expectedUpdatedAt) {
    const seen = new Date(input.expectedUpdatedAt).getTime();
    const now = new Date(current.updatedAt).getTime();
    // Both values are the same database timestamp serialized to milliseconds,
    // so any later value is a real concurrent edit rather than clock drift.
    if (Number.isFinite(seen) && Number.isFinite(now) && now > seen) {
      throw new NoteConflictError(current);
    }
  }
  const notebookId = input.notebookId === undefined ? current.notebookId : input.notebookId;
  const defaults = notebookId !== current.notebookId ? await getNotebookDefaults(notebookId) : null;
  const { content, contentHtml } = resolveContent(input, {
    content: current.content,
    contentHtml: current.contentHtml,
  });
  let section = current.section;
  let sectionId = current.sectionId;
  if (input.sectionId !== undefined || input.section !== undefined || notebookId !== current.notebookId) {
    const target = await resolveSection(
      notebookId,
      input.sectionId !== undefined ? input.sectionId : (notebookId === current.notebookId ? current.sectionId : null),
      input.section !== undefined ? input.section : current.section,
    );
    section = target?.name || cleanText(input.section) || current.section;
    sectionId = target?.id ?? null;
  }

  const result = await notesDb().query(
    `UPDATE ai_notes SET
       title=$2, notebook_id=$3, course=$4, semester=$5, section=$6, class_date=$7::date,
       source_type=$8, topics=$9::text[], pinned=$10, archived=$11, content=$12,
       content_html=$13, word_count=$14, position=$15, section_id=$16, task_id=$17,
       updated_at=NOW()
     WHERE id=$1
     RETURNING *, (SELECT name FROM ai_note_notebooks WHERE id=notebook_id) AS notebook_name`,
    [
      id,
      input.title === undefined ? current.title : input.title.trim() || 'Untitled Page',
      notebookId,
      input.course === undefined ? (defaults ? defaults.course : current.course) : cleanText(input.course),
      input.semester === undefined ? (defaults ? defaults.semester : current.semester) : cleanText(input.semester),
      section,
      input.classDate === undefined ? current.classDate : cleanText(input.classDate),
      input.sourceType === undefined ? current.sourceType : input.sourceType,
      input.topics === undefined ? current.topics : cleanTopics(input.topics),
      input.pinned === undefined ? current.pinned : input.pinned,
      input.archived === undefined ? current.archived : input.archived,
      content,
      contentHtml,
      countWords(content),
      input.position === undefined ? current.position : input.position,
      sectionId,
      input.taskId === undefined ? current.taskId : cleanText(input.taskId),
    ],
  );
  return toNote(result.rows[0]);
}

/**
 * Move a page to the trash. Notes are the one thing in this app that cannot be
 * reconstructed, so deletion is reversible by default; `purgeAiNote` is the
 * only thing that actually removes a row.
 */
export async function deleteAiNote(id: string): Promise<boolean> {
  await ensureNotesSchema();
  const result = await notesDb().query(
    `UPDATE ai_notes SET deleted_at = NOW(), updated_at = NOW() WHERE id=$1 AND deleted_at IS NULL`,
    [id],
  );
  return (result.rowCount || 0) > 0;
}

export async function restoreAiNote(id: string): Promise<AiNote | null> {
  await ensureNotesSchema();
  const result = await notesDb().query(
    `UPDATE ai_notes SET deleted_at = NULL, archived = FALSE, updated_at = NOW()
     WHERE id=$1
     RETURNING notebook_id, section_id`,
    [id],
  );
  if (!result.rowCount) return null;

  // If the section it used to live in has since been deleted, put it somewhere
  // the tree can actually show it rather than leaving it filed under nothing.
  const row = result.rows[0];
  if (row.notebook_id && !row.section_id) {
    const target = await resolveSection(row.notebook_id, null, null);
    if (target) {
      await notesDb().query(
        `UPDATE ai_notes SET section_id=$2, section=$3 WHERE id=$1`,
        [id, target.id, target.name],
      );
    }
  }
  return getAiNote(id);
}

/** Pages per assignment, so the task list can show a count on every row. */
export async function countNotesByTask(overridePool?: Pool): Promise<Record<string, number>> {
  await ensureNotesSchema();
  const result = await (overridePool || notesDb()).query(
    `SELECT task_id, COUNT(*)::int AS pages FROM ai_notes
     WHERE task_id IS NOT NULL AND deleted_at IS NULL AND archived = FALSE
     GROUP BY task_id`,
  );
  const counts: Record<string, number> = {};
  for (const row of result.rows) counts[String(row.task_id)] = Number(row.pages) || 0;
  return counts;
}

/** How long a deleted page waits in the trash before it is thrown out. */
export const TRASH_RETENTION_DAYS = 30;

/** Permanently remove a page, and any images only it was using. */
export async function purgeAiNote(id: string): Promise<boolean> {
  await ensureNotesSchema();
  const doomed = await notesDb().query(`SELECT content_html FROM ai_notes WHERE id=$1`, [id]);
  if (!doomed.rowCount) return false;
  const result = await notesDb().query(`DELETE FROM ai_notes WHERE id=$1`, [id]);
  if (!result.rowCount) return false;
  await releaseImages([doomed.rows[0].content_html || '']);
  return true;
}

/**
 * Throw out pages that have been in the trash longer than the retention
 * window, and empty it outright when asked.
 *
 * Nothing sweeps on a timer - there is no scheduler here - so this runs when
 * the trash is listed. That is the moment the user is being told what is in
 * there and how long it has left, which makes it the honest place to act.
 */
export async function purgeExpiredNotes(options: { all?: boolean } = {}): Promise<number> {
  await ensureNotesSchema();
  const doomed = await notesDb().query(
    options.all
      ? `DELETE FROM ai_notes WHERE deleted_at IS NOT NULL RETURNING content_html`
      : `DELETE FROM ai_notes
         WHERE deleted_at IS NOT NULL
           AND deleted_at < NOW() - ($1 || ' days')::interval
         RETURNING content_html`,
    options.all ? [] : [String(TRASH_RETENTION_DAYS)],
  );
  if (!doomed.rowCount) return 0;
  await releaseImages(doomed.rows.map((row: any) => row.content_html || ''));
  return doomed.rowCount;
}

/**
 * Delete the images those pages were using, unless something else still
 * points at them - "keep both" copies the HTML, so two pages can share a
 * picture and removing one must not break the other.
 */
async function releaseImages(htmlChunks: string[]): Promise<void> {
  const urls = new Set<string>();
  for (const html of htmlChunks) {
    for (const match of String(html).matchAll(/<img[^>]+src="([^"]+)"/gi)) {
      const url = match[1];
      // Only files this app uploaded, and only ones nothing else references.
      if (/^https:\/\/[^/]+\/notes\/[^"]+$/.test(url)) urls.add(url);
    }
  }
  if (!urls.size) return;

  const candidates = Array.from(urls);
  const stillUsed = await notesDb().query(
    `SELECT DISTINCT url FROM unnest($1::text[]) AS url
     WHERE EXISTS (SELECT 1 FROM ai_notes note WHERE note.content_html LIKE '%' || url || '%')`,
    [candidates],
  );
  const keep = new Set(stillUsed.rows.map((row: any) => row.url));
  const orphans = candidates.filter(url => !keep.has(url));
  if (!orphans.length) return;

  try {
    const { del } = await import('@vercel/blob');
    await del(orphans);
  } catch {
    // No blob store bound, or it rejected the delete. The page is already
    // gone either way; a stranded file is not worth failing the request over.
  }
}

/** Everything currently in the trash, newest first. */
export async function listTrashedNotes(limit = 200): Promise<AiNoteSummary[]> {
  await ensureNotesSchema();
  const result = await notesDb().query(
    `SELECT note.*, notebook.name AS notebook_name, LEFT(note.content,300) AS preview_text
     FROM ai_notes note
     LEFT JOIN ai_note_notebooks notebook ON notebook.id=note.notebook_id
     WHERE note.deleted_at IS NOT NULL
     ORDER BY note.deleted_at DESC
     LIMIT $1`,
    [clampLimit(limit, 500)],
  );
  return result.rows.map(toNoteSummary);
}

/** Pages set aside with Archive, so they can be brought back. */
export async function listArchivedNotes(limit = 200): Promise<AiNoteSummary[]> {
  await ensureNotesSchema();
  const result = await notesDb().query(
    `SELECT note.*, notebook.name AS notebook_name, LEFT(note.content,300) AS preview_text
     FROM ai_notes note
     LEFT JOIN ai_note_notebooks notebook ON notebook.id=note.notebook_id
     WHERE note.archived = TRUE AND note.deleted_at IS NULL
     ORDER BY note.updated_at DESC
     LIMIT $1`,
    [clampLimit(limit, 500)],
  );
  return result.rows.map(toNoteSummary);
}

/**
 * Persist a drag-and-drop reorder. `orderedIds` is the full page order for the
 * target section; any page in the list is also moved into that section, which
 * covers dragging a page onto a different tab.
 */
export async function reorderAiNotes(input: {
  notebookId: string | null;
  section?: string;
  sectionId?: string | null;
  orderedIds: string[];
}): Promise<void> {
  await ensureNotesSchema();
  const target = await resolveSection(input.notebookId, input.sectionId, input.section);
  const section = target?.name || (input.section || 'Notes');
  const sectionId = target?.id ?? null;
  const client = await notesDb().connect();
  try {
    await client.query('BEGIN');
    for (let index = 0; index < input.orderedIds.length; index++) {
      await client.query(
        `UPDATE ai_notes SET position=$2, notebook_id=$3, section=$4, section_id=$5, updated_at=NOW() WHERE id=$1`,
        [input.orderedIds[index], index, input.notebookId, section, sectionId],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function searchAiNotes(query: string, input: NoteFilters = {}, overridePool?: Pool): Promise<AiNoteSearchResult[]> {
  await ensureNotesSchema();
  const q = query.trim();
  if (!q) return (await listAiNotes(input, overridePool)).map(note => ({ ...note, excerpt: note.preview, score: 0 }));
  const clauses: string[] = [];
  const values: unknown[] = [q];
  addNoteFilters(input, clauses, values);
  clauses.unshift(`(
    to_tsvector('english',COALESCE(note.title,'') || ' ' || COALESCE(note.content,''))
      @@ websearch_to_tsquery('english',$1)
    OR note.title ILIKE '%' || $1 || '%'
    OR note.content ILIKE '%' || $1 || '%'
    OR array_to_string(note.topics,' ') ILIKE '%' || $1 || '%'
  )`);
  values.push(clampLimit(input.limit, 100, 12));
  const result = await (overridePool || notesDb()).query(
    `SELECT note.*, notebook.name AS notebook_name,
       ts_rank_cd(
         to_tsvector('english',COALESCE(note.title,'') || ' ' || COALESCE(note.content,'')),
         websearch_to_tsquery('english',$1)
       ) AS score,
       ts_headline(
         'english',note.content,websearch_to_tsquery('english',$1),
         'StartSel=,StopSel=,MaxWords=140,MinWords=45,ShortWord=2,HighlightAll=false'
       ) AS excerpt
     FROM ai_notes note
     LEFT JOIN ai_note_notebooks notebook ON notebook.id=note.notebook_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY note.pinned DESC, score DESC, note.updated_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map((row: any) => ({
    ...toNoteSummary(row),
    excerpt: String(row.excerpt || '').replace(/\s+/g, ' ').trim(),
    score: Number(row.score) || 0,
  }));
}
