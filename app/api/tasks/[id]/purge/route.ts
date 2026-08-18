import { NextRequest } from 'next/server';
import { ensureSchema } from '@/lib/storage';
import { clearStoredTaskTimer } from '@/lib/taskTimersV2';
import { ensureTaskV2Schema, purgeTask, reconcileDependents } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    await purgeTask((await context.params).id);
    await clearStoredTaskTimer((await context.params).id);
    await reconcileDependents((await context.params).id);
    return new Response(null, { status: 204 });
  } catch (error: any) {
    return Response.json({ error: error?.message || 'Unable to permanently delete task.' }, { status: Number(error?.status) || 500 });
  }
}
