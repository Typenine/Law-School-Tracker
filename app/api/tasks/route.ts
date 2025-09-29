import { NextRequest } from 'next/server';
import { createTask, ensureSchema, listTasks } from '@/lib/storage';
import { NewTaskInput } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await ensureSchema();
  const tasks = await listTasks();
  return Response.json({ tasks });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const schema = z.object({
    title: z.string().min(1),
    course: z.string().trim().min(1).nullable().optional(),
    dueDate: z.string().min(1), // ISO string from client
    status: z.enum(['todo', 'done']).optional(),
    estimatedMinutes: z.number().int().min(0).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid task body', { status: 400 });
  const body = parsed.data as NewTaskInput;
  const t = await createTask({
    title: body.title,
    dueDate: body.dueDate,
    course: body.course ?? null,
    status: body.status ?? 'todo',
    estimatedMinutes: body.estimatedMinutes ?? null,
  });
  return Response.json({ task: t }, { status: 201 });
}
