import * as chrono from 'chrono-node';
import { endOfDay } from 'date-fns';
import { NewTaskInput } from './types';

const KEYWORDS = [
  'read', 'reading', 'pages', 'chapter', 'ch.', 'section', '§',
  'assignment', 'submit', 'due', 'turn in', 'upload',
  'memo', 'brief', 'quiz', 'exam', 'outline', 'problem', 'practice', 'discussion', 'paper', 'case'
];

const STOPWORDS = [
  'no class', 'holiday', 'break', 'spring break', 'fall break', 'reading day', 'reading period', 'cancelled', 'canceled'
];

function hasKeyword(line: string) {
  const l = line.toLowerCase();
  return KEYWORDS.some(k => l.includes(k));
}

function isNonTaskLine(line: string) {
  const l = line.toLowerCase();
  return STOPWORDS.some(k => l.includes(k));
}

function romanToInt(s: string): number | null {
  const map: Record<string, number> = { i:1, v:5, x:10, l:50, c:100, d:500, m:1000 };
  const t = s.trim().toLowerCase();
  if (!/^[ivxlcdm]+$/i.test(t)) return null;
  let total = 0; let prev = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    const val = map[t[i]];
    if (!val) return null;
    if (val < prev) total -= val; else { total += val; prev = val; }
  }
  return total;
}

function estimateMinutes(line: string, minutesPerPage = 3): number | null {
  const l = line.toLowerCase();
  // Pages heuristic: 3 min per page for dense reading
  // Try explicit "pp."/"pages" or bare ranges, handle multiples and roman numerals
  let totalPages = 0;
  // Numeric ranges like "10-25", "pp. 10–25"
  const numRangeRe = /(\d{1,4})\s*[-–—]\s*(\d{1,4})/g;
  for (const m of line.matchAll(numRangeRe)) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (!isNaN(a) && !isNaN(b) && b >= a) totalPages += (b - a + 1);
  }
  // Letter-prefixed numeric ranges like "S10–S20" -> treat numbers
  const letterNumRangeRe = /[A-Za-z](\d{1,4})\s*[-–—]\s*[A-Za-z]?(\d{1,4})/g;
  for (const m of line.matchAll(letterNumRangeRe)) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (!isNaN(a) && !isNaN(b) && b >= a) totalPages += (b - a + 1);
  }
  // Roman ranges like "xiii–xvii"
  const romanRangeRe = /\b([ivxlcdm]+)\s*[-–—]\s*([ivxlcdm]+)\b/gi;
  for (const m of line.matchAll(romanRangeRe)) {
    const a = romanToInt(m[1]); const b = romanToInt(m[2]);
    if (a && b && b >= a) totalPages += (b - a + 1);
  }
  // Single page count like "read 25 pages"
  const singlePages = /\b(\d{1,3})\s+pages?\b/i.exec(line);
  if (singlePages) {
    const pages = parseInt(singlePages[1], 10);
    if (!isNaN(pages)) totalPages += pages;
  }
  // Comma-separated single pages like "pp. 10, 12, 15"
  const listPages = /(pp?\.|pages?)\s*([\d\s,]+(?:\s*(?:and)\s*[\d\s,]+)*)/i.exec(line);
  if (listPages) {
    const cleaned = listPages[2].replace(/\band\b/gi, ',');
    const nums = cleaned.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (nums.length) totalPages += nums.length;
  }
  if (totalPages > 0) return Math.min(8 * 60, Math.max(10, totalPages * minutesPerPage));

  if (l.includes('case brief') || (l.includes('brief') && l.includes('case'))) return 60;
  if (l.includes('brief')) return 45;
  if (l.includes('memo')) return 180;
  if (l.includes('outline')) return 90;
  if (l.includes('quiz')) return 30;
  if (l.includes('exam') || l.includes('midterm') || l.includes('final')) return 180;
  if (l.includes('paper')) return 180;
  if (l.includes('discussion')) return 30;
  if (l.includes('assignment')) return 90;
  if (l.includes('chapter') || l.includes('ch.')) return 60;
  return null;
}

