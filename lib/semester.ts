import type { Semester, SemesterInfo } from '@/lib/types';

/**
 * Working out which semester it currently is.
 *
 * Nothing in the app used to know this: the sidebar said "Fall 2026 · Week 3"
 * because that string was typed into the layout, and courses from previous
 * years stayed on screen forever. The term is now derived from the calendar
 * and from whatever semesters have been set up, and it rolls over on its own
 * when one ends.
 *
 * These helpers are pure so both the server and the browser can use them.
 */

export type SemesterPhase =
  /** Today falls inside the semester. */
  | 'in-session'
  /** The semester has been set up but has not started yet. */
  | 'upcoming'
  /** Nothing is running and nothing is scheduled next. */
  | 'between';

export type ResolvedTerm = {
  /** Stable id: the configured semester's id, or a derived "fall-2026". */
  id: string;
  name: string;
  season: Semester;
  year: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  phase: SemesterPhase;
  /** 1-based teaching week, only meaningful while in session. */
  weekNumber: number | null;
  /** Total weeks between start and end. */
  totalWeeks: number;
  /** Days until the term starts, when it has not started yet. */
  daysUntilStart: number | null;
  /** Days until the term ends, while in session. */
  daysUntilEnd: number | null;
  /** True when this came from the calendar rather than a configured semester. */
  derived: boolean;
};

const DAY_MS = 86_400_000;

