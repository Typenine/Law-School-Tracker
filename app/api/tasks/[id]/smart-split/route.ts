
import { NextRequest } from 'next/server';
import { ensureSchema } from '@/lib/storage';
import { smartSplitTaskSchedule } from '@/lib/readingSchedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureSchema();
    return Response.json(await smartSplitTaskSchedule(params.id));
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[smart split]', error);
    return Response.json({ error: error?.message || 'Unable to split reading.' }, { status });
  }
}
