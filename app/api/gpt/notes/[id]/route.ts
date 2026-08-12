import { NextRequest } from 'next/server';
import { getAiNote } from '@/lib/aiNotes';
import { notesGptDb } from '@/lib/notes/db';
import { noStoreJson, requireNotesToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = requireNotesToken(req);
  if (denied) return denied;

  try {
    const note = await getAiNote(params.id, notesGptDb());
    if (!note) return noStoreJson({ error: 'Note not found.' }, { status: 404 });
    // The GPT reads prose, not editor markup. Images survive the strip as
    // "[image: alt]" markers in the text; the URLs come back alongside so a
    // diagram in the page can be named rather than silently dropped.
    const { contentHtml, ...readable } = note;
    const images = Array.from(String(contentHtml || '').matchAll(/<img[^>]+src="([^"]+)"/gi))
      .map(match => match[1]);
    return noStoreJson({ note: { ...readable, images } });
  } catch (error) {
    console.error('[gpt/notes/[id]]', error);
    return noStoreJson({ error: 'Unable to load note. Try again shortly.' }, { status: 500 });
  }
}
