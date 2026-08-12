import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { cleanText, ensureNotesSchema, notesDb, toSection } from './db';
import type { NoteSection } from './types';

// The count has to match what the tree actually lists: pages you have set
// aside are not pages you have. Leaving the trash in made deleting a page look
// like it had done nothing, because the number beside the section never moved.
const SECTION_SELECT = `
  SELECT section.*,
    (SELECT COUNT(*)::int FROM ai_notes note
      WHERE note.section_id = section.id
        AND note.archived = FALSE
        AND note.deleted_at IS NULL) AS page_count
  FROM ai_note_sections section
`;

export async function listSections(notebookId: string): Promise<NoteSection[]> {
  await ensureNotesSchema();
  const result = await notesDb().query(
    `${SECTION_SELECT} WHERE section.notebook_id = $1
     ORDER BY COALESCE(section.parent_id, ''), section.position, LOWER(section.name)`,
    [notebookId],
  );
  return result.rows.map(toSection);
}

export async function listAllSections(overridePool?: Pool): Promise<NoteSection[]> {
  await ensureNotesSchema();
  const result = await (overridePool || notesDb()).query(
    `${SECTION_SELECT} ORDER BY section.notebook_id, COALESCE(section.parent_id, ''), section.position, LOWER(section.name)`,
  );
  return result.rows.map(toSection);
}

export async function createSection(input: {
  notebookId: string;
  name: string;
  color?: string | null;
  /** Null for a top-level category; a section id to nest beneath it. */
  parentId?: string | null;
}): Promise<NoteSection> {
  await ensureNotesSchema();
  const database = notesDb();
  const name = input.name.trim() || 'New Section';
  const parentId = cleanText(input.parentId);
  const next = await database.query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS position FROM ai_note_sections
     WHERE notebook_id = $1 AND COALESCE(parent_id, '') = COALESCE($2, '')`,
    [input.notebookId, parentId],
  );
  const result = await database.query(
    `INSERT INTO ai_note_sections (id, notebook_id, parent_id, name, color, position)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (notebook_id, COALESCE(parent_id, ''), LOWER(name)) DO UPDATE SET updated_at = NOW()
     RETURNING *, 0::int AS page_count`,
    [randomUUID(), input.notebookId, parentId, name, cleanText(input.color), Number(next.rows[0]?.position) || 0],
  );
  return toSection(result.rows[0]);
}

/**
 * Raised when a move would put a section inside its own subtree, which would
 * cut that whole branch loose from the tree with no way to reach it again.
 */
export class SectionMoveError extends Error {}

/** Refuse a move that would orphan a branch or cross into another notebook. */
async function checkMoveIsLegal(id: string, parentId: string | null, notebookId: string): Promise<void> {
  if (!parentId) return;
  if (parentId === id) {
    throw new SectionMoveError('A section cannot be moved inside itself.');
  }
  const parent = await notesDb().query(
    `SELECT notebook_id FROM ai_note_sections WHERE id = $1`,
    [parentId],
  );
  if (!parent.rowCount) {
    throw new SectionMoveError('That section no longer exists.');
  }
  if (parent.rows[0].notebook_id !== notebookId) {
    throw new SectionMoveError('A section can only be moved within its own notebook.');
  }
  // Walk down from the section being moved: if the chosen parent turns up in
  // its own subtree, the move would form a loop.
  const descendants = await notesDb().query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM ai_note_sections WHERE id = $1
       UNION ALL
       SELECT child.id FROM ai_note_sections child JOIN tree ON child.parent_id = tree.id
     ) SELECT 1 FROM tree WHERE id = $2`,
    [id, parentId],
  );
  if (descendants.rowCount) {
    throw new SectionMoveError('A section cannot be moved inside one of its own folders.');
  }
}

export async function updateSection(
  id: string,
  input: Partial<{ name: string; color: string | null; position: number; parentId: string | null }>,
): Promise<NoteSection | null> {
  await ensureNotesSchema();
  const database = notesDb();
  const currentResult = await database.query(`SELECT * FROM ai_note_sections WHERE id = $1`, [id]);
  if (!currentResult.rowCount) return null;
  const current = currentResult.rows[0];
  const name = input.name === undefined ? current.name : input.name.trim() || current.name;
  const color = input.color === undefined ? current.color : cleanText(input.color);

  const moving = input.parentId !== undefined;
  const parentId = moving ? cleanText(input.parentId) : (current.parent_id ?? null);
  if (moving && parentId !== (current.parent_id ?? null)) {
    await checkMoveIsLegal(id, parentId, current.notebook_id);
  }

  // A section landing in a new parent goes to the end of it, unless the caller
  // is placing it deliberately.
  let position = input.position === undefined ? current.position : input.position;
  if (input.position === undefined && parentId !== (current.parent_id ?? null)) {
    const next = await database.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS position FROM ai_note_sections
       WHERE notebook_id = $1 AND COALESCE(parent_id, '') = COALESCE($2, '') AND id <> $3`,
      [current.notebook_id, parentId, id],
    );
    position = Number(next.rows[0]?.position) || 0;
  }

  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ai_note_sections SET name=$2, color=$3, position=$4, parent_id=$5, updated_at=NOW() WHERE id=$1`,
      [id, name, color, position, parentId],
    );
    if (name !== current.name) {
      // Pages keep a denormalised copy of the section name for search and the
      // GPT endpoints, so a rename has to follow through. Matching on the id
      // rather than the old name keeps sibling branches with the same name
      // (two "Week 1"s under different categories) from being caught up in it.
      await client.query(
        `UPDATE ai_notes SET section=$2, updated_at=NOW() WHERE section_id=$1`,
        [id, name],
      );
    }
    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    // Siblings must have distinct names, so say which name is in the way
    // rather than reporting a constraint violation.
    if (String(error?.code) === '23505') {
      throw new SectionMoveError(`There is already a “${name}” there. Rename one of them first.`);
    }
    throw error;
  } finally {
    client.release();
  }

  const result = await database.query(`${SECTION_SELECT} WHERE section.id = $1`, [id]);
  return result.rowCount ? toSection(result.rows[0]) : null;
}

