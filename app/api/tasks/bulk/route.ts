import { NextRequest } from 'next/server';
import { ensureSchema, createTask } from '@/lib/storage';
import { NewTaskInput, Task } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  await ensureSchema();
  const schema = z.object({
    tasks: z.array(z.object({
      title: z.string().min(1),
      dueDate: z.string().min(1),
      course: z.string().trim().min(1).nullable().optional(),
      status: z.enum(['todo', 'done']).optional(),
      estimatedMinutes: z.number().int().min(0).nullable().optional(),
      priority: z.number().int().min(1).max(5).nullable().optional(),
      tags: z.array(z.string().trim().min(1)).nullable().optional(),
      term: z.string().trim().min(1).nullable().optional(),
    })).min(1)
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid bulk body', { status: 400 });
  const input = parsed.data.tasks as NewTaskInput[];
  const created: Task[] = [];
  for (const t of input) {
    const c = await createTask({
      title: t.title,
      dueDate: t.dueDate,
      course: t.course ?? null,
      status: t.status ?? 'todo',
      estimatedMinutes: t.estimatedMinutes ?? null,
      priority: t.priority ?? null,
      tags: (t as any).tags ?? null,
      term: (t as any).term ?? null,
    });
    created.push(c);
  }
  return Response.json({ createdCount: created.length, tasks: created }, { status: 201 });
}
