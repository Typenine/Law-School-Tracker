import { randomUUID } from 'crypto';
import {
  cleanText,
  ensureNotesSchema,
  notesDb,
  toNotebook,
} from './db';
import { createSection } from './sections';
import type { NoteNotebook } from './types';

export async function createNotebook(input: {
  name: string;
  course?: string | null;
  semester?: string | null;
  color?: string | null;
}): Promise<NoteNotebook> {
  await ensureNotesSchema();
  const name = input.name.trim();
  const semester = cleanText(input.semester);
  const database = notesDb();
  const client = await database.connect();
  let notebookId = '';

  try {
    await client.query('BEGIN');
    // A timed-out request can be retried even though the first insert reached
    // Postgres. Serialize equal notebook names so a retry returns the notebook
    // that already exists instead of creating a duplicate beside it.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext(LOWER($1) || '|' || LOWER(COALESCE($2, ''))))`,
      [name, semester],
    );
    const existing = await client.query(
      `SELECT id FROM ai_note_notebooks
       WHERE archived = FALSE
         AND LOWER(TRIM(name)) = LOWER(TRIM($1))
         AND COALESCE(LOWER(TRIM(semester)), '') = COALESCE(LOWER(TRIM($2)), '')
       ORDER BY created_at ASC
       LIMIT 1`,
      [name, semester],
    );
    if (existing.rowCount) {
      notebookId = existing.rows[0].id;
      await client.query('COMMIT');
    } else {
      const next = await client.query(`SELECT COALESCE(MAX(position), -1) + 1 AS position FROM ai_note_notebooks`);
      notebookId = randomUUID();
      await client.query(
        `INSERT INTO ai_note_notebooks (id, name, course, semester, color, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          notebookId, name, cleanText(input.course) || name, semester,
          cleanText(input.color), Number(next.rows[0]?.position) || 0,
        ],
      );
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  // A notebook always opens with one tab to write on. This is idempotent, so
  // it also repairs an older duplicate/retry that lost its default section.
  await createSection({ notebookId, name: 'Notes' }).catch(() => undefined);
  const notebook = await getNotebook(notebookId);
  if (!notebook) throw new Error('Unable to create the notebook.');
  return notebook;
}

export async function listNotebooks(archived = false): Promise<NoteNotebook[]> {
  await ensureNotesSchema();
  const result = await notesDb().query(
    `SELECT notebook.*, COUNT(note.id)::int AS note_count,
       COALESCE(
         (SELECT ARRAY_AGG(section.name ORDER BY section.position, LOWER(section.name))
            FROM ai_note_sections section WHERE section.notebook_id = notebook.id),
         ARRAY[]::text[]
       ) AS sections
     FROM ai_note_notebooks notebook
     LEFT JOIN ai_notes note
       ON note.notebook_id = notebook.id
      AND note.deleted_at IS NULL
      AND note.archived = FALSE
     WHERE notebook.archived = $1
     GROUP BY notebook.id
     ORDER BY notebook.position, COALESCE(notebook.semester, 'Unsorted') DESC, LOWER(notebook.name)`,
    [archived],
  );
  return result.rows.map(toNotebook);
}

export async function getNotebook(id: string): Promise<NoteNotebook | null> {
  await ensureNotesSchema();
  const result = await notesDb().query(
    `SELECT notebook.*, COUNT(note.id)::int AS note_count,
       COALESCE(
         (SELECT ARRAY_AGG(section.name ORDER BY section.position, LOWER(section.name))
            FROM ai_note_sections section WHERE section.notebook_id = notebook.id),
         ARRAY[]::text[]
       ) AS sections
     FROM ai_note_notebooks notebook
     LEFT JOIN ai_notes note
       ON note.notebook_id = notebook.id
      AND note.deleted_at IS NULL
      AND note.archived = FALSE
     WHERE notebook.id = $1
     GROUP BY notebook.id`,
    [id],
  );
  return result.rowCount ? toNotebook(result.rows[0]) : null;
}

export async function updateNotebook(
  id: string,
  input: Partial<Pick<NoteNotebook, 'name' | 'course' | 'semester' | 'color' | 'archived'>>,
): Promise<NoteNotebook | null> {
  await ensureNotesSchema();
  const database = notesDb();
  const currentResult = await database.query(`SELECT * FROM ai_note_notebooks WHERE id = $1`, [id]);
  if (!currentResult.rowCount) return null;
  const current = currentResult.rows[0];
  const name = input.name === undefined ? current.name : input.name.trim();
  const course = input.course === undefined ? current.course : cleanText(input.course);
  const semester = input.semester === undefined ? current.semester : cleanText(input.semester);
  const color = input.color === undefined ? current.color : cleanText(input.color);
  const archived = input.archived === undefined ? current.archived : input.archived;
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ai_note_notebooks
       SET name=$2, course=$3, semester=$4, color=$5, archived=$6, updated_at=NOW()
       WHERE id=$1`,
      [id, name, course, semester, color, archived],
    );
    await client.query(
      `UPDATE ai_notes SET course=$2, semester=$3, updated_at=NOW() WHERE notebook_id=$1`,
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
  await ensureNotesSchema();
  const client = await notesDb().connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE ai_notes SET notebook_id=NULL, updated_at=NOW() WHERE notebook_id=$1`, [id]);
    await client.query(`DELETE FROM ai_note_sections WHERE notebook_id=$1`, [id]);
    const result = await client.query(`DELETE FROM ai_note_notebooks WHERE id=$1`, [id]);
    await client.query('COMMIT');
    return (result.rowCount || 0) > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
