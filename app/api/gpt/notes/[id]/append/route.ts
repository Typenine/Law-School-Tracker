import { NextRequest } from 'next/server';
import { getAiNote, updateAiNote } from '@/lib/aiNotes';
import { escapeHtml, plainTextToHtml } from '@/lib/notes/db';
import { noStoreJson, requireNotesToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = requireNotesToken(req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const content = String(body.content || '').replace(/\u0000/g, '').trim().slice(0, 100_000);
    const heading = String(body.heading || '').replace(/\u0000/g, '').trim().slice(0, 240);
    if (!content) return noStoreJson({ error: 'Content is required.' }, { status: 400 });

    const current = await getAiNote(params.id);
    if (!current || current.deletedAt || current.archived) {
      return noStoreJson({ error: 'Note not found.' }, { status: 404 });
    }
    const separator = current.contentHtml.trim() ? '<hr>' : '';
    const headingHtml = heading ? `<h2>${escapeHtml(heading)}</h2>` : '';
    const appendedHtml = `${current.contentHtml}${separator}${headingHtml}${plainTextToHtml(content)}`;
    const note = await updateAiNote(params.id, {
      contentHtml: appendedHtml,
      expectedUpdatedAt: current.updatedAt,
    });
    if (!note) return noStoreJson({ error: 'Note not found.' }, { status: 404 });
    return noStoreJson({ note });
  } catch (error: any) {
    if (error?.name === 'NoteConflictError') {
      return noStoreJson({ error: error.message }, { status: 409 });
    }
    console.error('[gpt/notes/[id]/append]', error);
    return noStoreJson({ error: 'Unable to append to the note. Try again shortly.' }, { status: 500 });
  }
}
