import { NextRequest } from 'next/server';
import { getAiNote, getSectionPath } from '@/lib/aiNotes';
import { notesGptDb } from '@/lib/notes/db';
import { noStoreJson, requireNotesToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = requireNotesToken(req);
  if (denied) return denied;

  try {
    const gptDb = notesGptDb();
    const note = await getAiNote((await context.params).id, gptDb);
    if (!note || note.deletedAt || note.archived) {
      return noStoreJson({ error: 'Note not found.' }, { status: 404 });
    }
    const sectionPath = await getSectionPath(note.sectionId, gptDb);
    const locationPath = [note.notebookName || note.course, ...sectionPath].filter(Boolean).join(' / ');

    // The GPT reads prose, not editor markup. Images survive the strip as
    // "[image: alt]" markers in the text; URLs come back alongside so a
    // diagram in the page can be named rather than silently dropped.
    const { contentHtml, ...readable } = note;
    const images = Array.from(String(contentHtml || '').matchAll(/<img[^>]+src="([^"]+)"/gi))
      .map(match => match[1]);
    return noStoreJson({ note: { ...readable, locationPath, images } });
  } catch (error) {
    console.error('[gpt/notes/[id]]', error);
    return noStoreJson({ error: 'Unable to load note. Try again shortly.' }, { status: 500 });
  }
}
