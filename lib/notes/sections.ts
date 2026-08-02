import { randomUUID } from 'crypto';
import { cleanText, ensureNotesSchema, notesDb, toSection } from './db';
import type { NoteSection } from './types';

const SECTION_SELECT = `
  SELECT section.*,
    (SELECT COUNT(*)::int FROM ai_notes note
      WHERE note.notebook_id = section.notebook_id
        AND LOWER(note.section) = LOWER(section.name)
        AND note.archived = FALSE) AS page_count
  FROM ai_note_sections section
`;

export async function listSections(notebookId: string): Promise<NoteSection[]> {
  await ensureNotesSchema();
  const result = await notesDb().query(
    `${SECTION_SELECT} WHERE section.notebook_id = $1 ORDER BY section.position, LOWER(section.name)`,
    [notebookId],
  );
  return result.rows.map(toSection);
}

export async function listAllSections(): Promise<NoteSection[]> {
  await ensureNotesSchema();
  const result = await notesDb().query(
    `${SECTION_SELECT} ORDER BY section.notebook_id, section.position, LOWER(section.name)`,
  );
  return result.rows.map(toSection);
}

export async function createSection(input: {
  notebookId: string;
  name: string;
  color?: string | null;
}): Promise<NoteSection> {
  await ensureNotesSchema();
  const database = notesDb();
  const name = input.name.trim() || 'New Section';
  const next = await database.query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS position FROM ai_note_sections WHERE notebook_id = $1`,
    [input.notebookId],
  );
  const result = await database.query(
    `INSERT INTO ai_note_sections (id, notebook_id, name, color, position)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (notebook_id, LOWER(name)) DO UPDATE SET updated_at = NOW()
     RETURNING *, 0::int AS page_count`,
    [randomUUID(), input.notebookId, name, cleanText(input.color), Number(next.rows[0]?.position) || 0],
  );
  return toSection(result.rows[0]);
}

export async function updateSection(
  id: string,
  input: Partial<{ name: string; color: string | null; position: number }>,
): Promise<NoteSection | null> {
  await ensureNotesSchema();
  const database = notesDb();
  const currentResult = await database.query(`SELECT * FROM ai_note_sections WHERE id = $1`, [id]);
  if (!currentResult.rowCount) return null;
  const current = currentResult.rows[0];
  const name = input.name === undefined ? current.name : input.name.trim() || current.name;
  const color = input.color === undefined ? current.color : cleanText(input.color);
  const position = input.position === undefined ? current.position : input.position;

  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ai_note_sections SET name=$2, color=$3, position=$4, updated_at=NOW() WHERE id=$1`,
      [id, name, color, position],
    );
    if (name !== current.name) {
      // Pages store the section by name, so a rename has to follow through.
      await client.query(
        `UPDATE ai_notes SET section=$3, updated_at=NOW()
         WHERE notebook_id=$1 AND LOWER(section)=LOWER($2)`,
        [current.notebook_id, current.name, name],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const result = await database.query(`${SECTION_SELECT} WHERE section.id = $1`, [id]);
  return result.rowCount ? toSection(result.rows[0]) : null;
}

/**
 * Delete a section. Its pages move to another section in the same notebook so
 * nothing is lost; only when the notebook has no other section are the pages
 * deleted, and then only if the caller asked for it.
 */
export async function deleteSection(
  id: string,
  options: { deletePages?: boolean } = {},
): Promise<{ deleted: boolean; movedTo: string | null; deletedPages: number }> {
  await ensureNotesSchema();
  const database = notesDb();
  const currentResult = await database.query(`SELECT * FROM ai_note_sections WHERE id = $1`, [id]);
  if (!currentResult.rowCount) return { deleted: false, movedTo: null, deletedPages: 0 };
  const current = currentResult.rows[0];

  const fallbackResult = await database.query(
    `SELECT name FROM ai_note_sections
     WHERE notebook_id = $1 AND id <> $2
     ORDER BY position, LOWER(name) LIMIT 1`,
    [current.notebook_id, id],
  );
  const fallback: string | null = fallbackResult.rows[0]?.name ?? null;

  const client = await database.connect();
  try {
    await client.query('BEGIN');
    let deletedPages = 0;
    if (fallback && !options.deletePages) {
      await client.query(
        `UPDATE ai_notes SET section=$3, updated_at=NOW()
         WHERE notebook_id=$1 AND LOWER(section)=LOWER($2)`,
        [current.notebook_id, current.name, fallback],
      );
    } else {
      const removed = await client.query(
        `DELETE FROM ai_notes WHERE notebook_id=$1 AND LOWER(section)=LOWER($2)`,
        [current.notebook_id, current.name],
      );
      deletedPages = removed.rowCount || 0;
    }
    await client.query(`DELETE FROM ai_note_sections WHERE id=$1`, [id]);
    await client.query('COMMIT');
    return { deleted: true, movedTo: options.deletePages ? null : fallback, deletedPages };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Apply a new tab order for one notebook. */
export async function reorderSections(notebookId: string, orderedIds: string[]): Promise<NoteSection[]> {
  await ensureNotesSchema();
  const client = await notesDb().connect();
  try {
    await client.query('BEGIN');
    for (let index = 0; index < orderedIds.length; index++) {
      await client.query(
        `UPDATE ai_note_sections SET position=$3, updated_at=NOW() WHERE id=$1 AND notebook_id=$2`,
        [orderedIds[index], notebookId, index],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return listSections(notebookId);
}

/** Make sure a section row exists for a notebook/name pair. */
export async function ensureSection(notebookId: string | null, name: string): Promise<void> {
  if (!notebookId || !name.trim()) return;
  await createSection({ notebookId, name }).catch(() => undefined);
}
