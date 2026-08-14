import { NextRequest } from 'next/server';
import { readLocalUpload } from '@/lib/uploads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  md: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Serves files saved by lib/uploads.ts when Vercel Blob isn't configured
 * (i.e. local development). In production with Blob bound, uploads get a
 * blob.vercel-storage.com URL directly and never hit this route.
 */
export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  const buffer = await readLocalUpload(params.name);
  if (!buffer) return new Response('Not found', { status: 404 });
  const ext = (params.name.split('.').pop() || '').toLowerCase();
  const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
