import { NextRequest } from 'next/server';
import { createCourseDocument, ensureSchema, listCourseDocuments } from '@/lib/storage';
import { saveUploadedFile } from '@/lib/uploads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md',
  'png', 'jpg', 'jpeg', 'gif', 'webp',
]);
const ALLOWED_CATEGORIES = new Set(['syllabus', 'slides', 'reading', 'other']);

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const documents = await listCourseDocuments(params.id);
  return Response.json({ documents });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  try {
    const form = await req.formData();
    const entry = form.get('file');
    if (!(entry instanceof File) || entry.size === 0) {
      return new Response('No file was uploaded.', { status: 400 });
    }
    if (entry.size > MAX_BYTES) {
      return new Response('Files must be smaller than 20 MB.', { status: 413 });
    }
    const ext = (entry.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return new Response('Unsupported file type. Upload a PDF, Word, PowerPoint, Excel, text, or image file.', { status: 415 });
    }
    const title = (form.get('title') as string | null)?.trim() || entry.name.replace(/\.[^.]+$/, '');
    const rawCategory = (form.get('category') as string | null)?.trim().toLowerCase() || 'other';
    const category = (ALLOWED_CATEGORIES.has(rawCategory) ? rawCategory : 'other') as any;
    const buffer = Buffer.from(await entry.arrayBuffer());
    const mimeType = entry.type || 'application/octet-stream';
    const { url } = await saveUploadedFile(buffer, entry.name, mimeType);

    const doc = await createCourseDocument({
      courseId: params.id,
      title,
      filename: entry.name,
      mimeType,
      size: entry.size,
      url,
      category,
    });
    return Response.json({ document: doc }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to upload the file.';
    return new Response(message, { status: 500 });
  }
}
