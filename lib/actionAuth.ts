import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

const textEncoder = new TextEncoder();

function safeEqual(a: string, b: string): boolean {
  const left = textEncoder.encode(a);
  const right = textEncoder.encode(b);
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

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
  if (failuresByClient.size > 1000) {
    for (const [k, v] of failuresByClient) {
      if (now - v.windowStart > FAILED_AUTH_WINDOW_MS) failuresByClient.delete(k);
    }
  }
}

function clearFailures(key: string): void {
  failuresByClient.delete(key);
}

function checkBearerTokens(req: NextRequest, envVar: string, configuredValues: Array<string | undefined>): Response | null {
  const configured = Array.from(new Set(configuredValues.map(value => value?.trim()).filter((value): value is string => Boolean(value))));
  if (!configured.length) {
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
  const valid = Boolean(supplied) && configured.some(secret => safeEqual(supplied as string, secret));
  if (!valid) {
    recordFailure(key);
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  clearFailures(key);
  return null;
}

export function requireGptToken(req: NextRequest): Response | null {
  return checkBearerTokens(req, 'LAW_SCHOOL_GPT_TOKEN', [process.env.LAW_SCHOOL_GPT_TOKEN]);
}

/**
 * Notes may have a dedicated secret, but the general connector token is always
 * accepted too. A GPT Action has one authentication configuration for the
 * whole OpenAPI schema, so setting LAW_SCHOOL_NOTES_TOKEN must not make the
 * notes operations unreachable from the same connector.
 */
export function requireNotesToken(req: NextRequest): Response | null {
  return checkBearerTokens(req, 'LAW_SCHOOL_GPT_TOKEN or LAW_SCHOOL_NOTES_TOKEN', [
    process.env.LAW_SCHOOL_GPT_TOKEN,
    process.env.LAW_SCHOOL_NOTES_TOKEN,
  ]);
}

export function noStoreJson(data: unknown, init?: ResponseInit): Response {
  const response = Response.json(data, init);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.headers.set('CDN-Cache-Control', 'no-store');
  response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  return response;
}
