import { NextRequest } from 'next/server';
import { createSession, ensureSchema, listSessions } from '@/lib/storage';
import { NewSessionInput } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await ensureSchema();
  const sessions = await listSessions();
  return Response.json({ sessions });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = (await req.json()) as NewSessionInput;
  if (!body.minutes || body.minutes <= 0) return new Response('minutes must be > 0', { status: 400 });
  const s = await createSession({
    taskId: body.taskId ?? null,
    when: body.when,
    minutes: body.minutes,
    focus: body.focus ?? null,
    notes: body.notes ?? null,
  });
  return Response.json({ session: s }, { status: 201 });
}