export function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Midday avoids daylight-saving edges when doing whole-day arithmetic. */
export function atNoon(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(n => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

function daysBetween(from: string, to: string): number {
  return Math.round((atNoon(to).getTime() - atNoon(from).getTime()) / DAY_MS);
}

type SeasonWindow = { season: Semester; startMonth: number; startDay: number; endMonth: number; endDay: number };

/**
 * Typical US law school teaching terms, used only when the user has not set up
 * semesters themselves. Summer is deliberately not a term here: for most
 * students the months between Spring and Fall are a gap, so the app should say
 * "Fall 2026 starts in two weeks" rather than claim a summer term is running
 * and count weeks into it. Anyone actually taking summer classes can add a
 * Summer semester, which takes precedence over this.
 */
const TEACHING_WINDOWS: SeasonWindow[] = [
  { season: 'Spring', startMonth: 1, startDay: 8, endMonth: 5, endDay: 15 },
  { season: 'Fall', startMonth: 8, startDay: 15, endMonth: 12, endDay: 20 },
];

const pad = (n: number) => String(n).padStart(2, '0');

type TermBase = Omit<ResolvedTerm, 'phase' | 'weekNumber' | 'daysUntilStart' | 'daysUntilEnd' | 'totalWeeks'>;

function windowToTerm(window: SeasonWindow, year: number): TermBase {
  return {
    id: `${window.season.toLowerCase()}-${year}`,
    name: `${window.season} ${year}`,
    season: window.season,
    year,
    startDate: `${year}-${pad(window.startMonth)}-${pad(window.startDay)}`,
    endDate: `${year}-${pad(window.endMonth)}-${pad(window.endDay)}`,
    derived: true,
  };
}

/**
 * The teaching term covering today, or the next one to begin.
 * Returns the phase alongside it so callers do not have to re-derive it.
 */
export function deriveTermForDate(today: Date): { base: TermBase; phase: SemesterPhase } {
  const year = today.getFullYear();
  const key = (today.getMonth() + 1) * 100 + today.getDate();

  const running = TEACHING_WINDOWS.find(w =>
    key >= w.startMonth * 100 + w.startDay && key <= w.endMonth * 100 + w.endDay,
  );
  if (running) return { base: windowToTerm(running, year), phase: 'in-session' };

  // In a gap. Point at whichever term starts next.
  const next = TEACHING_WINDOWS.find(w => key < w.startMonth * 100 + w.startDay);
  if (next) return { base: windowToTerm(next, year), phase: 'upcoming' };
  // Past the last window of the year, so the next one is in January.
  return { base: windowToTerm(TEACHING_WINDOWS[0], year + 1), phase: 'upcoming' };
}

function describe(
  base: TermBase,
  todayYmd: string,
  phase: SemesterPhase,
): ResolvedTerm {
  const spanDays = Math.max(1, daysBetween(base.startDate, base.endDate));
  const totalWeeks = Math.max(1, Math.ceil(spanDays / 7));
  const elapsed = daysBetween(base.startDate, todayYmd);
  return {
    ...base,
    phase,
    totalWeeks,
    weekNumber: phase === 'in-session' ? Math.max(1, Math.floor(elapsed / 7) + 1) : null,
    daysUntilStart: phase === 'upcoming' ? Math.max(0, daysBetween(todayYmd, base.startDate)) : null,
    daysUntilEnd: phase === 'in-session' ? Math.max(0, daysBetween(todayYmd, base.endDate)) : null,
  };
}

function toBase(semester: SemesterInfo): TermBase {
  return {
    id: semester.id,
    name: semester.name,
    season: semester.season as Semester,
    year: semester.year,
    startDate: semester.startDate.slice(0, 10),
    endDate: semester.endDate.slice(0, 10),
    derived: false,
  };
}

function usable(semester: SemesterInfo): boolean {
  return Boolean(
    semester
    && typeof semester.startDate === 'string'
    && typeof semester.endDate === 'string'
    && /^\d{4}-\d{2}-\d{2}/.test(semester.startDate)
    && /^\d{4}-\d{2}-\d{2}/.test(semester.endDate),
  );
}

/**
 * Pick the term that is current *now*, from the configured semesters.
 *
 * The one that contains today wins. Otherwise the next one to start wins, so
 * the app can say "Fall 2026 starts in three weeks" during the summer break.
 * `isActive` is never trusted for this - it is a stored flag that goes stale
 * the moment a semester ends, which is exactly what made the app keep showing
 * last year's courses.
 */
export function resolveTerm(semesters: SemesterInfo[], now: Date = new Date()): ResolvedTerm {
  const todayYmd = ymd(now);
  const valid = (semesters || []).filter(usable);

  const current = valid
    .filter(s => s.startDate.slice(0, 10) <= todayYmd && s.endDate.slice(0, 10) >= todayYmd)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (current) return describe(toBase(current), todayYmd, 'in-session');

  const upcoming = valid
    .filter(s => s.startDate.slice(0, 10) > todayYmd)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (upcoming) return describe(toBase(upcoming), todayYmd, 'upcoming');

  // Nothing configured covers today. Fall back to the academic calendar.
  const { base, phase } = deriveTermForDate(now);
  return describe(base, todayYmd, phase);
}

/** Short label for the sidebar: honest about whether the term has started. */
export function termLabel(term: ResolvedTerm): string {
  if (term.phase === 'in-session' && term.weekNumber) {
    return `${term.name} · Week ${term.weekNumber}`;
  }
  if (term.phase === 'upcoming') {
    const days = term.daysUntilStart ?? 0;
    if (days === 0) return `${term.name} · starts today`;
    if (days === 1) return `${term.name} · starts tomorrow`;
    if (days < 14) return `${term.name} · starts in ${days} days`;
    const weeks = Math.round(days / 7);
    return `${term.name} · starts in ${weeks} weeks`;
  }
  return `${term.name} · between semesters`;
}

/** Does a course belong to the given term? */
export function courseInTerm(
  course: { semester?: string | null; year?: number | null },
  term: { season: string; year: number },
): boolean {
  if (!course.semester || !course.year) return false;
  return course.semester === term.season && course.year === term.year;
}

/** True when a course belongs to a term that has already finished. */
export function coursePastTerm(
  course: { semester?: string | null; year?: number | null },
  term: { season: string; year: number },
): boolean {
  if (!course.year) return false;
  if (course.year < term.year) return true;
  if (course.year > term.year) return false;
  const order: Record<string, number> = { Spring: 0, Summer: 1, Fall: 2, Winter: 3 };
  const courseRank = order[course.semester || ''] ?? -1;
  const termRank = order[term.season] ?? -1;
  return courseRank >= 0 && termRank >= 0 && courseRank < termRank;
}
