import { NextRequest } from 'next/server';
import { getAiNote } from '@/lib/aiNotes';
import { noStoreJson, requireGptToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = requireGptToken(req);
  if (denied) return denied;

  try {
    const note = await getAiNote(params.id);
    if (!note) return noStoreJson({ error: 'Note not found.' }, { status: 404 });
    // The GPT reads prose, not editor markup.
    const { contentHtml, ...readable } = note;
    return noStoreJson({ note: readable });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load note.' },
      { status: 500 },
    );
  }
}
