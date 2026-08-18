import { NextRequest } from 'next/server';
import { ensureSchema } from '@/lib/storage';
import { smartSplitTaskSchedule } from '@/lib/readingSchedule';
import { ensureTaskV2Schema, taskIsBlocked } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    const state = await taskIsBlocked((await context.params).id);
    if (state.blocked) return Response.json({ error: `Complete ${state.blockers.map(item => item.title).join(', ')} first.` }, { status: 409 });
    return Response.json(await smartSplitTaskSchedule((await context.params).id));
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[smart split]', error);
    return Response.json({ error: error?.message || 'Unable to split reading.' }, { status });
  }
}
