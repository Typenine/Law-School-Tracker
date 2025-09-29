import { NextRequest } from 'next/server';
import { createSession, ensureSchema, listSessions } from '@/lib/storage';
import { NewSessionInput } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await ensureSchema();
  const sessions = await listSessions();
  return Response.json({ sessions });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const schema = z.object({
    taskId: z.string().min(1).optional().nullable(),
    when: z.string().optional(),
    minutes: z.number().int().positive(),
    focus: z.number().int().min(1).max(10).optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid session body', { status: 400 });
  const body = parsed.data as NewSessionInput;
  const s = await createSession({
    taskId: body.taskId ?? null,
    when: body.when,
    minutes: body.minutes,
    focus: body.focus ?? null,
    notes: body.notes ?? null,
  });
  return Response.json({ session: s }, { status: 201 });
}
