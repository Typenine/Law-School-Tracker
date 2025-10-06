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
    startTime: z.string().trim().nullable().optional().or(z.literal('')).transform(v => v === '' ? null : v),
    endTime: z.string().trim().nullable().optional().or(z.literal('')).transform(v => v === '' ? null : v),
    estimatedMinutes: z.number().int().min(0).nullable().optional(),
    priority: z.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    attachments: z.array(z.string().url()).nullable().optional(),
    dependsOn: z.array(z.string()).nullable().optional(),
    tags: z.array(z.string().trim().min(1)).nullable().optional(),
    term: z.string().trim().min(1).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid task body', { status: 400 });
  const body = parsed.data as NewTaskInput;
  const t = await createTask({
    title: body.title,
    dueDate: body.dueDate,
    course: body.course ?? null,
    status: body.status ?? 'todo',
    startTime: body.startTime ?? null,
    endTime: body.endTime ?? null,
    estimatedMinutes: body.estimatedMinutes ?? null,
    priority: body.priority ?? null,
    notes: body.notes ?? null,
    attachments: body.attachments ?? null,
    dependsOn: body.dependsOn ?? null,
    tags: body.tags ?? null,
    term: body.term ?? null,
  });
  return Response.json({ task: t }, { status: 201 });
}
