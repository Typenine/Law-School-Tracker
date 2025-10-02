import * as chrono from 'chrono-node';
import { endOfDay } from 'date-fns';
import { CourseMeetingBlock, NewCourseInput, NewTaskInput, Semester } from './types';

const KEYWORDS = [
  'read', 'reading', 'pages', 'chapter', 'ch.', 'section', '§',
  'assignment', 'submit', 'due', 'turn in', 'upload',
  'memo', 'brief', 'quiz', 'exam', 'outline', 'problem', 'problems', 'problem set', 'practice', 'discussion', 'paper', 'response paper', 'case',
  'cb', 'casebook', 'supp', 'supplement', 'ucc', 'frcp', 'restatement', 'statute', 'article', 'handout', 'notes'
];

const STOPWORDS = [
  'no class', 'holiday', 'break', 'spring break', 'fall break', 'reading day', 'reading period', 'cancelled', 'canceled'
];

function hasKeyword(line: string) {
  const l = line.toLowerCase();
  return KEYWORDS.some(k => l.includes(k));
}

function parseDaysToken(s: string): number[] | null {
  // Accept tokens like MWF, TR, TuTh, Mon/Wed, Monday & Wednesday
  const map: Record<string, number> = { su:0, sun:0, sunday:0, m:1, mon:1, monday:1, t:2, tu:2, tue:2, tues:2, tuesday:2, w:3, wed:3, wednesday:3, th:4, thu:4, thur:4, thurs:4, thursday:4, f:5, fri:5, friday:5, sa:6, sat:6, saturday:6 };
  const tokens: string[] = [];
  let t = s.toLowerCase().replace(/\./g, '');
  // Common compact forms
  t = t.replace(/tth/g, 't th'); // TTh => T Th
  t = t.replace(/mwf/g, 'm w f');
  t = t.replace(/mw/g, 'm w');
  t = t.replace(/tr/g, 't th');
  // Split by separators
  for (const part of t.split(/[^a-z]+/g).filter(Boolean)) tokens.push(part);
  const days: number[] = [];
  for (const tok of tokens) {
    const d = map[tok];
    if (typeof d === 'number' && !days.includes(d)) days.push(d);
  }
  return days.length ? days.sort((a,b)=>a-b) : null;
}

function parseTimeTo24HHMM(s: string): string | null {
  // Parse formats like 10, 10:30, 1pm, 1:15 pm, 13:00
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}

