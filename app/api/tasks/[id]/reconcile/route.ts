import { NextRequest } from 'next/server';
import { ensureSchema } from '@/lib/storage';
import { ensureTaskV2Schema, reconcileTaskSchedule } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    await reconcileTaskSchedule((await context.params).id, { onlyIfScheduled: true });
    return Response.json({ reconciled: true });
  } catch (error: any) {
    return Response.json({ error: error?.message || 'Unable to reconcile schedule.' }, { status: Number(error?.status) || 500 });
  }
}
