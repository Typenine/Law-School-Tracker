import * as chrono from 'chrono-node';
import type { NewCourseInput } from './types';
import { parseCourseMetaFromText } from './parser';
import type {
  ExtractedDocumentSections,
  Reading,
  ReadingPriority,
  Session,
  SourceType,
  TaskType,
  WizardCourse,
  WizardPreview,
  WizardTask,
} from './wizard_types';

export interface WizardOptions {
  timezone?: string;
  minutesPerPage?: number;
  referenceDate?: string;
}

type SourceLine = { text: string; source_ref: string };

const SCHEDULE_HEADING = /^(course\s+)?(schedule|calendar|reading schedule|class schedule|assignments schedule|tentative schedule)\b/i;
const SECTION_HEADING = /^(required|recommended)?\s*(materials?|texts?|books?|grading|evaluation|assessments?|office hours?|attendance|participation|academic integrity|accommodations?|polic(?:y|ies)|course policies|assignments?)\s*:?[\s]*$/i;
const READING_MARKERS = /\b(read|reading|casebook|textbook|supplement|supp\.|article|handout|statute|code|restatement|rules?|chapter|ch\.|pages?|pp?\.|problems?|problem set|§|case)\b/i;
const TASK_MARKERS = /\b(due|submit|submission|turn in|upload|memo|brief|quiz|exam|final|midterm|paper|presentation|problem set|assignment|draft|reflection|journal|response paper|oral argument|project)\b/i;
const POLICY_MARKERS = /\b(attendance|participation|grading|grade|policy|policies|integrity|plagiarism|accommodation|disability|recording|technology|late work|professionalism)\b/i;
const CANCEL_MARKERS = /\b(no class|class canceled|class cancelled|canceled|cancelled|holiday|break|reading day|reading period|make-up day)\b/i;
const CASE_CITATION = /\b[A-Z][A-Za-z.'’&-]+(?:\s+[A-Z][A-Za-z.'’&-]+)*\s+v\.\s+[A-Z][A-Za-z.'’&-]+/;

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeText(raw: string) {
  return raw
    .replace(/([A-Za-z])-[\r\n]+([a-z])/g, '$1$2')
    .replace(/\u00a0/g, ' ')
    .replace(/[‐‑‒–—]/g, '–')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function looksLikePageNoise(line: string) {
  return /^(page\s+)?\d+(\s+of\s+\d+)?$/i.test(line) || /^[-_=]{3,}$/.test(line);
}

function dateAtStart(line: string, reference: Date) {
  const results = chrono.parse(line, reference, { forwardDate: true });
  for (const result of results) {
    const index = result.index ?? line.toLowerCase().indexOf(result.text.toLowerCase());
    const hasDay = result.start.isCertain('day');
    const hasMonth = result.start.isCertain('month');
    if (hasDay && hasMonth && index <= 18) return result;
  }
  return null;
}

function isLikelyHeader(line: string) {
  return SCHEDULE_HEADING.test(line) || SECTION_HEADING.test(line) || /^[A-Z][A-Z\s/&-]{4,}$/.test(line);
}

function isBullet(line: string) {
  return /^(?:[-•*]|\d+[.)]|[a-z][.)])\s+/i.test(line);
}

