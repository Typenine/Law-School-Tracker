import { NextRequest, NextResponse } from 'next/server';
import type { CalendarEvent, UpdateEventInput } from '@/lib/types';

const SETTING_KEY = 'calendarEventsV1';

async function getEvents(): Promise<CalendarEvent[]> {
  try {
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/settings?keys=${SETTING_KEY}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    const events = data?.settings?.[SETTING_KEY];
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

async function saveEvents(events: CalendarEvent[]): Promise<void> {
  try {
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';
    await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [SETTING_KEY]: events }),
    });
  } catch {}
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const events = await getEvents();
  const event = events.find(e => e.id === params.id);
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  return NextResponse.json({ event });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body: UpdateEventInput = await req.json();
    const events = await getEvents();
    const idx = events.findIndex(e => e.id === params.id);
    if (idx === -1) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    
    const updated: CalendarEvent = {
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
    
    events[idx] = updated;
    await saveEvents(events);
    
    return NextResponse.json({ event: updated });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const events = await getEvents();
  const idx = events.findIndex(e => e.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  
  events.splice(idx, 1);
  await saveEvents(events);
  
  return NextResponse.json({ success: true });
}