function parseSemesterYear(text: string): { semester: Semester | null; year: number | null } {
  const semRe = /(spring|summer|fall|winter)\s*(\d{4})/i;
  const m = semRe.exec(text);
  if (m) {
    const sem = (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as Semester;
    const yr = parseInt(m[2], 10);
    return { semester: sem, year: isNaN(yr) ? null : yr };
  }
  const yr = (/(\d{4})/).exec(text)?.[1];
  return { semester: null, year: yr ? parseInt(yr, 10) : null };
}

export function parseSyllabusToCourseMeta(text: string, fallbackTitle?: string | null): NewCourseInput | null {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const first = lines.slice(0, 40).join('\n');
  let title: string | undefined;
  let code: string | undefined;
  let instructor: string | undefined;
  let instructorEmail: string | undefined;
  let room: string | undefined;
  let location: string | undefined;
  let meetingDays: number[] | null = null;
  let meetingStart: string | null = null;
  let meetingEnd: string | null = null;
  const meetingBlocks: CourseMeetingBlock[] = [];
  let startDate: string | null = null;
  let endDate: string | null = null;
  let semester: Semester | null = null;
  let year: number | null = null;

  // Title/code
  const titleLine = lines.find(l => /^(course|class)\s*[:\-]/i.test(l)) || lines[0];
  if (titleLine) {
    const m = /^(?:course|class)\s*[:\-]\s*(.+)$/i.exec(titleLine);
    const val = m ? m[1] : titleLine;
    // Split code and title if like LAW-101 Torts
    const codeMatch = /(\b[A-Z]{2,}[-\s]?\d{2,}\b)/.exec(val);
    if (codeMatch) { code = codeMatch[1]; title = val.replace(codeMatch[1], '').trim(); }
    else title = val.trim();
  }
  if (!title && fallbackTitle) title = fallbackTitle;

  // Instructor and email
  for (const l of lines.slice(0, 80)) {
    if (/\b(instructor|professor|prof\.)\b/i.test(l) && !instructor) {
      instructor = l.replace(/^(instructor|professor|prof\.)\s*[:\-]\s*/i, '').trim();
    }
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(l)?.[0];
    if (email) instructorEmail = email;
    if (/\b(room|location|building|classroom)\b/i.test(l) && !room) {
      room = l.replace(/^(room|location|building|classroom)\s*[:\-]\s*/i, '').trim();
      location = room;
    }
    // Meeting days/times e.g. Mon/Wed 10:00-11:15 am, MWF 1:30–2:45 pm
    if ((/\b(mwf|mw|tr|tth|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i.test(l) || /\b(mon|tue|wed|thu|fri|sat|sun)\b/i.test(l)) && /\d/.test(l)) {
      const parts = l.split(/[,;]|\s{2,}/).map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        const dayMatch = parseDaysToken(p);
        const timeRange = p.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
        if (dayMatch && timeRange) {
          const s = parseTimeTo24HHMM(timeRange[1]);
          const e = parseTimeTo24HHMM(timeRange[2]);
          if (s && e) {
            const block: CourseMeetingBlock = { days: dayMatch, start: s, end: e, location: undefined };
            const exists = meetingBlocks.some(b => b.start === block.start && b.end === block.end && b.days.join(',') === block.days.join(','));
            if (!exists) meetingBlocks.push(block);
          }
        } else {
          if (dayMatch) meetingDays = dayMatch;
          if (timeRange) { meetingStart = parseTimeTo24HHMM(timeRange[1]); meetingEnd = parseTimeTo24HHMM(timeRange[2]); }
        }
      }
    }
    // Date range e.g., Aug 28 – Dec 6, 2025
    const dateRange = chrono.parse(l, new Date(), { forwardDate: true });
    if (dateRange.length >= 2) {
      const a = dateRange[0]; const b = dateRange[1];
      const s = a.end?.date ? a.end.date() : (a.start?.date ? a.start.date() : a.date());
      const e = b.end?.date ? b.end.date() : (b.start?.date ? b.start.date() : b.date());
      if (s && e) { startDate = endOfDay(s).toISOString(); endDate = endOfDay(e).toISOString(); }
    }
  }

  const sy = parseSemesterYear(first);
  semester = sy.semester; year = sy.year;
  // If we gathered blocks but not the single fields, seed from first block for backward compatibility
  if (meetingBlocks.length > 0) {
    if (!meetingDays) meetingDays = meetingBlocks[0].days.slice();
    if (!meetingStart) meetingStart = meetingBlocks[0].start;
    if (!meetingEnd) meetingEnd = meetingBlocks[0].end;
  }
  if (!title && !instructor && !meetingDays && !semester && !year) return null;
  const out: NewCourseInput = {
    code: code ?? null,
    title: title || (fallbackTitle || 'Course'),
    instructor: instructor ?? null,
    instructorEmail: instructorEmail ?? null,
    room: room ?? null,
    location: location ?? null,
    meetingDays: meetingDays ?? null,
    meetingStart: meetingStart ?? null,
    meetingEnd: meetingEnd ?? null,
    meetingBlocks: meetingBlocks.length ? meetingBlocks : null,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    semester: semester ?? null,
    year: year ?? null,
  };
  return out;
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
  let perPage = minutesPerPage;
  if (/\bskim\b/i.test(line)) perPage = Math.max(1, Math.round(minutesPerPage * 0.5));
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
  // Comma-separated single pages like "pp. 10, 12, xv"
  const listPages = /(pp?\.|pages?)\s*([0-9ivxlcdm\s,]+(?:\s*(?:and)\s*[0-9ivxlcdm\s,]+)*)/i.exec(line);
  if (listPages) {
    const cleaned = listPages[2].replace(/\band\b/gi, ',');
    const tokens = cleaned.split(',').map(s => s.trim()).filter(Boolean);
    let singles = 0;
    for (const tok of tokens) {
      if (/[-–—]/.test(tok)) continue; // ranges handled earlier
      if (/^\d{1,4}$/i.test(tok)) { singles += 1; continue; }
      const r = romanToInt(tok);
      if (r) singles += 1;
    }
    if (singles) totalPages += singles;
  }
  if (totalPages > 0) return Math.min(8 * 60, Math.max(10, totalPages * perPage));

  // Chapters heuristic: about 60 min per chapter
  const chRange = /\bch(?:apters?)?\.?\s*(\d{1,3})\s*[-–—]\s*(\d{1,3})\b/i.exec(line);
  if (chRange) {
    const a = parseInt(chRange[1], 10), b = parseInt(chRange[2], 10);
    if (!isNaN(a) && !isNaN(b) && b >= a) return Math.min(8 * 60, (b - a + 1) * 60);
  }
  const chSingle = /\bch(?:apter)?\.?\s*(\d{1,3})\b/i.exec(line);
  if (chSingle) return 60;

  if (l.includes('case brief') || (l.includes('brief') && l.includes('case'))) return 60;
  if (l.includes('brief')) return 45;
  if (l.includes('memo')) return 180;
  if (l.includes('outline')) return 90;
  if (l.includes('quiz')) return 30;
  if (l.includes('exam') || l.includes('midterm') || l.includes('final')) return 180;
  if (l.includes('paper')) return 180;
  if (l.includes('response paper')) return 120;
  if (l.includes('problem set') || /\bproblems?\b/.test(l)) return 60;
  if (l.includes('discussion')) return 30;
  if (l.includes('assignment')) return 90;
  if (l.includes('chapter') || l.includes('ch.')) return 60;
  if (/(\bucc\b|\bfrcp\b|restatement|statute|cb\b|casebook|supp\b|supplement)/i.test(line)) return 60; // treat as reading chunk
  if (l.includes('notes')) return 20;
  return null;
}

function cleanTitle(s: string): string {
  let t = s.trim();
  t = t.replace(/^(reading:|read:|due:|assignment:|homework:|submit:|pages?:)\s*/i, '');
  t = t.replace(/\b(on|via)\s+canvas\b/ig, '');
  t = t.replace(/\bby\s+(start\s+of\s+)?class\b/ig, '');
  // remove trailing pp/pages segments for brevity
  t = t.replace(/\bpp?\.\s*[^;,.]+/ig, '').replace(/\bpages?\s+[^;,.]+/ig, '');
  // collapse leftover punctuation/spaces
  t = t.replace(/\s{2,}/g, ' ').replace(/[;,:.-]\s*$/g, '').trim();
  return t || s.trim();
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

    // Simple table row parsing with inferred date column: Date | Content | ...
    if ((raw.includes('|') || /\t/.test(raw))) {
      const cells = raw.includes('|') ? raw.split('|').map(c => c.trim()) : raw.split(/\t+/).map(c => c.trim());
      if (cells.length >= 2) {
        let bestIdx = -1; let bestScore = 0; let bestParsed: chrono.ParsedResult | null = null;
        for (let ci = 0; ci < cells.length; ci++) {
          const c = cells[ci];
          const p = chrono.parse(c, new Date(), { forwardDate: true });
          if (!p.length) continue;
          const r = p[0];
          const score = (r.text.length / Math.max(1, c.length));
          if (score > bestScore) { bestScore = score; bestIdx = ci; bestParsed = r; }
        }
        if (bestIdx >= 0 && bestParsed) {
          const base = bestParsed.end?.date ? bestParsed.end.date() : (bestParsed.start?.date ? bestParsed.start.date() : bestParsed.date());
          const when = dateWithPossibleTime(raw, base, bestParsed);
          const content = cells.filter((_, i) => i !== bestIdx).join(' | ');
          const parts = splitIntoSubtasks(content);
          for (const p of parts) {
            if (hasKeyword(p)) {
              const title = cleanTitle(p);
              tasks.push({ title, course: course ?? null, dueDate: when.toISOString(), status: 'todo', estimatedMinutes: estimateMinutes(p, opts?.minutesPerPage ?? 3) });
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
      const isWeekOf = /^\s*week\s+of\b/i.test(line);
      if ((pctDate > 0.3 || isWeekOf) && !hasKeyword(line)) {
        currentDate = dateWithPossibleTime(line, base, parsed);
        continue;
      }
      // Otherwise, we'll use this date for the task itself
      currentDate = dateWithPossibleTime(line, base, parsed);
    }

    if (hasKeyword(line) && currentDate) {
      const subtasks = splitIntoSubtasks(line);
      for (const st of subtasks) {
        const title = cleanTitle(st);
        tasks.push({ title, course: course ?? null, dueDate: currentDate.toISOString(), status: 'todo', estimatedMinutes: estimateMinutes(st, opts?.minutesPerPage ?? 3) });
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
