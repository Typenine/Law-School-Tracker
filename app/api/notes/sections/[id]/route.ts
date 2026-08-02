import { NextRequest } from 'next/server';
import { z } from 'zod';
import { SectionMoveError, deleteSection, updateSection } from '@/lib/aiNotes';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  color: z.string().trim().max(40).nullable().optional(),
  position: z.number().int().min(0).max(500).optional(),
  // null moves the section back up to the top level of its notebook.
  parentId: z.string().trim().max(200).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return noStoreJson({ error: 'Invalid section details.', issues: parsed.error.issues }, { status: 400 });
    }
    const section = await updateSection(params.id, parsed.data);
    if (!section) return noStoreJson({ error: 'Section not found.' }, { status: 404 });
    return noStoreJson({ section });
  } catch (error) {
    // An impossible move is the caller's mistake, not a server fault.
    if (error instanceof SectionMoveError) {
      return noStoreJson({ error: error.message }, { status: 400 });
    }
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to update the section.' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const deletePages = req.nextUrl.searchParams.get('deletePages') === 'true';
    const result = await deleteSection(params.id, { deletePages });
    if (!result.deleted) return noStoreJson({ error: 'Section not found.' }, { status: 404 });
    return noStoreJson(result);
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to delete the section.' },
      { status: 500 },
    );
  }
}
