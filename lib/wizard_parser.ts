import * as chrono from 'chrono-node';
import { endOfDay } from 'date-fns';
import type { WizardCourse, WizardPreview, Session, Reading, WizardTask, ReadingPriority, TaskType } from './wizard_types';
import type { NewCourseInput } from './types';
import { parseSyllabusToCourseMeta } from './parser';

function unwrapHyphenation(s: string): string {
  return s.replace(/([A-Za-z])-[\r\n]+([a-z])/g, '$1$2');
}

function pagesOrSections(line: string): string | null {
  const m = /(pp?\.)\s*[^;,.]+|\bpages?\s*[^;,.]+|\bch(?:apter)?\.?\s*\d+(?:\s*[-–—]\s*\d+)?|§+\s*[^;,.]+/i.exec(line);
  return m ? m[0] : null;
}

function detectReadingPriority(line: string): ReadingPriority {
  const l = line.toLowerCase();
  if (/\bskim\b/.test(l)) return 'skim';
  if (/\boptional\b/.test(l)) return 'optional';
  return 'required';
}

function classifyTask(line: string): TaskType {
  const l = line.toLowerCase();
  if (l.includes('brief') && l.includes('case')) return 'brief';
  if (l.includes('memo')) return 'memo';
  if (l.includes('quiz')) return 'quiz';
  if (l.includes('exam') || l.includes('midterm') || l.includes('final')) return 'exam';
  if (/(submit|due|turn in|upload)/i.test(line)) return 'admin';
  return 'reading';
}

function isBullet(line: string) { return /^\s*(?:[-–—•*]|\d+[).])\s+/.test(line); }

function confidence(base: number, ...mods: number[]): number {
  let c = base;
  for (const m of mods) c += m;
  return Math.max(0, Math.min(1, c));
}

export interface WizardOptions {
  timezone?: string; // e.g., America/Chicago
  minutesPerPage?: number; // for estimates
}

export function buildWizardPreview(rawText: string, courseHint?: string | null, opts?: WizardOptions): WizardPreview {
  const timezone = opts?.timezone || 'America/Chicago';
  const text = unwrapHyphenation(rawText);
  const lines = text.split(/\r?\n/);

  // Stage 1: meta
  const metaParsed = (() => { try { return parseSyllabusToCourseMeta(text, courseHint); } catch { return null as NewCourseInput | null; } })();
  const course: WizardCourse | null = metaParsed ? {
    code: metaParsed.code ?? null,
    title: metaParsed.title ?? null,
    section: null,
    professor: metaParsed.instructor ?? null,
    meeting_days: (metaParsed.meetingBlocks && metaParsed.meetingBlocks[0]?.days) || metaParsed.meetingDays || null,
    meeting_time: (metaParsed.meetingBlocks && metaParsed.meetingBlocks[0]?.start) || metaParsed.meetingStart || null,
    timezone,
    start_date: metaParsed.startDate ? metaParsed.startDate.slice(0,10) : null,
    end_date: metaParsed.endDate ? metaParsed.endDate.slice(0,10) : null,
  } : null;

  // Stage 2–3: naive alignment of sessions and extraction
  const sessions: Session[] = [];
  let currentSession: Session | null = null;
  let seq = 1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    // Date heading or table date cell triggers a new session
    const ps = chrono.parse(line, new Date(), { forwardDate: true });
    const looksDate = ps.length > 0 && (ps[0].text.length / Math.max(1, line.length)) > 0.3;
    if (looksDate) {
      const d = ps[0].end ? ps[0].end.date() : (ps[0].start ? ps[0].start.date() : ps[0].date());
      const dateISO = endOfDay(d).toISOString();
      currentSession = { date: dateISO.slice(0,10), sequence_number: seq++, topic: null, readings: [], assignments_due: [], notes: null, canceled: /no class|cancell?ed/i.test(line), source_ref: `line:${i}`, confidence: confidence(0.9) };
      sessions.push(currentSession);
      continue;
    }

    if (!currentSession) continue;

    // Topic capture (first non-empty non-reading/assignment line)
    if (!currentSession.topic && !/(read|pp\.|pages?|chapter|ch\.|due|submit|upload|turn in|quiz|exam|memo|brief)/i.test(line)) {
      currentSession.topic = line.replace(/^topic\s*[:\-]\s*/i, '').slice(0, 180);
      continue;
    }

    // Readings
    const pg = pagesOrSections(line);
    if (/(read|reading|casebook|supp|article|\bpp?\.|chapter|ch\.|§)/i.test(line) && (pg || isBullet(line))) {
      const r: Reading = {
        source_type: (/case\b/i.test(line) ? 'case' : /statute/i.test(line) ? 'statute' : /article|journal/i.test(line) ? 'article' : 'casebook'),
        short_title: line.replace(/^(read(ing)?:?)\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').slice(0, 120) || null,
        pages: pg,
        priority: detectReadingPriority(line),
        source_ref: `line:${i}`,
        confidence: confidence(0.8, pg ? 0.1 : 0, isBullet(line) ? 0.05 : 0),
      };
      currentSession.readings.push(r);
      continue;
    }

    // Deliverables / tasks
    if (/(due|submit|turn in|upload|brief|memo|quiz|exam|final|midterm)/i.test(line)) {
      const type = classifyTask(line);
      // Due time rules: prefer start of class vs explicit 11:59
      const startTime = course?.meeting_time || '09:00';
      const startOfClass = /start of class|at class|by class time/i.test(line);
      const by1159 = /11:59\s*(?:pm)?/i.test(line) || /by end of day|by eod/i.test(line);
      const dtLocal = `${currentSession.date}T${startOfClass ? startTime : (by1159 ? '23:59' : startTime)}:00`;
      const t: WizardTask = {
        type,
        title: line.slice(0, 160),
        due_datetime: dtLocal,
        estimated_minutes: null,
        blocking: /must|required|block/i.test(line),
        source_ref: `line:${i}`,
        status: 'planned',
        confidence: confidence(0.75, startOfClass || by1159 ? 0.1 : 0),
      };
      currentSession.assignments_due.push(t);
      continue;
    }
  }

  // Flatten
  const allReadings: Reading[] = sessions.flatMap(s => s.readings);
  const allTasks: WizardTask[] = sessions.flatMap(s => s.assignments_due);

  // Low-confidence list
  const low: WizardPreview['lowConfidence'] = [];
  if (!course?.meeting_days || !course?.meeting_time) low.push({ kind: 'course', confidence: 0.5, reason: 'Missing meeting days/time' });
  for (const s of sessions) if ((s.confidence ?? 1) < 0.8) low.push({ kind: 'session', ref: s.source_ref, confidence: s.confidence ?? 0.7 });
  for (const r of allReadings) if ((r.confidence ?? 1) < 0.8) low.push({ kind: 'reading', ref: r.source_ref, confidence: r.confidence ?? 0.7 });
  for (const t of allTasks) if ((t.confidence ?? 1) < 0.8) low.push({ kind: 'task', ref: t.source_ref, confidence: t.confidence ?? 0.7 });

  return { course, sessions, readings: allReadings, tasks: allTasks, lowConfidence: low };
}
