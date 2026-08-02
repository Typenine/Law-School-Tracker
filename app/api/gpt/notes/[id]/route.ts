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
    // The GPT reads prose, not editor markup. Images survive the strip as
    // "[image: alt]" markers in the text; the URLs come back alongside so a
    // diagram in the page can be named rather than silently dropped.
    const { contentHtml, ...readable } = note;
    const images = Array.from(String(contentHtml || '').matchAll(/<img[^>]+src="([^"]+)"/gi))
      .map(match => match[1]);
    return noStoreJson({ note: { ...readable, images } });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load note.' },
      { status: 500 },
    );
  }
}