function splitIntoSubtasks(line: string): string[] {
  // Split on semicolons or " • " bullets while keeping meaningful segments
  let parts = line.split(/;|•|\u2022/g).map(p => p.trim()).filter(Boolean);
  // If no semicolons/bullets, try splitting on ' and ' or '&' when both halves look like tasks
  if (parts.length <= 1) {
    const marker = /\b(and|&|\u0026)\b/i;
    const idx = line.toLowerCase().indexOf(' and ');
    const ampIdx = line.indexOf(' & ');
    const cut = idx >= 0 ? idx : (ampIdx >= 0 ? ampIdx : -1);
    if (cut > 0) {
      const left = line.slice(0, cut).trim();
      const right = line.slice(cut + (line.substr(cut, 5).toLowerCase() === ' and ' ? 5 : 3)).trim();
      const looksTask = (s: string) => hasKeyword(s) || /\bpp?\.|pages?\b/i.test(s) || /\d+\s*[-–—]\s*\d+/.test(s);
      if (left && right && looksTask(left) && looksTask(right)) parts = [left, right];
    }
  }
  if (parts.length <= 1) return [line];
  // Only keep parts that look like tasks (contain a keyword)
  const tasky = parts.filter(hasKeyword);
  return tasky.length ? tasky : [line];
}

function dateWithPossibleTime(_line: string, d: Date, _parsed: chrono.ParsedResult): Date {
  // Do not assign specific times; normalize to end-of-day
  return endOfDay(d);
}

function unwrapHyphenation(s: string): string {
  // Join hyphenated line breaks: "exam-
  // ple" => "example"
  return s.replace(/([A-Za-z])-[\r\n]+([a-z])/g, '$1$2');
}

export function parseSyllabusToTasks(text: string, course?: string | null, opts?: { minutesPerPage?: number }): NewTaskInput[] {
  const normalized = unwrapHyphenation(text);
  const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const tasks: NewTaskInput[] = [];
  let currentDate: Date | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/^[\-−•*\d)\s]+/, '').trim();
    if (!line) continue;
    if (isNonTaskLine(line)) continue;

    // Heading without date (e.g., "Week 3"), lookahead a few lines for a date
    if (/^week\s+\d+/i.test(line)) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const next = lines[j];
        const dp = chrono.parse(next, new Date(), { forwardDate: true });
        if (dp.length && !hasKeyword(next)) {
          const p = dp[0];
          const base = p.end?.date ? p.end.date() : (p.start?.date ? p.start.date() : p.date());
          currentDate = dateWithPossibleTime(next, base, p);
          break;
        }
        // Stop if next is clearly a new heading
        if (/^week\s+\d+/i.test(next)) break;
      }
      continue;
    }

    // Simple table row parsing: Date | Content | ...
    if ((raw.includes('|') || /\t/.test(raw))) {
      const cells = raw.includes('|') ? raw.split('|').map(c => c.trim()) : raw.split(/\t+/).map(c => c.trim());
      if (cells.length >= 2) {
        const dateGuess = chrono.parse(cells[0], new Date(), { forwardDate: true });
        if (dateGuess.length) {
          const d = dateGuess[0];
          const base = d.end?.date ? d.end.date() : (d.start?.date ? d.start.date() : d.date());
          const when = dateWithPossibleTime(raw, base, d);
          const content = cells.slice(1).join(' | ');
          const parts = splitIntoSubtasks(content);
          for (const p of parts) {
            if (hasKeyword(p)) {
              tasks.push({ title: p, course: course ?? null, dueDate: when.toISOString(), status: 'todo', estimatedMinutes: estimateMinutes(p, opts?.minutesPerPage ?? 3) });
            }
          }
          continue;
        }
      }
    }

    const dateParsed = chrono.parse(line, new Date(), { forwardDate: true });
    if (dateParsed.length) {
      const parsed = dateParsed[0];
      const base = parsed.end?.date ? parsed.end.date() : (parsed.start?.date ? parsed.start.date() : parsed.date());
      // If the line is mostly a date (like "Sep 12" or "Week 3 – Sep 12"), set context
      const dateText = dateParsed[0].text;
      const pctDate = dateText.length / line.length;
      if (pctDate > 0.3 && !hasKeyword(line)) {
        currentDate = dateWithPossibleTime(line, base, parsed);
        continue;
      }
      // Otherwise, we'll use this date for the task itself
      currentDate = dateWithPossibleTime(line, base, parsed);
    }

    if (hasKeyword(line) && currentDate) {
      const subtasks = splitIntoSubtasks(line);
      for (const st of subtasks) {
        tasks.push({ title: st, course: course ?? null, dueDate: currentDate.toISOString(), status: 'todo', estimatedMinutes: estimateMinutes(st, opts?.minutesPerPage ?? 3) });
      }
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
