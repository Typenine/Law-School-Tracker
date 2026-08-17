import { NextRequest } from 'next/server';
import { ensureSchema } from '@/lib/storage';
import { ensureTaskV2Schema, saveChecklist } from '@/lib/taskV2';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    const schema = z.object({ items: z.array(z.object({ id: z.string().min(1), title: z.string().min(1).max(240), done: z.boolean(), createdAt: z.string().optional() })).max(100) });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: 'Invalid checklist.' }, { status: 400 });
    const meta = await saveChecklist(params.id, parsed.data.items.map(item => ({ ...item, createdAt: item.createdAt || new Date().toISOString() })));
    return Response.json({ checklist: meta.checklist, workflowState: meta.workflowState });
  } catch (error: any) {
    return Response.json({ error: error?.message || 'Unable to save checklist.' }, { status: Number(error?.status) || 500 });
  }
}
