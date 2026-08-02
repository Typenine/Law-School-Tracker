import { NextRequest, NextResponse } from 'next/server';
import type { CalendarEvent, UpdateEventInput } from '@/lib/types';
import { mutateEvents, readEvents } from '@/lib/collections';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const events = await readEvents();
    const event = events.find(e => e.id === params.id);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    return NextResponse.json({ event });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to load the event.' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: UpdateEventInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const updated = await mutateEvents(events => {
      const idx = events.findIndex(e => e.id === params.id);
      if (idx === -1) return { events, result: null as CalendarEvent | null };
      const next: CalendarEvent = {
        ...events[idx],
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.date !== undefined && { date: body.date }),
        ...(body.startTime !== undefined && { startTime: body.startTime }),
        ...(body.endTime !== undefined && { endTime: body.endTime }),
        ...(body.allDay !== undefined && { allDay: body.allDay }),
        ...(body.recurring !== undefined && { recurring: body.recurring }),
        ...(body.recurrenceRule !== undefined && { recurrenceRule: body.recurrenceRule }),
        ...(body.recurrenceEndDate !== undefined && { recurrenceEndDate: body.recurrenceEndDate }),
        ...(body.location !== undefined && { location: body.location }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.course !== undefined && { course: body.course }),
      };
      const copy = events.slice();
      copy[idx] = next;
      return { events: copy, result: next };
    });
    if (!updated) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    return NextResponse.json({ event: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to update the event.' },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const removed = await mutateEvents(events => {
      const next = events.filter(e => e.id !== params.id);
      return { events: next, result: next.length < events.length };
    });
    if (!removed) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to delete the event.' },
      { status: 500 },
    );
  }
}
