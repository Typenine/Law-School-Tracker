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
    title: z.string().min(1),
    course: z.string().trim().min(1).nullable().optional(),
    dueDate: z.string().min(1), // ISO string from client
    status: z.enum(['todo', 'done']).optional(),
    startTime: z.string().trim().nullable().optional().or(z.literal('')).transform(v => v === '' ? null : v),
    endTime: z.string().trim().nullable().optional().or(z.literal('')).transform(v => v === '' ? null : v),
    estimatedMinutes: z.number().int().min(0).nullable().optional(),
    estimateOrigin: z.enum(['learned','default','manual']).nullable().optional(),
    priority: z.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    attachments: z.array(z.string().url()).nullable().optional(),
    dependsOn: z.array(z.string()).nullable().optional(),
    tags: z.array(z.string().trim().min(1)).nullable().optional(),
    term: z.string().trim().min(1).nullable().optional(),
    pagesRead: z.number().int().min(0).nullable().optional(),
    activity: z.string().trim().min(1).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid task body', { status: 400 });
  const body = parsed.data as NewTaskInput;
  const defaultTerm = body.term ?? await getActiveSemesterId();
  const t = await createTask({
    title: body.title,
    dueDate: body.dueDate,
    course: body.course ?? null,
    status: body.status ?? 'todo',
    startTime: body.startTime ?? null,
    endTime: body.endTime ?? null,
    estimatedMinutes: body.estimatedMinutes ?? null,
    estimateOrigin: (body as any).estimateOrigin ?? null,
    priority: body.priority ?? null,
    notes: body.notes ?? null,
    attachments: body.attachments ?? null,
    dependsOn: body.dependsOn ?? null,
    tags: body.tags ?? null,
    term: defaultTerm ?? null,
    pagesRead: (body as any).pagesRead ?? null,
    activity: (body as any).activity ?? null,
  });
  return Response.json({ task: t }, { status: 201 });
}