function normalizeLines(rawText: string, reference: Date): SourceLine[] {
  const rawLines = normalizeText(rawText).split(/\r?\n/).map((text, index) => ({ text: text.replace(/\s+/g, ' ').trim(), source_ref: `line:${index}` })).filter(line => line.text);
  const counts = new Map<string, number>();
  for (const line of rawLines) {
    const key = line.text.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const filtered = rawLines.filter(line => !looksLikePageNoise(line.text) && !((counts.get(line.text.toLowerCase()) || 0) >= 3 && line.text.length < 100));
  const joined: SourceLine[] = [];
  for (const line of filtered) {
    const previous = joined[joined.length - 1];
    const canJoin = previous
      && previous.text.length < 220
      && line.text.length < 180
      && !/[.:;!?)]$/.test(previous.text)
      && !isBullet(line.text)
      && !isLikelyHeader(line.text)
      && !dateAtStart(line.text, reference)
      && !SCHEDULE_HEADING.test(previous.text)
      && !SECTION_HEADING.test(previous.text);
    if (canJoin && (READING_MARKERS.test(previous.text) || TASK_MARKERS.test(previous.text) || /^[a-z(]/.test(line.text))) {
      previous.text = `${previous.text} ${line.text}`.replace(/\s+/g, ' ').trim();
      previous.source_ref = `${previous.source_ref},${line.source_ref}`;
    } else {
      joined.push({ ...line });
    }
  }
  return joined;
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function semesterReference(meta: NewCourseInput | null, opts?: WizardOptions) {
  if (opts?.referenceDate) return new Date(`${opts.referenceDate}T12:00:00`);
  if (meta?.startDate) return new Date(meta.startDate);
  const year = meta?.year || new Date().getFullYear();
  const month = meta?.semester === 'Spring' ? 0 : meta?.semester === 'Summer' ? 4 : meta?.semester === 'Fall' ? 7 : 0;
  return new Date(year, month, 1, 12, 0, 0);
}

function extractPages(line: string) {
  const matches = line.match(/(?:pp?\.?|pages?)\s*[A-Za-z]?\d+[A-Za-z]?(?:\s*[–-]\s*[A-Za-z]?\d+[A-Za-z]?)?(?:\s*,\s*[A-Za-z]?\d+(?:\s*[–-]\s*[A-Za-z]?\d+)?)?|\bch(?:apter)?s?\.?\s*\d+(?:\s*[–-]\s*\d+)?|§{1,2}\s*[\w.()-]+(?:\s*[–-]\s*[\w.()-]+)?/gi);
  return matches?.join('; ') || null;
}

function pageCount(line: string) {
  let count = 0;
  for (const match of line.matchAll(/(?:[A-Za-z])?(\d{1,4})\s*[–-]\s*(?:[A-Za-z])?(\d{1,4})/g)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (end >= start && end - start < 500) count += end - start + 1;
  }
  const explicit = line.match(/\b(\d{1,3})\s+pages?\b/i);
  if (!count && explicit) count = Number(explicit[1]);
  return count || null;
}

function readingPriority(line: string): ReadingPriority {
  if (/\b(optional|recommended|supplemental)\b/i.test(line)) return 'optional';
  if (/\b(skim|skim only|browse)\b/i.test(line)) return 'skim';
  return 'required';
}

function sourceType(line: string): SourceType {
  if (/\b(statute|code|rule|restatement|§)\b/i.test(line)) return 'statute';
  if (/\b(article|journal|essay|handout)\b/i.test(line)) return 'article';
  if (CASE_CITATION.test(line) || /\bcase\b/i.test(line)) return 'case';
  if (/\bproblem(s| set)?\b/i.test(line)) return 'problem';
  if (/\b(casebook|textbook|chapter|pp?\.|pages?)\b/i.test(line)) return 'casebook';
  return 'other';
}

function taskType(line: string): TaskType {
  if (/\b(final|midterm|exam)\b/i.test(line)) return 'exam';
  if (/\bmemo\b/i.test(line)) return 'memo';
  if (/\bbrief\b/i.test(line)) return 'brief';
  if (/\bquiz\b/i.test(line)) return 'quiz';
  if (/\bpresentation|oral argument\b/i.test(line)) return 'presentation';
  if (/\bpaper|essay|response paper|reflection|journal\b/i.test(line)) return 'paper';
  if (/\bproblem set|problems?\b/i.test(line)) return 'problem_set';
  if (/\b(read|reading)\b/i.test(line)) return 'reading';
  if (/\bsubmit|upload|turn in|registration|form\b/i.test(line)) return 'admin';
  return 'other';
}

function parseTime(line: string, fallback: string) {
  const explicit = line.match(/\b(?:by|at|before)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (/\b(11:59\s*p\.?m\.?|end of day|eod|midnight)\b/i.test(line)) return '23:59';
  if (!explicit) return fallback;
  let hour = Number(explicit[1]);
  const minute = Number(explicit[2] || 0);
  const meridiem = explicit[3].toLowerCase();
  if (meridiem.startsWith('p') && hour < 12) hour += 12;
  if (meridiem.startsWith('a') && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseDate(line: string, reference: Date) {
  const results = chrono.parse(line, reference, { forwardDate: true });
  return results.find(result => result.start.isCertain('day') && result.start.isCertain('month')) || null;
}

function makeReading(line: SourceLine, minutesPerPage: number): Reading {
  const pages = extractPages(line.text);
  const count = pageCount(line.text);
  const priority = readingPriority(line.text);
  const multiplier = priority === 'skim' ? 0.5 : 1;
  return {
    source_type: sourceType(line.text),
    short_title: line.text.replace(/^[-•*\d.)\s]+/, '').replace(/^(read(?:ing)?|prepare)\s*:?\s*/i, '').slice(0, 220),
    pages,
    priority,
    estimated_minutes: count ? Math.max(10, Math.round(count * minutesPerPage * multiplier)) : null,
    source_text: line.text,
    source_ref: line.source_ref,
    confidence: clamp(0.68 + (pages ? 0.15 : 0) + (READING_MARKERS.test(line.text) ? 0.1 : 0) + (CASE_CITATION.test(line.text) ? 0.07 : 0)),
  };
}

function makeTask(line: SourceLine, sessionDate: string, reference: Date, classTime: string, minutesPerPage: number): WizardTask {
  const parsed = parseDate(line.text, reference);
  const dueDate = parsed ? localDate(parsed.start.date()) : sessionDate;
  const time = parseTime(line.text, /start of class|class time/i.test(line.text) ? classTime : '23:59');
  const count = pageCount(line.text);
  const type = taskType(line.text);
  const defaultMinutes: Record<TaskType, number | null> = { reading: count ? count * minutesPerPage : 60, brief: 90, memo: 240, quiz: 60, exam: 180, paper: 300, presentation: 180, problem_set: 120, admin: 20, other: 60 };
  return {
    type,
    title: line.text.replace(/^[-•*\d.)\s]+/, '').slice(0, 240),
    due_datetime: `${dueDate}T${time}:00`,
    estimated_minutes: defaultMinutes[type] ? Math.round(defaultMinutes[type] as number) : null,
    blocking: /\b(required|must|mandatory|prerequisite)\b/i.test(line.text),
    source_ref: line.source_ref,
    source_text: line.text,
    status: 'planned',
    confidence: clamp(0.7 + (parsed ? 0.15 : 0) + (/\bdue\b|\bsubmit\b|\bexam\b/i.test(line.text) ? 0.1 : 0)),
  };
}

function dedupe<T extends { source_text?: string; source_ref?: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = (item.source_text || item.source_ref || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractSections(lines: SourceLine[]): ExtractedDocumentSections {
  const sections: ExtractedDocumentSections = { required_materials: [], grading_components: [], office_hours: [], major_assessments: [], policies: [], holidays_and_breaks: [] };
  let mode: keyof ExtractedDocumentSections | null = null;
  for (const line of lines) {
    const lower = line.text.toLowerCase();
    if (/^(required|recommended)?\s*(materials?|texts?|books?)\b/.test(lower)) mode = 'required_materials';
    else if (/^(grading|evaluation|assessment)/.test(lower)) mode = 'grading_components';
    else if (/^office hours?/.test(lower)) mode = 'office_hours';
    else if (/^(attendance|participation|academic integrity|accommodations?|polic)/.test(lower)) mode = 'policies';
    else if (isLikelyHeader(line.text)) mode = null;

    if (/\b(final|midterm|exam|memo|paper|presentation|major assignment)\b/i.test(line.text) && (TASK_MARKERS.test(line.text) || /\d{1,2}[\/-]\d{1,2}/.test(line.text))) sections.major_assessments.push(line.text);
    if (CANCEL_MARKERS.test(line.text)) sections.holidays_and_breaks.push(line.text);
    if (mode && line.text.length > 3 && !SECTION_HEADING.test(line.text)) sections[mode].push(line.text);
    if (!mode && POLICY_MARKERS.test(line.text) && line.text.length < 300) sections.policies.push(line.text);
    if (/office hours?/i.test(line.text)) sections.office_hours.push(line.text);
  }
  for (const key of Object.keys(sections) as Array<keyof ExtractedDocumentSections>) sections[key] = Array.from(new Set(sections[key])).slice(0, 40);
  return sections;
}

export function buildWizardPreview(rawText: string, courseHint?: string | null, opts?: WizardOptions): WizardPreview {
  const timezone = opts?.timezone || 'America/Chicago';
  const minutesPerPage = opts?.minutesPerPage || 3;
  const meta = (() => { try { return parseCourseMetaFromText(rawText, courseHint); } catch { return null; } })();
  const reference = semesterReference(meta, opts);
  const lines = normalizeLines(rawText, reference);
  const course: WizardCourse | null = meta ? {
    code: meta.code ?? null,
    title: meta.title ?? courseHint ?? null,
    section: rawText.match(/\bsection\s*[:#-]?\s*([A-Za-z0-9-]+)/i)?.[1] || null,
    professor: meta.instructor ?? null,
    professor_email: meta.instructorEmail ?? rawText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] || null,
    office_hours: lines.find(line => /office hours?/i.test(line.text))?.text || null,
    location: meta.location ?? meta.room ?? null,
    meeting_days: meta.meetingBlocks?.[0]?.days || meta.meetingDays || null,
    meeting_time: meta.meetingBlocks?.[0]?.start || meta.meetingStart || null,
    meeting_end_time: meta.meetingBlocks?.[0]?.end || meta.meetingEnd || null,
    timezone,
    start_date: meta.startDate?.slice(0, 10) || null,
    end_date: meta.endDate?.slice(0, 10) || null,
  } : null;

  const sessions: Session[] = [];
  const unassignedImportantLines: WizardPreview['unassignedImportantLines'] = [];
  let current: Session | null = null;
  let inSchedule = false;
  let sequence = 1;

  for (const line of lines) {
    if (SCHEDULE_HEADING.test(line.text)) { inSchedule = true; continue; }
    if (inSchedule && SECTION_HEADING.test(line.text) && !SCHEDULE_HEADING.test(line.text)) { inSchedule = false; current = null; }
    const headingDate = dateAtStart(line.text, reference);
    const explicitTask = TASK_MARKERS.test(line.text);
    const explicitReading = READING_MARKERS.test(line.text) || CASE_CITATION.test(line.text) || Boolean(extractPages(line.text));

    if (headingDate && (inSchedule || headingDate.index <= 8 || explicitTask || explicitReading || CANCEL_MARKERS.test(line.text))) {
      const date = localDate(headingDate.start.date());
      current = {
        date,
        sequence_number: sequence++,
        topic: null,
        readings: [],
        assignments_due: [],
        notes: null,
        canceled: CANCEL_MARKERS.test(line.text),
        source_ref: line.source_ref,
        source_text: line.text,
        confidence: inSchedule ? 0.94 : 0.84,
      };
      const remainder = line.text.slice((headingDate.index || 0) + headingDate.text.length).replace(/^\s*[-:|]\s*/, '').trim();
      sessions.push(current);
      if (remainder) {
        const remainderLine = { text: remainder, source_ref: line.source_ref };
        if (TASK_MARKERS.test(remainder)) current.assignments_due.push(makeTask(remainderLine, date, reference, course?.meeting_time || '09:00', minutesPerPage));
        else if (READING_MARKERS.test(remainder) || CASE_CITATION.test(remainder) || extractPages(remainder)) current.readings.push(makeReading(remainderLine, minutesPerPage));
        else if (!CANCEL_MARKERS.test(remainder)) current.topic = remainder.slice(0, 240);
      }
      continue;
    }

    if (current && current.canceled) {
      current.notes = [current.notes, line.text].filter(Boolean).join(' ').slice(0, 500);
      continue;
    }

    if (explicitTask) {
      const parsedDate = parseDate(line.text, reference);
      if (!current && parsedDate) {
        current = { date: localDate(parsedDate.start.date()), sequence_number: sequence++, topic: 'Deadline', readings: [], assignments_due: [], notes: null, canceled: false, source_ref: line.source_ref, source_text: line.text, confidence: 0.76 };
        sessions.push(current);
      }
      if (current) current.assignments_due.push(makeTask(line, current.date, reference, course?.meeting_time || '09:00', minutesPerPage));
      else unassignedImportantLines.push({ text: line.text, source_ref: line.source_ref, reason: 'Assignment or assessment found without a reliable date.' });
      continue;
    }

    if (explicitReading) {
      if (current) current.readings.push(makeReading(line, minutesPerPage));
      else if (inSchedule || isBullet(line.text)) unassignedImportantLines.push({ text: line.text, source_ref: line.source_ref, reason: 'Reading found without a reliable class date.' });
      continue;
    }

    if (current && !current.topic && !POLICY_MARKERS.test(line.text) && line.text.length < 260) {
      current.topic = line.text.replace(/^topic\s*[:–-]\s*/i, '').trim();
      continue;
    }
    if (inSchedule && current && line.text.length < 300) current.notes = [current.notes, line.text].filter(Boolean).join(' ').slice(0, 600);
  }

  for (const session of sessions) {
    session.readings = dedupe(session.readings);
    session.assignments_due = dedupe(session.assignments_due);
  }
  const cleanedSessions = sessions.filter((session, index, all) => index === all.findIndex(other => other.date === session.date && other.source_text === session.source_text));
  const readings = cleanedSessions.flatMap(session => session.readings);
  const tasks = cleanedSessions.flatMap(session => session.assignments_due);
  const lowConfidence: WizardPreview['lowConfidence'] = [];
  if (!course?.meeting_days?.length || !course.meeting_time) lowConfidence.push({ kind: 'course', confidence: 0.5, reason: 'Meeting days or class time could not be confirmed.' });
  if (!course?.start_date || !course?.end_date) lowConfidence.push({ kind: 'course', confidence: 0.55, reason: 'Semester start or end date could not be confirmed.' });
  for (const session of cleanedSessions) if ((session.confidence || 0) < 0.8) lowConfidence.push({ kind: 'session', ref: session.source_ref, confidence: session.confidence || 0.7, reason: 'Date found outside a clearly labeled schedule.' });
  for (const reading of readings) if ((reading.confidence || 0) < 0.8) lowConfidence.push({ kind: 'reading', ref: reading.source_ref, confidence: reading.confidence || 0.7 });
  for (const task of tasks) if ((task.confidence || 0) < 0.8) lowConfidence.push({ kind: 'task', ref: task.source_ref, confidence: task.confidence || 0.7 });
  if (unassignedImportantLines.length) lowConfidence.push({ kind: 'document', confidence: 0.55, reason: `${unassignedImportantLines.length} important line(s) need manual assignment.` });

  const sourceLines = normalizeText(rawText).split(/\r?\n/).filter(line => line.trim()).length;
  const likelyScannedDocument = rawText.trim().length < 250 || (sourceLines < 10 && rawText.trim().length < 1200);
  if (likelyScannedDocument) lowConfidence.push({ kind: 'document', confidence: 0.2, reason: 'Very little selectable text was extracted. This may be a scanned or image-only document.' });

  return {
    course,
    sessions: cleanedSessions,
    readings,
    tasks,
    sections: extractSections(lines),
    unassignedImportantLines,
    diagnostics: {
      sourceCharacters: rawText.length,
      sourceLines,
      normalizedLines: lines.length,
      sessions: cleanedSessions.length,
      readings: readings.length,
      tasks: tasks.length,
      canceledSessions: cleanedSessions.filter(session => session.canceled).length,
      dateCoverage: lines.length ? cleanedSessions.length / lines.length : 0,
      likelyScannedDocument,
    },
    lowConfidence,
  };
}
