import { NextRequest, NextResponse } from 'next/server';
import type { NewEventInput } from '@/lib/types';
import {
  createCalendarEvent,
  listCalendarEvents,
  replaceCalendarEvents,
} from '@/lib/calendarEventStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const startDate = req.nextUrl.searchParams.get('startDate');
  const endDate = req.nextUrl.searchParams.get('endDate');
  const category = req.nextUrl.searchParams.get('category');
  let events = await listCalendarEvents();
  if (startDate) events = events.filter(event => event.date >= startDate);
  if (endDate) events = events.filter(event => event.date <= endDate);
  if (category) events = events.filter(event => event.category === category);
  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  try {
    const body: NewEventInput = await req.json();
    if (!body.title || !body.date || !body.category) {
      return NextResponse.json({ error: 'title, date, and category are required' }, { status: 400 });
    }
    const event = await createCalendarEvent(body);
    return NextResponse.json({ event }, { status: 201 });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Event could not be created.' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (!Array.isArray(body.events)) return NextResponse.json({ error: 'events array required' }, { status: 400 });
    await replaceCalendarEvents(body.events);
    return NextResponse.json({ success: true });
  } catch (cause: any) {
    return NextResponse.json({ error: cause?.message || 'Events could not be replaced.' }, { status: 500 });
  }
}
