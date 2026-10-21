import { NextRequest } from 'next/server';
import { ensureSchema, updateSession, deleteSession, listTasks } from '@/lib/storage';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const id = (await context.params).id;
  const body = await req.json().catch(() => null);
  if (!id || !body || typeof body !== 'object') return new Response('Invalid body', { status: 400 });
  const schema = z.object({
    taskId: z.string().uuid().nullable().optional(),
    when: z.string().datetime().optional(),
    minutes: z.number().int().min(1).max(1440).optional(),
    focus: z.number().min(1).max(10).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    pagesRead: z.number().int().min(0).nullable().optional(),
    outlinePages: z.number().int().min(0).nullable().optional(),
    practiceQs: z.number().int().min(0).nullable().optional(),
    activity: z.string().max(32).nullable().optional(),
    semester: z.string().max(100).nullable().optional(),
  }).strict();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid study session update.' }, { status: 400 });
  if (parsed.data.taskId) {
    const tasks = await listTasks();
    if (!tasks.some(task => task.id === parsed.data.taskId)) return Response.json({ error: 'Assignment not found.' }, { status: 400 });
  }
  const updated = await updateSession(id, parsed.data);
  if (!updated) return new Response('Not found', { status: 404 });
  return Response.json({ session: updated });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const id = (await context.params).id;
  if (!id) return new Response('Invalid id', { status: 400 });
  const ok = await deleteSession(id);
  return new Response(null, { status: ok ? 204 : 404 });
}
