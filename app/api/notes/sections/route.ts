import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSection, listAllSections, listSections, reorderSections } from '@/lib/aiNotes';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const createSchema = z.object({
  notebookId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  color: z.string().trim().max(40).nullable().optional(),
});

const reorderSchema = z.object({
  notebookId: z.string().trim().min(1),
  orderedIds: z.array(z.string().trim().min(1)).max(200),
});

export async function GET(req: NextRequest) {
  try {
    const notebookId = req.nextUrl.searchParams.get('notebookId')?.trim();
    const sections = notebookId ? await listSections(notebookId) : await listAllSections();
    return noStoreJson({ sections });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load sections.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return noStoreJson({ error: 'Invalid section details.', issues: parsed.error.issues }, { status: 400 });
    }
    const section = await createSection(parsed.data);
    return noStoreJson({ section }, { status: 201 });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to create the section.' },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const parsed = reorderSchema.safeParse(await req.json());
    if (!parsed.success) {
      return noStoreJson({ error: 'Invalid section order.', issues: parsed.error.issues }, { status: 400 });
    }
    const sections = await reorderSections(parsed.data.notebookId, parsed.data.orderedIds);
    return noStoreJson({ sections });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to reorder sections.' },
      { status: 500 },
    );
  }
}
