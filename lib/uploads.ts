import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { put, del } from '@vercel/blob';

const IS_VERCEL = !!process.env.VERCEL;
const HAS_BLOB = !!process.env.VERCEL || !!process.env.BLOB_URL || !!process.env.BLOB_READ_WRITE_TOKEN;
// Mirrors the DATA_DIR split in lib/storage.ts: writable, persistent locally;
// ephemeral (but fine for the fallback path) on a serverless filesystem.
const UPLOAD_DIR = IS_VERCEL
  ? path.join('/tmp', 'law-school-tracker', 'uploads')
  : path.join(process.cwd(), 'data', 'uploads');

export const LOCAL_UPLOAD_URL_PREFIX = '/api/uploads';

function extensionFor(filename: string, mimeType: string): string {
  const fromName = path.extname(filename || '').replace('.', '').toLowerCase();
  if (fromName) return fromName;
  const fromMime = mimeType.split('/')[1];
  return (fromMime || 'bin').toLowerCase();
}

/**
 * Saves an uploaded file's bytes and returns a publicly fetchable URL.
 *
 * Uses Vercel Blob when it's bound/configured (production); otherwise falls
 * back to local disk served by /api/uploads/[name], so course documents work
 * in local development without any storage provider set up.
 */
export async function saveUploadedFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  keyPrefix = 'course-documents',
): Promise<{ url: string; storageKey: string }> {
  const ext = extensionFor(filename, mimeType);
  const key = `${keyPrefix}/${randomUUID()}.${ext}`;

  if (HAS_BLOB) {
    const blob = await put(key, buffer, {
      access: 'public',
      contentType: mimeType,
      addRandomSuffix: false,
    });
    return { url: blob.url, storageKey: key };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const localName = key.replace(/\//g, '__');
  // Buffer's typings can widen to ArrayBufferLike (which includes
  // SharedArrayBuffer) depending on the @types/node version in play, which
  // fs.writeFile's overloads reject. A plain Uint8Array view sidesteps that.
  await fs.writeFile(path.join(UPLOAD_DIR, localName), new Uint8Array(buffer));
  return { url: `${LOCAL_UPLOAD_URL_PREFIX}/${localName}`, storageKey: localName };
}

/** Reads a locally-stored upload back out for the /api/uploads route. */
export async function readLocalUpload(localName: string): Promise<Buffer | null> {
  try {
    // Guard against path traversal; we only ever wrote flat, sanitized names.
    if (localName.includes('..') || localName.includes('/') || localName.includes('\\')) return null;
    return await fs.readFile(path.join(UPLOAD_DIR, localName));
  } catch {
    return null;
  }
}

export async function deleteUploadedFile(url: string): Promise<void> {
  if (url.startsWith(LOCAL_UPLOAD_URL_PREFIX)) {
    const localName = url.slice(LOCAL_UPLOAD_URL_PREFIX.length + 1);
    if (localName.includes('..') || localName.includes('/') || localName.includes('\\')) return;
    await fs.unlink(path.join(UPLOAD_DIR, localName)).catch(() => undefined);
    return;
  }
  await del(url).catch(() => undefined);
}
