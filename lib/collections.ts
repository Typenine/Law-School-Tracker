import { ensureSchema, getSettings, mutateSetting } from '@/lib/storage';
import type { CalendarEvent, SemesterInfo } from '@/lib/types';
import { resolveTerm, type ResolvedTerm } from '@/lib/semester';

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

/**
 * Canonical current-semester resolver used by every server surface.
 *
 * The date resolver is authoritative. `isActive` remains as a compatibility
 * field for older UI, but it is synchronized to the resolved term instead of
 * being allowed to decide what the current term is.
 */
export async function resolveCurrentSemesterState(): Promise<{ term: ResolvedTerm; semesters: SemesterInfo[] }> {
  const semesters = await readSemesters();
  const term = resolveTerm(semesters);
  const activeId = term.derived ? null : term.id;
  const stale = semesters.some(semester => Boolean(semester.isActive) !== (semester.id === activeId));

  if (!stale) return { term, semesters };

  const updated = semesters.map(semester => ({
    ...semester,
    isActive: activeId ? semester.id === activeId : false,
  }));
  await mutateSemesters(() => ({ semesters: updated, result: null }));
  return { term, semesters: updated };
}

export async function currentSemesterId(): Promise<string | null> {
  try {
    const { term } = await resolveCurrentSemesterState();
    return term.id || null;
  } catch {
    return null;
  }
}

/** @deprecated Use currentSemesterId(). Kept so older imports do not break. */
export async function activeSemesterId(): Promise<string | null> {
  return currentSemesterId();
}
