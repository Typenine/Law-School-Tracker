import { NextRequest } from 'next/server';
import { createAiNote, getNotebook } from '@/lib/aiNotes';
import { notesDb } from '@/lib/notes/db';
import type { NoteSourceType } from '@/lib/notes/types';
import { noStoreJson, requireNotesToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SOURCE_TYPES = new Set<NoteSourceType>([
  'class-notes', 'reading-notes', 'case-brief', 'outline', 'professor-material', 'other',
]);

export async function POST(req: NextRequest) {
  const denied = requireNotesToken(req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const title = String(body.title || '').trim().slice(0, 240);
    const notebookId = String(body.notebookId || '').trim();
    const sectionId = body.sectionId == null ? null : String(body.sectionId).trim();
    const content = String(body.content || '').replace(/\u0000/g, '').slice(0, 250_000);
    const sourceTypeRaw = String(body.sourceType || 'other') as NoteSourceType;
    const taskId = body.taskId == null ? null : String(body.taskId).trim();
    const classDate = body.classDate == null ? null : String(body.classDate).trim();
    const topics = Array.isArray(body.topics)
      ? body.topics.map(value => String(value).trim()).filter(Boolean).slice(0, 30)
      : [];

    if (!title) return noStoreJson({ error: 'A title is required.' }, { status: 400 });
    if (!notebookId) return noStoreJson({ error: 'Choose a notebook before creating a page.' }, { status: 400 });
    const notebook = await getNotebook(notebookId);
    if (!notebook || notebook.archived) return noStoreJson({ error: 'Notebook not found.' }, { status: 404 });
    if (sectionId) {
      const section = await notesDb().query(
        `SELECT id FROM ai_note_sections WHERE id = $1 AND notebook_id = $2`,
        [sectionId, notebookId],
      );
      if (!section.rowCount) return noStoreJson({ error: 'That section is not in the selected notebook.' }, { status: 400 });
    }

    const note = await createAiNote({
      title,
      notebookId,
      sectionId,
      taskId,
      classDate,
      sourceType: SOURCE_TYPES.has(sourceTypeRaw) ? sourceTypeRaw : 'other',
      topics,
      content,
    });
    return noStoreJson({ note }, { status: 201 });
  } catch (error) {
    console.error('[gpt/notes/create]', error);
    return noStoreJson({ error: 'Unable to create the note. Try again shortly.' }, { status: 500 });
  }
}
