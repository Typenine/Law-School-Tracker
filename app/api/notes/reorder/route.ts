import { NextRequest } from 'next/server';
import { z } from 'zod';
import { reorderAiNotes } from '@/lib/aiNotes';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  notebookId: z.string().trim().min(1).nullable(),
  section: z.string().trim().min(1).max(120),
  orderedIds: z.array(z.string().trim().min(1)).max(500),
});

export async function PUT(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return noStoreJson({ error: 'Invalid page order.', issues: parsed.error.issues }, { status: 400 });
    }
    await reorderAiNotes(parsed.data);
    return noStoreJson({ ok: true });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to reorder pages.' },
      { status: 500 },
    );
  }
}
