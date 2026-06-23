import * as chrono from 'chrono-node';
import { parseCourseMetaFromText } from './parser';
import type { NewCourseInput } from './types';
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

type Line = { text: string; source_ref: string };

const SCHEDULE = /^(course\s+)?(schedule|calendar|reading schedule|class schedule|tentative schedule)\b/i;
const HEADER = /^(required|recommended)?\s*(materials?|texts?|books?|grading|evaluation|assessments?|office hours?|attendance|participation|academic integrity|accommodations?|polic(?:y|ies)|course policies|assignments?)\s*:?[\s]*$/i;
const READING = /\b(read|reading|casebook|textbook|supplement|article|handout|statute|code|restatement|rule|chapter|ch\.|pages?|pp?\.|problems?|§|case)\b/i;
const TASK = /\b(due|submit|submission|turn in|upload|memo|brief|quiz|exam|final|midterm|paper|presentation|problem set|assignment|draft|reflection|journal|response paper|oral argument|project)\b/i;
const POLICY = /\b(attendance|participation|grading|grade|policy|policies|integrity|plagiarism|accommodation|disability|recording|technology|late work|professionalism)\b/i;
const CANCELED = /\b(no class|class canceled|class cancelled|canceled|cancelled|holiday|break|reading day|reading period|make-up day)\b/i;
const CASE_NAME = /\b[A-Z][A-Za-z.'&-]+(?:\s+[A-Z][A-Za-z.'&-]+)*\s+v\.\s+[A-Z][A-Za-z.'&-]+/;

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function isHeading(text: string) { return SCHEDULE.test(text) || HEADER.test(text) || /^[A-Z][A-Z\s/&-]{4,}$/.test(text); }
function isBullet(text: string) { return /^(?:[-•*]|\d+[.)]|[a-z][.)])\s+/i.test(text); }

function referenceDate(meta: NewCourseInput | null, options?: WizardOptions) {
  if (options?.referenceDate) return new Date(`${options.referenceDate}T12:00:00`);
  if (meta?.startDate) return new Date(meta.startDate);
  const year = meta?.year || new Date().getFullYear();
  const month = meta?.semester === 'Spring' ? 0 : meta?.semester === 'Summer' ? 4 : meta?.semester === 'Fall' ? 7 : 0;
  return new Date(year, month, 1, 12, 0, 0);
}

function parsedDate(text: string, reference: Date) {
  return chrono.parse(text, reference, { forwardDate: true }).find(result => result.start.isCertain('day') && result.start.isCertain('month')) || null;
}

function dateAtStart(text: string, reference: Date) {
  const result = parsedDate(text, reference);
  if (!result) return null;
  const index = result.index ?? text.toLowerCase().indexOf(result.text.toLowerCase());
  return index <= 6 ? result : null;
}

