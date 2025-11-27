import { NextRequest, NextResponse } from 'next/server';
import type { CalendarEvent, NewEventInput } from '@/lib/types';

// Events stored in settings under 'calendarEventsV1'
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

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const category = url.searchParams.get('category');
  
  let events = await getEvents();
  
  // Filter by date range
  if (startDate) {
    events = events.filter(e => e.date >= startDate);
  }
  if (endDate) {
    events = events.filter(e => e.date <= endDate);
  }
  // Filter by category
  if (category) {
    events = events.filter(e => e.category === category);
  }
  
  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  try {
    const body: NewEventInput = await req.json();
    if (!body.title || !body.date || !body.category) {
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
    
    const events = await getEvents();
    events.push(event);
    await saveEvents(events);
    
    return NextResponse.json({ event }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  // Bulk replace all events
  try {
    const body = await req.json();
    if (!Array.isArray(body.events)) {
      return NextResponse.json({ error: 'events array required' }, { status: 400 });
    }
    await saveEvents(body.events);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
