
import type { Course, NewTaskInput, StudySession, Task } from './types';
import {
  countPages,
  extractPageRangesFromTitle,
  formatPageRanges,
  parsePageRanges,
  type PageRange,
} from './pageRanges';

export type ReadingMetrics = {
  originalPageRanges: string | null;
  remainingPageRanges: string | null;
  assignedPages: number;
  completedPages: number;
  remainingPages: number;
  percentComplete: number;
  loggedMinutes: number;
  estimatedMinutesRemaining: number;
  paceMinutesPerPage: number;
  paceSource: 'override' | 'learned' | 'default';
};

export function canonicalPageRanges(value?: string | null): string | null {
  if (!value) return null;
  const ranges = parsePageRanges(value);
  return ranges.length ? formatPageRanges(ranges) : null;
}

export function taskOriginalRanges(task: Pick<Task, 'originalPageRanges' | 'remainingPageRanges' | 'title'>): string | null {
  return canonicalPageRanges(task.originalPageRanges)
    || canonicalPageRanges(extractPageRangesFromTitle(task.title))
    || canonicalPageRanges(task.remainingPageRanges)
    || null;
}

export function taskRemainingRanges(task: Pick<Task, 'originalPageRanges' | 'remainingPageRanges' | 'title' | 'status'>): string | null {
  if (task.status === 'done') return null;
  return canonicalPageRanges(task.remainingPageRanges)
    || taskOriginalRanges(task)
    || null;
}

export function courseReadingPace(courseName: string | null | undefined, courses: Course[]): { mpp: number; source: ReadingMetrics['paceSource'] } {
  const key = (courseName || '').trim().toLowerCase();
  const course = courses.find(c => (c.title || '').trim().toLowerCase() === key || (c.code || '').trim().toLowerCase() === key);
  if (course?.overrideEnabled && typeof course.overrideMpp === 'number' && course.overrideMpp > 0) {
    return { mpp: Math.max(0.5, Math.min(6, course.overrideMpp)), source: 'override' };
  }
  if (typeof course?.learnedMpp === 'number' && course.learnedMpp > 0) {
    return { mpp: Math.max(0.5, Math.min(6, course.learnedMpp)), source: 'learned' };
  }
  return { mpp: 3, source: 'default' };
}

export function readingMetrics(task: Task, sessions: StudySession[], courses: Course[]): ReadingMetrics {
  const originalPageRanges = taskOriginalRanges(task);
  const remainingPageRanges = taskRemainingRanges(task);
  const originalCount = originalPageRanges ? countPages(parsePageRanges(originalPageRanges)) : Math.max(0, Number(task.pagesRead) || 0);
  const remainingCount = task.status === 'done'
    ? 0
    : remainingPageRanges
      ? countPages(parsePageRanges(remainingPageRanges))
      : originalCount;
  const assignedPages = Math.max(originalCount, remainingCount);
  const remainingPages = Math.min(assignedPages || remainingCount, remainingCount);
  const completedPages = Math.max(0, assignedPages - remainingPages);
  const percentComplete = assignedPages > 0 ? Math.max(0, Math.min(100, Math.round((completedPages / assignedPages) * 100))) : (task.status === 'done' ? 100 : 0);
  const loggedMinutes = sessions
    .filter(session => String(session.taskId || '') === String(task.id))
    .reduce((sum, session) => sum + Math.max(0, Number(session.minutes) || 0), 0);
  const pace = courseReadingPace(task.course, courses);
  const estimatedMinutesRemaining = task.status === 'done'
    ? 0
    : remainingPages > 0
      ? Math.max(0, Math.round(remainingPages * pace.mpp))
      : Math.max(0, Number(task.estimatedMinutes) || 0);
  return {
    originalPageRanges,
    remainingPageRanges,
    assignedPages,
    completedPages,
    remainingPages,
    percentComplete,
    loggedMinutes,
    estimatedMinutesRemaining,
    paceMinutesPerPage: Math.round(pace.mpp * 100) / 100,
    paceSource: pace.source,
  };
}

export function normalizeReadingTaskInput(input: NewTaskInput, courses: Course[]): NewTaskInput {
  const exactCourse = courses.find(c => {
    const key = (input.course || '').trim().toLowerCase();
    return key && ((c.title || '').trim().toLowerCase() === key || (c.code || '').trim().toLowerCase() === key);
  });
  const inferredRanges = canonicalPageRanges(input.originalPageRanges)
    || canonicalPageRanges(input.remainingPageRanges)
    || canonicalPageRanges(extractPageRangesFromTitle(input.title));
  const activity = input.activity || (inferredRanges ? 'reading' : null);
  const reading = activity === 'reading';
  const pageCount = reading && inferredRanges ? countPages(parsePageRanges(inferredRanges)) : input.pagesRead ?? null;
  return {
    ...input,
    courseId: input.courseId || exactCourse?.id || null,
    activity,
    pagesRead: pageCount,
    originalPageRanges: reading ? (canonicalPageRanges(input.originalPageRanges) || inferredRanges) : input.originalPageRanges ?? null,
    remainingPageRanges: reading ? (canonicalPageRanges(input.remainingPageRanges) || inferredRanges) : input.remainingPageRanges ?? null,
  };
}

export function splitRangesByCounts(ranges: PageRange[], requestedCounts: number[]): string[] {
  const pages: number[] = [];
  for (const range of ranges) for (let page = range.start; page <= range.end; page++) pages.push(page);
  const chunks: string[] = [];
  let cursor = 0;
  for (const requested of requestedCounts) {
    if (cursor >= pages.length) break;
    const size = Math.max(1, Math.min(Math.floor(requested), pages.length - cursor));
    const part = pages.slice(cursor, cursor + size);
    cursor += size;
    const grouped: PageRange[] = [];
    for (const page of part) {
      const last = grouped[grouped.length - 1];
      if (last && page === last.end + 1) last.end = page;
      else grouped.push({ start: page, end: page });
    }
    chunks.push(formatPageRanges(grouped));
  }
  if (cursor < pages.length) {
    const part = pages.slice(cursor);
    const grouped: PageRange[] = [];
    for (const page of part) {
      const last = grouped[grouped.length - 1];
      if (last && page === last.end + 1) last.end = page;
      else grouped.push({ start: page, end: page });
    }
    if (chunks.length) chunks[chunks.length - 1] = [chunks[chunks.length - 1], formatPageRanges(grouped)].filter(Boolean).join(', ');
    else chunks.push(formatPageRanges(grouped));
  }
  return chunks;
}
