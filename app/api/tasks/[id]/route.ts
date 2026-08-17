import { NextRequest } from 'next/server';
import { ensureSchema, listTasks } from '@/lib/storage';
import { UpdateTaskInput } from '@/lib/types';
import { canonicalPageRanges } from '@/lib/reading';
import { clearStoredTaskTimer } from '@/lib/taskTimersV2';
import { completeTaskWithoutSession, editTaskStructured, ensureTaskV2Schema, purgeTask, reconcileDependents, reopenTask, trashTask } from '@/lib/taskV2';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  await ensureTaskV2Schema();
  const schema = z.object({
    title: z.string().min(1).optional(),
    course: z.string().trim().min(1).nullable().optional(),
    courseId: z.string().trim().min(1).nullable().optional(),
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
    estimateOrigin: z.enum(['learned', 'default', 'manual']).nullable().optional(),
    originalPageRanges: z.string().trim().max(500).nullable().optional(),
    remainingPageRanges: z.string().trim().max(500).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'Invalid patch body' }, { status: 400 });
  const body = parsed.data as UpdateTaskInput;
  try {
    if (body.originalPageRanges !== undefined && body.title === undefined) {
      const current = (await listTasks()).find(task => String(task.id) === String(params.id));
      const normalized = canonicalPageRanges(body.originalPageRanges);
      if (current && /\b(?:pp?|pages?)\.?\s*[0-9,\s–—-]+/i.test(current.title)) {
        body.title = normalized
          ? current.title.replace(/\b(?:pp?|pages?)\.?\s*[0-9,\s–—-]+/i, `pp. ${normalized}`)
          : current.title.replace(/\s*\b(?:pp?|pages?)\.?\s*[0-9,\s–—-]+/i, '').trim();
      }
    }

    if (body.status === 'done') {
      const task = await completeTaskWithoutSession(params.id);
      await clearStoredTaskTimer(params.id);
      const { status: _status, ...rest } = body as any;
      const updated = Object.keys(rest).length ? await editTaskStructured(params.id, rest as UpdateTaskInput) : task;
      return Response.json({ task: updated });
    }
    if (body.status === 'todo') {
      const current = (await listTasks()).find(task => String(task.id) === String(params.id));
      if (!current) return Response.json({ error: 'Not found' }, { status: 404 });
      if (current.status === 'done') await reopenTask(params.id);
      const { status: _status, ...rest } = body as any;
      if (!Object.keys(rest).length) {
        const task = (await listTasks()).find(item => String(item.id) === String(params.id));
        return Response.json({ task });
      }
      const task = await editTaskStructured(params.id, rest as UpdateTaskInput);
      return Response.json({ task });
    }
    const task = await editTaskStructured(params.id, body);
    return Response.json({ task });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[task patch]', error);
    return Response.json({ error: error?.message || 'Unable to update task.' }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
  await ensureTaskV2Schema();
  try {
    if (req.nextUrl.searchParams.get('purge') === 'true') await purgeTask(params.id);
    else await trashTask(params.id);
    await clearStoredTaskTimer(params.id);
    await reconcileDependents(params.id);
    return new Response(null, { status: 204 });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    return Response.json({ error: error?.message || 'Unable to delete task.' }, { status });
  }
}
