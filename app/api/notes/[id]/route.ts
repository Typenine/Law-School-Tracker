import { NextRequest } from 'next/server';
import { deleteAiNote, getAiNote } from '@/lib/aiNotes';
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
    const note = await getAiNote(params.id);
    if (!note) return noStoreJson({ error: 'Note not found.' }, { status: 404 });
    return noStoreJson({ note });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load note.' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = requireNotesToken(req);
  if (denied) return denied;

  try {
    const deleted = await deleteAiNote(params.id);
    if (!deleted) return noStoreJson({ error: 'Note not found.' }, { status: 404 });
    return noStoreJson({ deleted: true });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to delete note.' },
      { status: 500 },
    );
  }
}
