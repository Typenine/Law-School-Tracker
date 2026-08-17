import { NextRequest } from 'next/server';
import { ensureSchema } from '@/lib/storage';
import { ensureTaskV2Schema, purgeTask, reconcileDependents } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    await purgeTask(params.id);
    await reconcileDependents(params.id);
    return new Response(null, { status: 204 });
  } catch (error: any) {
    return Response.json({ error: error?.message || 'Unable to permanently delete task.' }, { status: Number(error?.status) || 500 });
  }
}
