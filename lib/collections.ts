import { ensureSchema, getSettings, mutateSetting } from '@/lib/storage';
import type { CalendarEvent, SemesterInfo } from '@/lib/types';

/**
 * Calendar events and semesters live in the settings store rather than in
 * their own tables. They used to be read and written by having the route
 * handler make an HTTP request back to /api/settings on its own deployment,
 * which meant every write depended on the deployment being publicly
 * reachable and every failure was swallowed - the API answered "created" or
 * "deleted" while nothing had actually changed, so the item reappeared on the
 * next load. These helpers talk to the storage layer directly and let errors
 * propagate so the route can report them.
 */

export const EVENTS_KEY = 'calendarEventsV1';
export const SEMESTERS_KEY = 'semestersV1';

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function readEvents(): Promise<CalendarEvent[]> {
  await ensureSchema();
  const settings = await getSettings([EVENTS_KEY]);
  return asArray<CalendarEvent>(settings?.[EVENTS_KEY]);
}

export async function mutateEvents<T>(
  mutator: (events: CalendarEvent[]) => { events: CalendarEvent[]; result: T },
): Promise<T> {
  await ensureSchema();
  return mutateSetting<T>(EVENTS_KEY, current => {
    const { events, result } = mutator(asArray<CalendarEvent>(current));
    return { value: events, result };
  });
}

export async function readSemesters(): Promise<SemesterInfo[]> {
  await ensureSchema();
  const settings = await getSettings([SEMESTERS_KEY]);
  return asArray<SemesterInfo>(settings?.[SEMESTERS_KEY]);
}

export async function mutateSemesters<T>(
  mutator: (semesters: SemesterInfo[]) => { semesters: SemesterInfo[]; result: T },
): Promise<T> {
  await ensureSchema();
  return mutateSetting<T>(SEMESTERS_KEY, current => {
    const { semesters, result } = mutator(asArray<SemesterInfo>(current));
    return { value: semesters, result };
  });
}

export async function activeSemesterId(): Promise<string | null> {
  try {
    const semesters = await readSemesters();
    return semesters.find(s => s.isActive)?.id || null;
  } catch {
    return null;
  }
}
