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

// ---------------------------------------------------------------------------
// Failed-auth throttle
//
// A bad bearer token is rejected in constant time, but nothing stopped a
// script from just trying again and again. This tracks failures per client
// IP in memory and locks that IP out for a while once it crosses a threshold.
// It resets on cold start and is per-instance, not global, so on Vercel it is
// a best-effort speed bump rather than a hard guarantee - but it still stops
// a naive brute-force script hitting a warm instance, which is the realistic
// threat here.
// ---------------------------------------------------------------------------
const FAILED_AUTH_WINDOW_MS = 5 * 60 * 1000;
const FAILED_AUTH_MAX = 20;
const failuresByClient = new Map<string, { count: number; windowStart: number }>();

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return (req as unknown as { ip?: string }).ip || 'unknown';
}

function isLockedOut(key: string): boolean {
  const entry = failuresByClient.get(key);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > FAILED_AUTH_WINDOW_MS) {
    failuresByClient.delete(key);
    return false;
  }
  return entry.count >= FAILED_AUTH_MAX;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = failuresByClient.get(key);
  if (!entry || now - entry.windowStart > FAILED_AUTH_WINDOW_MS) {
    failuresByClient.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
  // Bound memory use: an unbounded map of client keys is itself a resource
  // for an attacker to grow, so sweep stale entries once the map gets large
  // rather than tracking every IP forever.
  if (failuresByClient.size > 1000) {
    for (const [k, v] of failuresByClient) {
      if (now - v.windowStart > FAILED_AUTH_WINDOW_MS) failuresByClient.delete(k);
    }
  }
}

function clearFailures(key: string): void {
  failuresByClient.delete(key);
}

function checkBearerToken(req: NextRequest, envVar: string, configured: string | undefined): Response | null {
  if (!configured) {
    return Response.json({ error: `${envVar} is not configured.` }, { status: 503 });
  }
  const key = clientKey(req);
  if (isLockedOut(key)) {
    return Response.json(
      { error: 'Too many failed attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(FAILED_AUTH_WINDOW_MS / 1000)) } },
    );
  }
  const supplied = bearerToken(req);
  if (!supplied || !safeEqual(supplied, configured)) {
    recordFailure(key);
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  clearFailures(key);
  return null;
}

export function requireGptToken(req: NextRequest): Response | null {
  const configured = process.env.LAW_SCHOOL_GPT_TOKEN?.trim();
  return checkBearerToken(req, 'LAW_SCHOOL_GPT_TOKEN', configured);
}

/**
 * Guards the notes-specific GPT endpoints (searchNotes, getNote,
 * listNotebooks). Accepts a dedicated LAW_SCHOOL_NOTES_TOKEN so notes - the
 * most sensitive thing this Action reads - can be scoped to a token separate
 * from the one that lists courses and assignments. Falls back to
 * LAW_SCHOOL_GPT_TOKEN when unset, so existing single-token setups keep
 * working unchanged.
 */
export function requireNotesToken(req: NextRequest): Response | null {
  const configured = (
    process.env.LAW_SCHOOL_NOTES_TOKEN || process.env.LAW_SCHOOL_GPT_TOKEN
  )?.trim();
  return checkBearerToken(req, 'LAW_SCHOOL_NOTES_TOKEN', configured);
}

export function noStoreJson(data: unknown, init?: ResponseInit): Response {
  const response = Response.json(data, init);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.headers.set('CDN-Cache-Control', 'no-store');
  response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  return response;
}
