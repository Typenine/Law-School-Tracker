import { NextRequest, NextResponse } from 'next/server';
import {
  deleteActiveWorkSession,
  getActiveWorkSession,
  saveActiveWorkSession,
  type ActiveWorkSessionRecord,
} from '@/lib/activeWorkSessionStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('taskId') || '';
  if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  return NextResponse.json({ session: await getActiveWorkSession(taskId) });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as ActiveWorkSessionRecord;
    if (!body?.taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    const session = await saveActiveWorkSession({
      taskId: String(body.taskId),
      running: Boolean(body.running),
      accumulatedSeconds: Math.max(0, Number(body.accumulatedSeconds) || 0),
      startedAt: body.startedAt ? Number(body.startedAt) : null,
      sessionStartedAt: body.sessionStartedAt || new Date().toISOString(),
      notes: String(body.notes || ''),
      pages: String(body.pages || ''),
      updatedAt: body.updatedAt || new Date().toISOString(),
    });
    return NextResponse.json({ session });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Active session could not be saved.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('taskId') || '';
  if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  return NextResponse.json({ removed: await deleteActiveWorkSession(taskId) });
}
