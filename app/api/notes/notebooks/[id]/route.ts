import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteNotebook, getNotebook, updateNotebook } from '@/lib/aiNotes';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  course: z.string().trim().max(200).nullable().optional(),
  semester: z.string().trim().max(100).nullable().optional(),
  color: z.string().trim().max(40).nullable().optional(),
  archived: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const notebook = await getNotebook((await context.params).id);
    if (!notebook) return noStoreJson({ error: 'Notebook not found.' }, { status: 404 });
    return noStoreJson({ notebook });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load notebook.' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return noStoreJson(
        { error: 'Invalid notebook details.', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const notebook = await updateNotebook((await context.params).id, parsed.data);
    if (!notebook) return noStoreJson({ error: 'Notebook not found.' }, { status: 404 });
    return noStoreJson({ notebook });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to update notebook.' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const deleted = await deleteNotebook((await context.params).id);
    if (!deleted) return noStoreJson({ error: 'Notebook not found.' }, { status: 404 });
    return noStoreJson({ deleted: true });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to delete notebook.' },
      { status: 500 },
    );
  }
}
