
import { NextRequest } from 'next/server';
import { createTask, ensureSchema, listCourses, listTasks } from '@/lib/storage';
import { activeSemesterId } from '@/lib/collections';
import { NewTaskInput } from '@/lib/types';
import { normalizeReadingTaskInput } from '@/lib/reading';
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
    courseId: z.string().trim().min(1).nullable().optional(),
    dueDate: z.string().min(1),
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
    originalPageRanges: z.string().trim().max(500).nullable().optional(),
    remainingPageRanges: z.string().trim().max(500).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid task body', { status: 400 });
  const normalized = normalizeReadingTaskInput(parsed.data as NewTaskInput, await listCourses());
  const defaultTerm = normalized.term ?? await activeSemesterId();
  const task = await createTask({ ...normalized, term: defaultTerm ?? null });
  return Response.json({ task }, { status: 201 });
}
