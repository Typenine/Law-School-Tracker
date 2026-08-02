import { NextRequest } from 'next/server';
import { put } from '@vercel/blob';
import { randomUUID } from 'crypto';
import { noStoreJson } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

/**
 * Store an image for a note and hand back its URL.
 *
 * Images go to blob storage rather than into the page as a data URI: a few
 * screenshots inlined as base64 would bloat every note fetch and the database
 * along with it.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const entry = form.get('file');
    if (!(entry instanceof File) || entry.size === 0) {
      return noStoreJson({ error: 'No image was uploaded.' }, { status: 400 });
    }
    if (entry.size > MAX_BYTES) {
      return noStoreJson({ error: 'Images must be smaller than 8 MB.' }, { status: 413 });
    }
    const type = (entry.type || '').toLowerCase();
    if (!ALLOWED.has(type)) {
      return noStoreJson(
        { error: 'Only PNG, JPEG, GIF, WebP and AVIF images can be added.' },
        { status: 415 },
      );
    }

    const extension = type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const blob = await put(`notes/${randomUUID()}.${extension}`, entry, {
      access: 'public',
      contentType: type,
      addRandomSuffix: false,
    });
    return noStoreJson({ url: blob.url }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to store the image.';
    // Blob storage is optional in local development; say so plainly.
    const missing = /token|BLOB_READ_WRITE_TOKEN|store/i.test(message);
    return noStoreJson(
      { error: missing ? 'Image storage is not configured. Bind Vercel Blob to enable images.' : message },
      { status: missing ? 503 : 500 },
    );
  }
}
