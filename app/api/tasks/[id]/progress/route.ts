import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSchema, listScheduleBlocks } from '@/lib/storage';
import { recordTaskProgress } from '@/lib/taskProgress';
import { clearStoredTaskTimer } from '@/lib/taskTimersV2';
import { captureCompletionSnapshot, ensureTaskV2Schema, markWorkflowAfterProgress, reconcileTaskSchedule } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  await ensureTaskV2Schema();
  const { id } = await context.params;
  const schema = z.object({
    mode: z.enum(['partial', 'finish']),
    minutes: z.number().int().min(1).max(1440),
    focus: z.number().min(1).max(10),
    notes: z.string().max(5000).nullable().optional(),
    pagesCompleted: z.string().max(500).nullable().optional(),
    moveToDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    completionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid progress entry.' }, { status: 400 });
  try {
    const beforeBlocks = await listScheduleBlocks().catch(() => []);
    const hadPlan = beforeBlocks.some(block => String(block.taskId) === String(id));
    if (parsed.data.mode === 'finish') await captureCompletionSnapshot(id);
    const result = await recordTaskProgress(id, parsed.data);
    const done = result.task.status === 'done';
    await markWorkflowAfterProgress(id, done);
    if (done) await clearStoredTaskTimer(id);
    if (!done && !parsed.data.moveToDay && hadPlan) await reconcileTaskSchedule(id, { onlyIfScheduled: true });
    return Response.json({ ...result, scheduleReconciled: !done && !parsed.data.moveToDay && hadPlan });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[task progress]', error);
    return Response.json({ error: error?.message || 'Unable to record progress.' }, { status });
  }
}
