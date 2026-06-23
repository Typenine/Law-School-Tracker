import type { Course, CourseMeetingBlock, Task } from './types';

export const COURSE_WORKSPACES_KEY = 'courseWorkspacesV1';

export interface CourseWorkspace {
  courseFolderUrl?: string;
  syllabusUrl?: string;
  notesUrl?: string;
  outlineUrl?: string;
  assignmentsUrl?: string;
  examDate?: string;
  examFormat?: string;
  outlineProgress?: number;
  lastClassCaptureAt?: string;
  lastClassTopic?: string;
  lastClassQuestion?: string;
  preparedDates?: string[];
}

export type CourseWorkspaceMap = Record<string, CourseWorkspace>;

export function safeUrl(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function courseTermMatches(course: Course, season?: string | null, year?: number | null): boolean {
  if (!season || !year) return true;
  return course.semester === season && course.year === year;
}

export function courseBlocks(course: Course): CourseMeetingBlock[] {
  if (Array.isArray(course.meetingBlocks) && course.meetingBlocks.length) return course.meetingBlocks;
  if (Array.isArray(course.meetingDays) && course.meetingDays.length && course.meetingStart && course.meetingEnd) {
    return [{
      days: course.meetingDays,
      start: course.meetingStart,
      end: course.meetingEnd,
      location: course.room || course.location || null,
    }];
  }
  return [];
}

export function nextClassOccurrence(course: Course, from = new Date()): { start: Date; end: Date; location?: string | null } | null {
  const blocks = courseBlocks(course);
  if (!blocks.length) return null;

  const startBoundary = course.startDate ? new Date(course.startDate) : null;
  const endBoundary = course.endDate ? new Date(course.endDate) : null;
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);

  for (let offset = 0; offset <= 21; offset++) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + offset);
    for (const block of blocks) {
      if (!block.days.includes(day.getDay())) continue;
      const [startHour, startMinute] = String(block.start || '').split(':').map(Number);
      const [endHour, endMinute] = String(block.end || '').split(':').map(Number);
      if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) continue;

      const start = new Date(day);
      start.setHours(startHour, startMinute, 0, 0);
      const end = new Date(day);
      end.setHours(endHour, endMinute, 0, 0);

      if (startBoundary && start < startBoundary) continue;
      if (endBoundary && start > endBoundary) continue;
      if (end < from) continue;
      return { start, end, location: block.location || course.room || course.location || null };
    }
  }
  return null;
}

export function courseTasks(tasks: Task[], courseTitle: string, currentTerm?: string | null): Task[] {
  const target = courseTitle.trim().toLowerCase();
  return tasks.filter((task) => {
    if ((task.course || '').trim().toLowerCase() !== target) return false;
    if (currentTerm && task.term && task.term !== currentTerm) return false;
    return true;
  });
}

export function nextOpenTask(tasks: Task[], courseTitle: string, currentTerm?: string | null): Task | null {
  return courseTasks(tasks, courseTitle, currentTerm)
    .filter((task) => task.status !== 'done')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0] || null;
}

export function examDaysRemaining(examDate?: string | null, from = new Date()): number | null {
  if (!examDate) return null;
  const exam = new Date(`${examDate}T12:00:00`);
  if (Number.isNaN(exam.getTime())) return null;
  const today = new Date(from);
  today.setHours(12, 0, 0, 0);
  return Math.ceil((exam.getTime() - today.getTime()) / 86400000);
}

export function taskKind(task: Task): 'reading' | 'outline' | 'practice' | 'assignment' | 'other' {
  const activity = (task.activity || '').toLowerCase();
  const title = (task.title || '').toLowerCase();
  if (activity === 'reading' || /\b(read|pages?|pp\.|chapter|casebook)\b/.test(title)) return 'reading';
  if (activity === 'outline' || /outline/.test(title)) return 'outline';
  if (activity === 'practice' || /(practice|hypo|essay|multiple choice|quiz)/.test(title)) return 'practice';
  if (/(memo|brief|paper|draft|submit|assignment|exam)/.test(title)) return 'assignment';
  return 'other';
}

export function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