/**
 * Delete a section and everything nested under it. Pages in the subtree move to
 * a sibling so nothing is lost; they are only deleted when there is nowhere
 * left to put them, or when the caller explicitly asks.
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

  // The section plus every descendant.
  const subtree = await database.query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM ai_note_sections WHERE id = $1
       UNION ALL
       SELECT child.id FROM ai_note_sections child JOIN tree ON child.parent_id = tree.id
     ) SELECT id FROM tree`,
    [id],
  );
  const ids: string[] = subtree.rows.map((r: any) => r.id);

  // Prefer a sibling at the same level to receive the orphaned pages.
  const fallbackResult = await database.query(
    `SELECT id, name FROM ai_note_sections
     WHERE notebook_id = $1 AND NOT (id = ANY($2::text[]))
     ORDER BY (COALESCE(parent_id, '') = COALESCE($3, '')) DESC, position, LOWER(name)
     LIMIT 1`,
    [current.notebook_id, ids, current.parent_id],
  );
  const fallback = fallbackResult.rows[0] ?? null;

  const client = await database.connect();
  try {
    await client.query('BEGIN');
    let deletedPages = 0;
    if (fallback && !options.deletePages) {
      await client.query(
        `UPDATE ai_notes SET section_id=$2, section=$3, updated_at=NOW()
         WHERE section_id = ANY($1::text[])`,
        [ids, fallback.id, fallback.name],
      );
    } else {
      // Pages go to the trash rather than being destroyed with the section.
      // Their section_id is cleared at the same time - the row it points at is
      // about to disappear, and a page filed under a section that no longer
      // exists cannot be found again after it is restored.
      const removed = await client.query(
        `UPDATE ai_notes SET deleted_at = NOW(), section_id = NULL, updated_at = NOW()
         WHERE section_id = ANY($1::text[]) AND deleted_at IS NULL`,
        [ids],
      );
      deletedPages = removed.rowCount || 0;
      await client.query(
        `UPDATE ai_notes SET section_id = NULL, updated_at = NOW()
         WHERE section_id = ANY($1::text[])`,
        [ids],
      );
    }
    await client.query(`DELETE FROM ai_note_sections WHERE id = ANY($1::text[])`, [ids]);
    await client.query('COMMIT');
    return { deleted: true, movedTo: options.deletePages ? null : (fallback?.name ?? null), deletedPages };
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

/** Resolve a section by id, or by name, or fall back to the notebook's first. */
export async function resolveSection(
  notebookId: string | null,
  sectionId: string | null | undefined,
  name: string | null | undefined,
): Promise<NoteSection | null> {
  if (!notebookId) return null;
  await ensureNotesSchema();
  if (sectionId) {
    const found = await notesDb().query(`${SECTION_SELECT} WHERE section.id = $1`, [sectionId]);
    if (found.rowCount) return toSection(found.rows[0]);
  }

  const wanted = (name || '').trim();
  if (wanted) {
    const existing = await notesDb().query(
      `${SECTION_SELECT} WHERE section.notebook_id = $1 AND LOWER(section.name) = LOWER($2)
       ORDER BY COALESCE(section.parent_id, '') LIMIT 1`,
      [notebookId, wanted],
    );
    if (existing.rowCount) return toSection(existing.rows[0]);
    return createSection({ notebookId, name: wanted }).catch(() => null);
  }

  // No section was asked for. Use whatever the notebook already opens with
  // rather than inventing one called "Notes" - if the user has renamed that
  // tab, conjuring it back looks exactly like the rename being undone.
  const first = await notesDb().query(
    `${SECTION_SELECT} WHERE section.notebook_id = $1
     ORDER BY COALESCE(section.parent_id, ''), section.position, LOWER(section.name) LIMIT 1`,
    [notebookId],
  );
  if (first.rowCount) return toSection(first.rows[0]);
  return createSection({ notebookId, name: 'Notes' }).catch(() => null);
}
