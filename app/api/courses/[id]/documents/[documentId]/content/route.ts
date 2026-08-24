import { NextRequest } from 'next/server';
import { ensureSchema, getCourseDocument } from '@/lib/storage';
import { LOCAL_UPLOAD_URL_PREFIX, readLocalUpload } from '@/lib/uploads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function contentDisposition(filename: string, download: boolean): string {
  const safe = filename.replace(/[\r\n"]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `${download ? 'attachment' : 'inline'}; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; documentId: string }> },
) {
  await ensureSchema();
  const { id, documentId } = await context.params;
  const doc = await getCourseDocument(documentId);
  if (!doc || doc.courseId !== id) return new Response('Document not found.', { status: 404 });

  let bytes: ArrayBuffer | Uint8Array;
  try {
    if (doc.url.startsWith(`${LOCAL_UPLOAD_URL_PREFIX}/`)) {
      const localName = doc.url.slice(LOCAL_UPLOAD_URL_PREFIX.length + 1);
      const buffer = await readLocalUpload(localName);
      if (!buffer) return new Response('Document file not found.', { status: 404 });
      bytes = new Uint8Array(buffer);
    } else {
      const upstream = await fetch(doc.url, { cache: 'no-store' });
      if (!upstream.ok) return new Response('Unable to load document file.', { status: 502 });
      bytes = await upstream.arrayBuffer();
    }
  } catch {
    return new Response('Unable to load document file.', { status: 502 });
  }

  const download = req.nextUrl.searchParams.get('download') === '1';
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': doc.mimeType || 'application/octet-stream',
      'Content-Disposition': contentDisposition(doc.filename, download),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
