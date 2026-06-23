import { NextRequest, NextResponse } from 'next/server';
import type { UpdateEventInput } from '@/lib/types';
import {
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from '@/lib/calendarEventStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const event = (await listCalendarEvents()).find(item => item.id === params.id);
  return event
    ? NextResponse.json({ event })
    : NextResponse.json({ error: 'Event not found' }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body: UpdateEventInput = await req.json();
    const event = await updateCalendarEvent(params.id, body);
    return event
      ? NextResponse.json({ event })
      : NextResponse.json({ error: 'Event not found' }, { status: 404 });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Event could not be updated.' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const removed = await deleteCalendarEvent(params.id);
    return removed
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'Event not found' }, { status: 404 });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Event could not be deleted.' }, { status: 500 });
  }
}
