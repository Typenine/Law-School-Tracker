import { NextRequest, NextResponse } from 'next/server';
import type { CalendarEvent, NewEventInput } from '@/lib/types';
import { mutateEvents, readEvents, uid } from '@/lib/collections';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const category = url.searchParams.get('category');

  try {
    let events = await readEvents();
    if (startDate) events = events.filter(e => e.date >= startDate);
    if (endDate) events = events.filter(e => e.date <= endDate);
    if (category) events = events.filter(e => e.category === category);
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to load events.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: NewEventInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!body?.title || !body?.date || !body?.category) {
    return NextResponse.json({ error: 'title, date, and category are required' }, { status: 400 });
  }

  const event: CalendarEvent = {
    id: uid(),
    title: body.title,
    description: body.description ?? null,
    category: body.category,
    date: body.date,
    startTime: body.startTime ?? null,
    endTime: body.endTime ?? null,
    allDay: body.allDay ?? !body.startTime,
    recurring: body.recurring ?? false,
    recurrenceRule: body.recurrenceRule ?? null,
    recurrenceEndDate: body.recurrenceEndDate ?? null,
    location: body.location ?? null,
    color: body.color ?? null,
    course: body.course ?? null,
    createdAt: new Date().toISOString(),
  };

  try {
    await mutateEvents(events => ({ events: [...events, event], result: null }));
    return NextResponse.json({ event }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to save the event.' },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  // Bulk replace all events
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!Array.isArray(body?.events)) {
    return NextResponse.json({ error: 'events array required' }, { status: 400 });
  }
  try {
    await mutateEvents(() => ({ events: body.events as CalendarEvent[], result: null }));
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to save events.' },
      { status: 500 },
    );
  }
}