function normalize(raw: string, reference: Date): Line[] {
  const source = raw
    .replace(/([A-Za-z])-[\r\n]+([a-z])/g, '$1$2')
    .replace(/\u00a0/g, ' ')
    .replace(/[‐‑‒—]/g, '–')
    .split(/\r?\n/)
    .map((text, index) => ({ text: text.replace(/\s+/g, ' ').trim(), source_ref: `line:${index}` }))
    .filter(line => line.text && !/^(page\s+)?\d+(\s+of\s+\d+)?$/i.test(line.text));

  const counts = new Map<string, number>();
  for (const line of source) counts.set(line.text.toLowerCase(), (counts.get(line.text.toLowerCase()) || 0) + 1);
  const filtered = source.filter(line => !((counts.get(line.text.toLowerCase()) || 0) >= 3 && line.text.length < 100));
  const result: Line[] = [];
  for (const line of filtered) {
    const previous = result[result.length - 1];
    const obviousContinuation = /[–-]$/.test(previous?.text || '') || /^[a-z(§]/.test(line.text) || /^(and|or|through|to|including)\b/i.test(line.text);
    const join = previous
      && !isHeading(line.text)
      && !isBullet(line.text)
      && !dateAtStart(line.text, reference)
      && obviousContinuation
      && (/[–-]$/.test(previous.text) || READING.test(previous.text) || TASK.test(previous.text));
    if (join) {
      previous.text = /[–-]$/.test(previous.text) ? `${previous.text}${line.text}` : `${previous.text} ${line.text}`;
      previous.source_ref += `,${line.source_ref}`;
    } else result.push({ ...line });
  }
  return result;
}

function pages(text: string) {
  return text.match(/(?:pp?\.?|pages?)\s*[A-Za-z]?\d+[A-Za-z]?(?:\s*[–-]\s*[A-Za-z]?\d+[A-Za-z]?)?(?:\s*,\s*[A-Za-z]?\d+(?:\s*[–-]\s*[A-Za-z]?\d+)?)?|\bch(?:apter)?s?\.?\s*\d+(?:\s*[–-]\s*\d+)?|§{1,2}\s*[\w.()-]+(?:\s*[–-]\s*[\w.()-]+)?/gi)?.join('; ') || null;
}

function pageCount(text: string) {
  let total = 0;
  for (const match of text.matchAll(/(?:[A-Za-z])?(\d{1,4})\s*[–-]\s*(?:[A-Za-z])?(\d{1,4})/g)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (end >= start && end - start < 500) total += end - start + 1;
  }
  const explicit = text.match(/\b(\d{1,3})\s+pages?\b/i);
  return total || (explicit ? Number(explicit[1]) : null);
}

function priority(text: string): ReadingPriority {
  if (/\b(optional|recommended|supplemental)\b/i.test(text)) return 'optional';
  if (/\b(skim|browse)\b/i.test(text)) return 'skim';
  return 'required';
}

function readingType(text: string): SourceType {
  if (/\b(statute|code|rule|restatement|§)\b/i.test(text)) return 'statute';
  if (/\b(article|journal|essay|handout)\b/i.test(text)) return 'article';
  if (CASE_NAME.test(text) || /\bcase\b/i.test(text)) return 'case';
  if (/\bproblem(s| set)?\b/i.test(text)) return 'problem';
  if (/\b(casebook|textbook|chapter|pp?\.|pages?)\b/i.test(text)) return 'casebook';
  return 'other';
}

function assignmentType(text: string): TaskType {
  if (/\b(final|midterm|exam)\b/i.test(text)) return 'exam';
  if (/\bmemo\b/i.test(text)) return 'memo';
  if (/\bbrief\b/i.test(text)) return 'brief';
  if (/\bquiz\b/i.test(text)) return 'quiz';
  if (/\bpresentation|oral argument\b/i.test(text)) return 'presentation';
  if (/\bpaper|essay|reflection|journal\b/i.test(text)) return 'paper';
  if (/\bproblem set|problems?\b/i.test(text)) return 'problem_set';
  if (/\bread(ing)?\b/i.test(text)) return 'reading';
  if (/\bsubmit|upload|turn in|registration|form\b/i.test(text)) return 'admin';
  return 'other';
}

function timeTo24(hourText: string, minuteText: string | undefined, meridiemText: string | undefined) {
  let hour = Number(hourText);
  const minute = Number(minuteText || 0);
  const meridiem = (meridiemText || '').toLowerCase();
  if (meridiem.startsWith('p') && hour < 12) hour += 12;
  if (meridiem.startsWith('a') && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function dueTime(text: string, fallback: string) {
  if (/\b(11:59\s*p\.?m\.?|end of day|eod|midnight)\b/i.test(text)) return '23:59';
  const match = text.match(/\b(?:by|at|before)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  return match ? timeTo24(match[1], match[2], match[3]) : fallback;
}

function detectMeeting(rawText: string) {
  const line = rawText.split(/\r?\n/).map(value => value.trim()).find(value => /^(class|meets?|meeting(?:\s+time)?)\s*:/i.test(value));
  if (!line) return { days: null as number[] | null, start: null as string | null, end: null as string | null, location: null as string | null };
  const dayMap: Array<[RegExp, number]> = [[/\bsun(day)?s?\b/i, 0], [/\bmon(day)?s?\b/i, 1], [/\btue(sday)?s?\b/i, 2], [/\bwed(nesday)?s?\b/i, 3], [/\bthu(r|rs|rsday|ursday)?s?\b/i, 4], [/\bfri(day)?s?\b/i, 5], [/\bsat(urday)?s?\b/i, 6]];
  const days = dayMap.filter(([pattern]) => pattern.test(line)).map(([, day]) => day);
  const range = line.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
  let start: string | null = null;
  let end: string | null = null;
  if (range) {
    const sharedMeridiem = range[6] || range[3];
    start = timeTo24(range[1], range[2], range[3] || sharedMeridiem);
    end = timeTo24(range[4], range[5], range[6] || sharedMeridiem);
  }
  const location = line.match(/(?:room|rm\.?|location)\s*[:#-]?\s*([^,;]+)/i)?.[1]?.trim() || null;
  return { days: days.length ? days : null, start, end, location };
}

function makeReading(line: Line, minutesPerPage: number): Reading {
  const pageText = pages(line.text);
  const count = pageCount(line.text);
  const readingPriority = priority(line.text);
  return {
    source_type: readingType(line.text),
    short_title: line.text.replace(/^[-•*\d.)\s]+/, '').replace(/^(read(?:ing)?|prepare)\s*:?\s*/i, '').slice(0, 220),
    pages: pageText,
    priority: readingPriority,
    estimated_minutes: count ? Math.max(10, Math.round(count * minutesPerPage * (readingPriority === 'skim' ? 0.5 : 1))) : null,
    source_text: line.text,
    source_ref: line.source_ref,
    confidence: clamp(0.68 + (pageText ? 0.15 : 0) + (READING.test(line.text) ? 0.1 : 0) + (CASE_NAME.test(line.text) ? 0.07 : 0)),
  };
}

function makeTask(line: Line, sessionDate: string, reference: Date, classTime: string, minutesPerPage: number): WizardTask {
  const dateResult = parsedDate(line.text, reference);
  const date = dateResult ? dateKey(dateResult.start.date()) : sessionDate;
  const type = assignmentType(line.text);
  const count = pageCount(line.text);
  const defaults: Record<TaskType, number> = { reading: count ? count * minutesPerPage : 60, brief: 90, memo: 240, quiz: 60, exam: 180, paper: 300, presentation: 180, problem_set: 120, admin: 20, other: 60 };
  return {
    type,
    title: line.text.replace(/^[-•*\d.)\s]+/, '').slice(0, 240),
    due_datetime: `${date}T${dueTime(line.text, /start of class|class time/i.test(line.text) ? classTime : '23:59')}:00`,
    estimated_minutes: Math.round(defaults[type]),
    blocking: /\b(required|must|mandatory|prerequisite)\b/i.test(line.text),
    source_ref: line.source_ref,
    source_text: line.text,
    status: 'planned',
    confidence: clamp(0.7 + (dateResult ? 0.15 : 0) + (/\bdue\b|\bsubmit\b|\bexam\b/i.test(line.text) ? 0.1 : 0)),
  };
}

function extractSections(lines: Line[]): ExtractedDocumentSections {
  const result: ExtractedDocumentSections = { required_materials: [], grading_components: [], office_hours: [], major_assessments: [], policies: [], holidays_and_breaks: [] };
  let mode: keyof ExtractedDocumentSections | null = null;
  for (const line of lines) {
    const lower = line.text.toLowerCase();
    if (/^(required|recommended)?\s*(materials?|texts?|books?)\b/.test(lower)) mode = 'required_materials';
    else if (/^(grading|evaluation|assessment)/.test(lower)) mode = 'grading_components';
    else if (/^office hours?/.test(lower)) mode = 'office_hours';
    else if (HEADER.test(line.text) && /^(attendance|participation|academic integrity|accommodations?|polic)/.test(lower)) mode = 'policies';
    else if (isHeading(line.text)) mode = null;
    if (/\b(final|midterm|exam|memo|paper|presentation|major assignment)\b/i.test(line.text) && TASK.test(line.text)) result.major_assessments.push(line.text);
    if (CANCELED.test(line.text)) result.holidays_and_breaks.push(line.text);
    if (mode && !HEADER.test(line.text) && line.text.length > 3) result[mode].push(line.text);
    if (/office hours?/i.test(line.text)) result.office_hours.push(line.text);
    if (!mode && POLICY.test(line.text) && line.text.length < 300) result.policies.push(line.text);
  }
  for (const key of Object.keys(result) as Array<keyof ExtractedDocumentSections>) result[key] = Array.from(new Set(result[key])).slice(0, 40);
  return result;
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

export function buildWizardPreview(rawText: string, courseHint?: string | null, options?: WizardOptions): WizardPreview {
  const timezone = options?.timezone || 'America/Chicago';
  const minutesPerPage = options?.minutesPerPage || 3;
  const meta = (() => { try { return parseCourseMetaFromText(rawText, courseHint); } catch { return null; } })();
  const reference = referenceDate(meta, options);
  const lines = normalize(rawText, reference);
  const meeting = detectMeeting(rawText);
  const email = rawText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] || null;
  const course: WizardCourse | null = meta ? {
    code: meta.code || rawText.match(/\b[A-Z]{2,}[-\s]?\d{2,4}[A-Z]?\b/)?.[0] || null,
    title: courseHint || meta.title || null,
    section: rawText.match(/\bsection\s*[:#-]?\s*([A-Za-z0-9-]+)/i)?.[1] || null,
    professor: meta.instructor || rawText.match(/(?:professor|instructor)\s*:\s*([^\n]+)/i)?.[1]?.trim() || null,
    professor_email: meta.instructorEmail || email,
    office_hours: lines.find(line => /office hours?/i.test(line.text))?.text || null,
    location: meeting.location || meta.location || meta.room || null,
    meeting_days: meeting.days || meta.meetingBlocks?.[0]?.days || meta.meetingDays || null,
    meeting_time: meeting.start || meta.meetingBlocks?.[0]?.start || meta.meetingStart || null,
    meeting_end_time: meeting.end || meta.meetingBlocks?.[0]?.end || meta.meetingEnd || null,
    timezone,
    start_date: meta.startDate?.slice(0, 10) || null,
    end_date: meta.endDate?.slice(0, 10) || null,
  } : null;

  const sessions: Session[] = [];
  const unassigned: NonNullable<WizardPreview['unassignedImportantLines']> = [];
  let current: Session | null = null;
  let inSchedule = false;
  let sequence = 1;

  for (const line of lines) {
    if (SCHEDULE.test(line.text)) { inSchedule = true; continue; }
    if (inSchedule && HEADER.test(line.text) && !SCHEDULE.test(line.text)) { inSchedule = false; current = null; }
    const startDate = dateAtStart(line.text, reference);
    const readingLike = READING.test(line.text) || CASE_NAME.test(line.text) || Boolean(pages(line.text));
    const taskLike = TASK.test(line.text);

    if (startDate && (inSchedule || readingLike || CANCELED.test(line.text)) && !taskLike) {
      const sessionDate = dateKey(startDate.start.date());
      current = { date: sessionDate, sequence_number: sequence++, topic: null, readings: [], assignments_due: [], notes: null, canceled: CANCELED.test(line.text), source_ref: line.source_ref, source_text: line.text, confidence: inSchedule ? 0.94 : 0.84 };
      sessions.push(current);
      const remainder = line.text.slice((startDate.index || 0) + startDate.text.length).replace(/^\s*[-:|]\s*/, '').trim();
      if (remainder) {
        const rest = { text: remainder, source_ref: line.source_ref };
        if (TASK.test(remainder)) current.assignments_due.push(makeTask(rest, sessionDate, reference, course?.meeting_time || '09:00', minutesPerPage));
        else if (READING.test(remainder) || CASE_NAME.test(remainder) || pages(remainder)) current.readings.push(makeReading(rest, minutesPerPage));
        else if (!CANCELED.test(remainder)) current.topic = remainder.slice(0, 240);
      }
      continue;
    }

    if (current?.canceled) {
      current.notes = [current.notes, line.text].filter(Boolean).join(' ').slice(0, 500);
      continue;
    }

    if (taskLike) {
      const explicit = parsedDate(line.text, reference);
      if (!current && explicit) {
        current = { date: dateKey(explicit.start.date()), sequence_number: sequence++, topic: 'Deadline', readings: [], assignments_due: [], notes: null, canceled: false, source_ref: line.source_ref, source_text: line.text, confidence: 0.76 };
        sessions.push(current);
      }
      if (current) current.assignments_due.push(makeTask(line, current.date, reference, course?.meeting_time || '09:00', minutesPerPage));
      else unassigned.push({ text: line.text, source_ref: line.source_ref, reason: 'Assignment or assessment found without a reliable date.' });
      continue;
    }

    if (readingLike) {
      if (current) current.readings.push(makeReading(line, minutesPerPage));
      else if (inSchedule || isBullet(line.text)) unassigned.push({ text: line.text, source_ref: line.source_ref, reason: 'Reading found without a reliable class date.' });
      continue;
    }

    if (current && !current.topic && !POLICY.test(line.text) && line.text.length < 260) current.topic = line.text.replace(/^topic\s*[:–-]\s*/i, '');
    else if (inSchedule && current && line.text.length < 300) current.notes = [current.notes, line.text].filter(Boolean).join(' ').slice(0, 600);
  }

  for (const session of sessions) {
    session.readings = dedupe(session.readings);
    session.assignments_due = dedupe(session.assignments_due);
  }
  const readings = sessions.flatMap(session => session.readings);
  const tasks = sessions.flatMap(session => session.assignments_due);
  const lowConfidence: WizardPreview['lowConfidence'] = [];
  if (!course?.meeting_days?.length || !course.meeting_time) lowConfidence.push({ kind: 'course', confidence: 0.5, reason: 'Meeting days or class time could not be confirmed.' });
  if (!course?.start_date || !course?.end_date) lowConfidence.push({ kind: 'course', confidence: 0.55, reason: 'Semester start or end date could not be confirmed.' });
  for (const session of sessions) if ((session.confidence || 0) < 0.8) lowConfidence.push({ kind: 'session', ref: session.source_ref, confidence: session.confidence || 0.7 });
  for (const reading of readings) if ((reading.confidence || 0) < 0.8) lowConfidence.push({ kind: 'reading', ref: reading.source_ref, confidence: reading.confidence || 0.7 });
  for (const task of tasks) if ((task.confidence || 0) < 0.8) lowConfidence.push({ kind: 'task', ref: task.source_ref, confidence: task.confidence || 0.7 });
  if (unassigned.length) lowConfidence.push({ kind: 'document', confidence: 0.55, reason: `${unassigned.length} important line(s) need manual assignment.` });

  const sourceLines = rawText.split(/\r?\n/).filter(line => line.trim()).length;
  const scanned = rawText.trim().length < 250 || (sourceLines < 10 && rawText.trim().length < 1200);
  if (scanned) lowConfidence.push({ kind: 'document', confidence: 0.2, reason: 'Very little selectable text was extracted. This may be a scanned document.' });

  return {
    course,
    sessions,
    readings,
    tasks,
    sections: extractSections(lines),
    unassignedImportantLines: unassigned,
    diagnostics: { sourceCharacters: rawText.length, sourceLines, normalizedLines: lines.length, sessions: sessions.length, readings: readings.length, tasks: tasks.length, canceledSessions: sessions.filter(session => session.canceled).length, dateCoverage: lines.length ? sessions.length / lines.length : 0, likelyScannedDocument: scanned },
    lowConfidence,
  };
}
