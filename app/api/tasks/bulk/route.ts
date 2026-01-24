import { NextRequest } from 'next/server';
import { ensureSchema, createTask } from '@/lib/storage';
import { NewTaskInput, Task } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  await ensureSchema();
  async function getActiveSemesterId(): Promise<string | null> {
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/api/semesters?active=true`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      const arr = Array.isArray(data?.semesters) ? data.semesters : [];
      return arr[0]?.id || null;
    } catch {
      return null;
    }
  }
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
  const defaultTerm = await getActiveSemesterId();
  for (const t of input) {
    const c = await createTask({
      title: t.title,
      dueDate: t.dueDate,
      course: t.course ?? null,
      status: t.status ?? 'todo',
      estimatedMinutes: t.estimatedMinutes ?? null,
      priority: t.priority ?? null,
      tags: (t as any).tags ?? null,
      term: (t as any).term ?? defaultTerm ?? null,
    });
    created.push(c);
  }
  return Response.json({ createdCount: created.length, tasks: created }, { status: 201 });
}
