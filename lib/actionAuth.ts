import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function requireGptToken(req: NextRequest): Response | null {
  const configured = process.env.LAW_SCHOOL_GPT_TOKEN?.trim();
  if (!configured) {
    return Response.json(
      { error: 'LAW_SCHOOL_GPT_TOKEN is not configured.' },
      { status: 503 },
    );
  }
  const supplied = bearerToken(req);
  if (!supplied || !safeEqual(supplied, configured)) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  return null;
}

export function requireNotesToken(req: NextRequest): Response | null {
  const configured = (
    process.env.LAW_SCHOOL_NOTES_TOKEN || process.env.LAW_SCHOOL_GPT_TOKEN
  )?.trim();
  if (!configured) {
    return Response.json(
      { error: 'LAW_SCHOOL_NOTES_TOKEN is not configured.' },
      { status: 503 },
    );
  }
  const supplied = bearerToken(req);
  if (!supplied || !safeEqual(supplied, configured)) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  return null;
}

export function noStoreJson(data: unknown, init?: ResponseInit): Response {
  const response = Response.json(data, init);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.headers.set('CDN-Cache-Control', 'no-store');
  response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  return response;
}
