import { NextRequest } from 'next/server';
import { ensureSchema, listScheduleBlocks, replaceAllScheduleBlocks, ScheduleBlockRow } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * These handlers used to let storage errors escape, so a failure surfaced in
 * the UI as a bare "500 Internal Server Error" toast with no indication of
 * what went wrong. They now report the underlying reason.
 */
function failure(error: unknown, fallback: string): Response {
  const message = error instanceof Error ? error.message : fallback;
  console.error('[api/schedule]', error);
  return Response.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    await ensureSchema();
    const blocks = await listScheduleBlocks();
    return Response.json({ blocks });
  } catch (e) {
    return failure(e, 'Unable to load the week plan.');
  }
}

async function save(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || !Array.isArray((body as any).blocks)) {
    return Response.json({ error: 'Expected a { blocks: [...] } body.' }, { status: 400 });
  }
  try {
    await ensureSchema();
    await replaceAllScheduleBlocks((body as any).blocks as ScheduleBlockRow[]);
    return new Response(null, { status: 204 });
  } catch (e) {
    return failure(e, 'Unable to save the week plan.');
  }
}

export async function PUT(req: NextRequest) {
  return save(req);
}

// POST handler for sendBeacon (which only supports POST)
export async function POST(req: NextRequest) {
  return save(req);
}
