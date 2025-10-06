import { NextRequest } from 'next/server';
import { deleteTask, ensureSchema, updateTask } from '@/lib/storage';
import { UpdateTaskInput } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  const schema = z.object({
    title: z.string().min(1).optional(),
    course: z.string().trim().min(1).nullable().optional(),
    dueDate: z.string().optional(),
    status: z.enum(['todo', 'done']).optional(),
    startTime: z.string().trim().nullable().optional().or(z.literal('')).transform(v => v === '' ? null : v),
    endTime: z.string().trim().nullable().optional().or(z.literal('')).transform(v => v === '' ? null : v),
    estimatedMinutes: z.number().int().min(0).nullable().optional(),
    actualMinutes: z.number().int().min(0).nullable().optional(),
    priority: z.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    attachments: z.array(z.string().url()).nullable().optional(),
    dependsOn: z.array(z.string()).nullable().optional(),
    tags: z.array(z.string().trim().min(1)).nullable().optional(),
    term: z.string().trim().min(1).nullable().optional(),
    completedAt: z.string().nullable().optional(),
    focus: z.number().int().min(1).max(10).nullable().optional(),
    pagesRead: z.number().int().min(0).nullable().optional(),
    activity: z.string().trim().min(1).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid patch body', { status: 400 });
  const body = parsed.data as UpdateTaskInput;
  
  // Auto-set completedAt when marking as done
  if (body.status === 'done' && !body.completedAt) {
    body.completedAt = new Date().toISOString();
  }
  
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
