import { NextRequest } from 'next/server';
import { createTask, ensureSchema, listTasks } from '@/lib/storage';
import { NewTaskInput } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await ensureSchema();
  const tasks = await listTasks();
  return Response.json({ tasks });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = (await req.json()) as NewTaskInput;
  if (!body.title || !body.dueDate) {
    return new Response('Missing title or dueDate', { status: 400 });
  }
  const t = await createTask({
    title: body.title,
    dueDate: body.dueDate,
    course: body.course ?? null,
    status: body.status ?? 'todo',
    estimatedMinutes: body.estimatedMinutes ?? null,
  });
  return Response.json({ task: t }, { status: 201 });
}
