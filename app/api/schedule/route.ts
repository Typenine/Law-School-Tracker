import { NextRequest } from 'next/server';
import { ensureSchema, listScheduleBlocks, replaceAllScheduleBlocks, ScheduleBlockRow } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await ensureSchema();
  const blocks = await listScheduleBlocks();
  return Response.json({ blocks });
}

export async function PUT(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || !Array.isArray((body as any).blocks)) return new Response('Invalid body', { status: 400 });
  const blocks = (body as any).blocks as ScheduleBlockRow[];
  await replaceAllScheduleBlocks(blocks);
  return new Response(null, { status: 204 });
}

// POST handler for sendBeacon (which only supports POST)
export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || !Array.isArray((body as any).blocks)) return new Response('Invalid body', { status: 400 });
  const blocks = (body as any).blocks as ScheduleBlockRow[];
  await replaceAllScheduleBlocks(blocks);
  return new Response(null, { status: 204 });
}
