import type { Pool } from 'pg';
import { ensureNotesSchema, notesDb } from './db';

/** Return a section and every nested section beneath it. */
export async function listSectionSubtreeIds(sectionId: string, overridePool?: Pool): Promise<string[]> {
  await ensureNotesSchema();
  const pool = overridePool || notesDb();
  const result = await pool.query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM ai_note_sections WHERE id = $1
       UNION ALL
       SELECT child.id
       FROM ai_note_sections child
       JOIN tree parent ON child.parent_id = parent.id
     )
     SELECT id FROM tree`,
    [sectionId],
  );
  return result.rows.map((row: any) => String(row.id));
}

/**
 * Human-readable section ancestry from the top-level tab to the leaf section.
 * The notebook/course name is deliberately not included; callers prepend it so
 * the same helper works for both tree navigation and note response metadata.
 */
export async function getSectionPath(sectionId: string | null | undefined, overridePool?: Pool): Promise<string[]> {
  if (!sectionId) return [];
  await ensureNotesSchema();
  const pool = overridePool || notesDb();
  const result = await pool.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id, name, 0 AS depth
       FROM ai_note_sections
       WHERE id = $1
       UNION ALL
       SELECT parent.id, parent.parent_id, parent.name, child.depth + 1
       FROM ai_note_sections parent
       JOIN ancestors child ON child.parent_id = parent.id
     )
     SELECT name FROM ancestors ORDER BY depth DESC`,
    [sectionId],
  );
  return result.rows.map((row: any) => String(row.name));
}

/** Resolve paths for several section ids with one recursive database query. */
export async function getSectionPaths(sectionIds: Array<string | null | undefined>, overridePool?: Pool): Promise<Map<string, string[]>> {
  const ids = Array.from(new Set(sectionIds.filter((id): id is string => Boolean(id))));
  const paths = new Map<string, string[]>();
  if (!ids.length) return paths;
  await ensureNotesSchema();
  const pool = overridePool || notesDb();
  const result = await pool.query(
    `WITH RECURSIVE ancestors AS (
       SELECT section.id AS leaf_id, section.id, section.parent_id, section.name, 0 AS depth
       FROM ai_note_sections section
       WHERE section.id = ANY($1::text[])
       UNION ALL
       SELECT child.leaf_id, parent.id, parent.parent_id, parent.name, child.depth + 1
       FROM ai_note_sections parent
       JOIN ancestors child ON child.parent_id = parent.id
     )
     SELECT leaf_id, ARRAY_AGG(name ORDER BY depth DESC) AS path
     FROM ancestors
     GROUP BY leaf_id`,
    [ids],
  );
  for (const row of result.rows) {
    paths.set(String(row.leaf_id), Array.isArray(row.path) ? row.path.map(String) : []);
  }
  return paths;
}
