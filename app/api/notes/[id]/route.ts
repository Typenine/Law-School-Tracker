import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  deleteAiNote,
  getAiNote,
  updateAiNote,
  type NoteSourceType,
} from '@/lib/aiNotes';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const sourceTypes = [
  'class-notes',
  'reading-notes',
  'case-brief',
  'outline',
  'professor-material',
  'other',
] as const;

const updateSchema = z.object({
  title: z.string().trim().min(1).max(250).optional(),
  notebookId: z.string().trim().max(200).nullable().optional(),
  course: z.string().trim().max(200).nullable().optional(),
  semester: z.string().trim().max(100).nullable().optional(),
  section: z.string().trim().max(120).nullable().optional(),
  sectionId: z.string().trim().max(200).nullable().optional(),
  classDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sourceType: z.enum(sourceTypes).optional(),
  topics: z.array(z.string().trim().max(100)).max(50).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  content: z.string().max(2_000_000).optional(),
  contentHtml: z.string().max(4_000_000).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return noStoreJson(
        { error: 'Invalid note details.', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const note = await updateAiNote(params.id, {
      ...parsed.data,
      sourceType: parsed.data.sourceType as NoteSourceType | undefined,
    });
    if (!note) return noStoreJson({ error: 'Note not found.' }, { status: 404 });
    return noStoreJson({ note });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to update note.' },
      { status: 500 },
    );
  }
}

/**
 * Same as PATCH. navigator.sendBeacon can only issue POST, and it is the only
 * request the browser reliably completes while a tab is closing - so the
 * editor uses it to flush unsaved edits on the way out.
 */
export async function POST(
  req: NextRequest,
  context: { params: { id: string } },
) {
  return PATCH(req, context);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
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
