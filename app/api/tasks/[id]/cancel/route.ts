import { NextRequest } from 'next/server';
import { ensureSchema } from '@/lib/storage';
import { clearStoredTaskTimer } from '@/lib/taskTimersV2';
import { cancelTask, ensureTaskV2Schema, reactivateTask } from '@/lib/taskV2';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    const parsed = z.object({ reactivate: z.boolean().optional().default(false) }).safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: 'Invalid request.' }, { status: 400 });
    const meta = parsed.data.reactivate ? await reactivateTask(params.id) : await cancelTask(params.id);
    if (!parsed.data.reactivate) await clearStoredTaskTimer(params.id);
    return Response.json({ meta });
  } catch (error: any) {
    return Response.json({ error: error?.message || 'Unable to change task status.' }, { status: Number(error?.status) || 500 });
  }
}
