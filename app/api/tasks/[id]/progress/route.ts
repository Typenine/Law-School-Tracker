
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureSchema, listScheduleBlocks } from '@/lib/storage';
import { recordTaskProgress } from '@/lib/taskProgress';
import { smartSplitTaskSchedule } from '@/lib/readingSchedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureSchema();
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
    const hadSplitPlan = beforeBlocks.filter(block => block.taskId === params.id).length > 1;
    const result = await recordTaskProgress(params.id, parsed.data);
    let schedule = null;
    if (result.task.status !== 'done' && !parsed.data.moveToDay && hadSplitPlan && result.reading.remainingPages > 0) {
      schedule = await smartSplitTaskSchedule(params.id).catch(() => null);
    }
    return Response.json({ ...result, schedule });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[task progress]', error);
    return Response.json({ error: error?.message || 'Unable to record progress.' }, { status });
  }
}
