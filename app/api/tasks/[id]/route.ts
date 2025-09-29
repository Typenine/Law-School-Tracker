import { NextRequest } from 'next/server';
import { deleteTask, ensureSchema, updateTask } from '@/lib/storage';
import { UpdateTaskInput } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const body = (await req.json()) as UpdateTaskInput;
  const t = await updateTask(params.id, body);
  if (!t) return new Response('Not found', { status: 404 });
  return Response.json({ task: t });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const ok = await deleteTask(params.id);
  if (!ok) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 204 });
}
