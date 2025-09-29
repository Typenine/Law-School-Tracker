import * as chrono from 'chrono-node';
import { endOfDay } from 'date-fns';
import { NewTaskInput } from './types';

const KEYWORDS = [
  'read', 'reading', 'pages', 'assignment', 'memo', 'brief', 'quiz', 'exam', 'outline', 'problem', 'practice', 'discussion', 'paper', 'case'
];

function hasKeyword(line: string) {
  const l = line.toLowerCase();
  return KEYWORDS.some(k => l.includes(k));
}

function estimateMinutes(line: string, minutesPerPage = 3): number | null {
  const l = line.toLowerCase();
  // Pages heuristic: 3 min per page for dense reading
  // Try explicit "pp." or "pages"
  const pageRegexes = [
    /p(?:p\.|ages?)\s*(\d+)\s*[-–—]\s*(\d+)/i,
    /(\d+)\s*[-–—]\s*(\d+)\s*p(?:p\.|ages?)?/i,
  ];
  for (const re of pageRegexes) {
    const m = re.exec(line);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (!isNaN(a) && !isNaN(b) && b >= a) {
        const pages = b - a + 1;
        return Math.min(8 * 60, Math.max(10, pages * minutesPerPage));
      }
    }
  }
  // Single page count like "read 25 pages"
  const singlePages = /read\s+(\d{1,3})\s+pages?/i.exec(line);
  if (singlePages) {
    const pages = parseInt(singlePages[1], 10);
    if (!isNaN(pages)) return Math.min(8 * 60, Math.max(10, pages * minutesPerPage));
  }

  if (l.includes('case brief') || (l.includes('brief') && l.includes('case'))) return 60;
  if (l.includes('brief')) return 45;
  if (l.includes('memo')) return 180;
  if (l.includes('outline')) return 90;
  if (l.includes('quiz')) return 30;
  if (l.includes('exam') || l.includes('midterm') || l.includes('final')) return 180;
  if (l.includes('paper')) return 180;
  if (l.includes('discussion')) return 30;
  if (l.includes('assignment')) return 90;
  return null;
}

export function parseSyllabusToTasks(text: string, course?: string | null, opts?: { minutesPerPage?: number }): NewTaskInput[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const tasks: NewTaskInput[] = [];
  let currentDate: Date | null = null;

  for (const raw of lines) {
    const line = raw.replace(/^[\-−•*\d)\s]+/, '').trim();
    if (!line) continue;

    const dateParsed = chrono.parse(line, new Date(), { forwardDate: true });
    if (dateParsed.length) {
      const d = dateParsed[0].date();
      // If the line is mostly a date (like "Sep 12" or "Week 3 – Sep 12"), set context
      const dateText = dateParsed[0].text;
      const pctDate = dateText.length / line.length;
      if (pctDate > 0.3 && !hasKeyword(line)) {
        currentDate = endOfDay(d);
        continue;
      }
      // Otherwise, we'll use this date for the task itself
      currentDate = endOfDay(d);
    }

    if (hasKeyword(line) && currentDate) {
      tasks.push({ title: line, course: course ?? null, dueDate: currentDate.toISOString(), status: 'todo', estimatedMinutes: estimateMinutes(line, opts?.minutesPerPage ?? 3) });
    }
  }

  // Fallback: if nothing found, attempt to create a single task with closest date in text
  if (tasks.length === 0) {
    const firstDate = chrono.parse(text, new Date(), { forwardDate: true })[0]?.date();
    if (firstDate) {
      tasks.push({ title: 'Syllabus item', course: course ?? null, dueDate: endOfDay(firstDate).toISOString(), status: 'todo', estimatedMinutes: null });
    }
  }

  return tasks;
}
