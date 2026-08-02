import { randomUUID } from 'crypto';
import {
  addNoteFilters,
  clampLimit,
  cleanText,
  cleanTopics,
  countWords,
  ensureNotesSchema,
  getNotebookDefaults,
  notesDb,
  toNoteSummary,
} from './db';
import type {
  AiNote,
  AiNoteSearchResult,
  AiNoteSummary,
  NoteFilters,
  NoteSourceType,
} from './types';

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
  await ensureNotesSchema();
  const content = String(input.content || '').replace(/\u0000/g, '');
  const defaults = await getNotebookDefaults(input.notebookId);
  const result = await notesDb().query(
    `INSERT INTO ai_notes (
       id,title,notebook_id,course,semester,section,class_date,source_type,topics,
       original_filename,mime_type,pinned,archived,content,word_count
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9::text[],$10,$11,$12,$13,$14,$15)
     RETURNING *, (SELECT name FROM ai_note_notebooks WHERE id=notebook_id) AS notebook_name`,
    [
      randomUUID(), input.title.trim() || 'Untitled Page', input.notebookId || null,
      input.course === undefined ? defaults?.course || null : cleanText(input.course),
      input.semester === undefined ? defaults?.semester || null : cleanText(input.semester),
      cleanText(input.section) || 'Notes', cleanText(input.classDate), input.sourceType || 'class-notes',
      cleanTopics(input.topics), cleanText(input.originalFilename), cleanText(input.mimeType), Boolean(input.pinned),
      Boolean(input.archived), content, countWords(content),
    ],
  );
  const row = result.rows[0];
  return { ...toNoteSummary(row), content: row.content };
}

export async function listAiNotes(input: NoteFilters = {}): Promise<AiNoteSummary[]> {
  await ensureNotesSchema();
  const clauses: string[] = [];
  const values: unknown[] = [];
  addNoteFilters(input, clauses, values);
  values.push(clampLimit(input.limit, 500));
  const result = await notesDb().query(
    `SELECT note.*, notebook.name AS notebook_name, LEFT(note.content,500) AS preview_text
     FROM ai_notes note
     LEFT JOIN ai_note_notebooks notebook ON notebook.id=note.notebook_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY note.pinned DESC, note.updated_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(toNoteSummary);
}

export async function getAiNote(id: string): Promise<AiNote | null> {
  await ensureNotesSchema();
  const result = await notesDb().query(
    `SELECT note.*, notebook.name AS notebook_name
     FROM ai_notes note
     LEFT JOIN ai_note_notebooks notebook ON notebook.id=note.notebook_id
     WHERE note.id=$1`,
    [id],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { ...toNoteSummary(row), content: row.content };
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
  await ensureNotesSchema();
  const current = await getAiNote(id);
  if (!current) return null;
  const notebookId = input.notebookId === undefined ? current.notebookId : input.notebookId;
  const defaults = notebookId !== current.notebookId ? await getNotebookDefaults(notebookId) : null;
  const content = input.content === undefined ? current.content : String(input.content).replace(/\u0000/g, '');
  const result = await notesDb().query(
    `UPDATE ai_notes SET
       title=$2, notebook_id=$3, course=$4, semester=$5, section=$6, class_date=$7::date,
       source_type=$8, topics=$9::text[], pinned=$10, archived=$11, content=$12,
       word_count=$13, updated_at=NOW()
     WHERE id=$1
     RETURNING *, (SELECT name FROM ai_note_notebooks WHERE id=notebook_id) AS notebook_name`,
    [
      id,
      input.title === undefined ? current.title : input.title.trim() || 'Untitled Page',
      notebookId,
      input.course === undefined ? (defaults ? defaults.course : current.course) : cleanText(input.course),
      input.semester === undefined ? (defaults ? defaults.semester : current.semester) : cleanText(input.semester),
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
  return { ...toNoteSummary(row), content: row.content };
}

export async function deleteAiNote(id: string): Promise<boolean> {
  await ensureNotesSchema();
  const result = await notesDb().query(`DELETE FROM ai_notes WHERE id=$1`, [id]);
  return (result.rowCount || 0) > 0;
}

export async function searchAiNotes(query: string, input: NoteFilters = {}): Promise<AiNoteSearchResult[]> {
  await ensureNotesSchema();
  const q = query.trim();
  if (!q) return (await listAiNotes(input)).map(note => ({ ...note, excerpt: note.preview, score: 0 }));
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
  const result = await notesDb().query(
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
