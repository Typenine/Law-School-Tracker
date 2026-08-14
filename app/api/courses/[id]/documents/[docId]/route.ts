import { NextRequest } from 'next/server';
import { deleteCourseDocument, ensureSchema, getCourseDocument } from '@/lib/storage';
import { deleteUploadedFile } from '@/lib/uploads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  await ensureSchema();
  const doc = await getCourseDocument(params.docId);
  const ok = await deleteCourseDocument(params.docId);
  if (!ok) return new Response('Not found', { status: 404 });
  if (doc) await deleteUploadedFile(doc.url);
  return new Response(null, { status: 204 });
}
