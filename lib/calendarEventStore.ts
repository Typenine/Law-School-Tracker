import type { CalendarEvent, NewEventInput, UpdateEventInput } from './types';
import { getSettings, patchSettings } from './storage';

const EVENTS_KEY = 'calendarEventsV1';

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function listCalendarEvents(): Promise<CalendarEvent[]> {
  const settings = await getSettings([EVENTS_KEY]);
  const events = settings[EVENTS_KEY];
  return Array.isArray(events) ? events : [];
}

export async function replaceCalendarEvents(events: CalendarEvent[]) {
  await patchSettings({ [EVENTS_KEY]: events });
}

export async function createCalendarEvent(input: NewEventInput) {
  const event: CalendarEvent = {
    id: uid(),
    title: input.title,
    description: input.description ?? null,
    category: input.category,
    date: input.date,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    allDay: input.allDay ?? !input.startTime,
    recurring: input.recurring ?? false,
    recurrenceRule: input.recurrenceRule ?? null,
    recurrenceEndDate: input.recurrenceEndDate ?? null,
    location: input.location ?? null,
    color: input.color ?? null,
    course: input.course ?? null,
    createdAt: new Date().toISOString(),
  };
  const events = await listCalendarEvents();
  await replaceCalendarEvents([...events, event]);
  return event;
}

export async function updateCalendarEvent(id: string, patch: UpdateEventInput) {
  const events = await listCalendarEvents();
  const index = events.findIndex(event => event.id === id);
  if (index < 0) return null;
  const updated: CalendarEvent = { ...events[index], ...patch };
  events[index] = updated;
  await replaceCalendarEvents(events);
  return updated;
}

export async function deleteCalendarEvent(id: string) {
  const events = await listCalendarEvents();
  const next = events.filter(event => event.id !== id);
  if (next.length === events.length) return false;
  await replaceCalendarEvents(next);
  return true;
}

export async function renameCourseCalendarEvents(courseId: string, oldTitle: string, newTitle: string) {
  const events = await listCalendarEvents();
  let updated = 0;
  const next = events.map(event => {
    const description = String(event.description || '');
    const linkedById = description.includes(`[course-id:${courseId}]`);
    const linkedByLegacyTitle = !linkedById && (event.course || '').trim().toLowerCase() === oldTitle.trim().toLowerCase();
    if (!linkedById && !linkedByLegacyTitle) return event;
    updated++;
    return { ...event, course: newTitle };
  });
  if (updated) await replaceCalendarEvents(next);
  return updated;
}
