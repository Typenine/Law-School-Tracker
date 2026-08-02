import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createNotebook, listNotebooks } from '@/lib/aiNotes';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const notebookSchema = z.object({
  name: z.string().trim().min(1).max(160),
  course: z.string().trim().max(200).nullable().optional(),
  semester: z.string().trim().max(100).nullable().optional(),
  color: z.string().trim().max(40).nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const notebooks = await listNotebooks(req.nextUrl.searchParams.get('archived') === 'true');
    return noStoreJson({ notebooks });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load notebooks.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = notebookSchema.safeParse(await req.json());
    if (!parsed.success) {
      return noStoreJson(
        { error: 'Invalid notebook details.', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const notebook = await createNotebook(parsed.data);
    return noStoreJson({ notebook }, { status: 201 });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to create notebook.' },
      { status: 500 },
    );
  }
}
