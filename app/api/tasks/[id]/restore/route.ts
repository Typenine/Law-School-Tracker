import { NextRequest } from 'next/server';
import { ensureSchema } from '@/lib/storage';
import { ensureTaskV2Schema, reconcileDependents, restoreTask } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    await restoreTask(params.id);
    await reconcileDependents(params.id);
    return Response.json({ restored: true, id: params.id });
  } catch (error: any) {
    return Response.json({ error: error?.message || 'Unable to restore task.' }, { status: Number(error?.status) || 500 });
  }
}
