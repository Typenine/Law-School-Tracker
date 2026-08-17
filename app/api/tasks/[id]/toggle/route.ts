import { NextRequest } from 'next/server';
import { ensureSchema, listTasks } from '@/lib/storage';
import { clearStoredTaskTimer } from '@/lib/taskTimersV2';
import { completeTaskWithoutSession, ensureTaskV2Schema, reopenTask } from '@/lib/taskV2';
import { createHmac } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function verify(id: string, exp: number, sig: string): boolean {
  const secret = process.env.ICS_TOGGLE_SECRET || process.env.ICS_PRIVATE_TOKEN || '';
  if (!secret) return false;
  const payload = `${id}:${exp}`;
  const expect = createHmac('sha256', secret).update(payload).digest('hex');
  return expect === sig;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  await ensureTaskV2Schema();
  const u = new URL(req.url);
  const id = params.id;
  const exp = parseInt(u.searchParams.get('exp') || '0', 10);
  const sig = u.searchParams.get('sig') || '';
  const origin = u.origin;
  if (!id || !exp || !sig) return new Response('Bad request', { status: 400 });
  if (exp < Math.floor(Date.now() / 1000)) return new Response('Link expired', { status: 410 });
  if (!verify(id, exp, sig)) return new Response('Unauthorized', { status: 401 });

  const task = (await listTasks()).find(item => item.id === id);
  if (!task) return new Response('Not found', { status: 404 });
  const nextStatus = task.status === 'done' ? 'todo' : 'done';
  if (task.status === 'done') await reopenTask(id);
  else {
    await completeTaskWithoutSession(id);
    await clearStoredTaskTimer(id);
  }
  return Response.redirect(`${origin}/?toggled=${encodeURIComponent(id)}&status=${nextStatus}`, 302);
}
