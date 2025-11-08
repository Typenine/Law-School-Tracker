import { NextRequest } from 'next/server';
import { ensureSchema, updateSession, deleteSession } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const id = params.id;
  const body = await req.json().catch(() => null);
  if (!id || !body || typeof body !== 'object') return new Response('Invalid body', { status: 400 });
  const updated = await updateSession(id, body as any);
  if (!updated) return new Response('Not found', { status: 404 });
  return Response.json({ session: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const id = params.id;
  if (!id) return new Response('Invalid id', { status: 400 });
  const ok = await deleteSession(id);
  return new Response(null, { status: ok ? 204 : 404 });
}
