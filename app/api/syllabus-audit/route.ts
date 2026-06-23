import { NextResponse } from 'next/server';
import { buildWizardPreview } from '@/lib/wizard_parser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SAMPLE = `
EVIDENCE LAW-701 — Fall 2026
Professor: Dana Example
Email: dana@example.edu
Office Hours: Tuesdays 2:00-4:00 p.m. or by appointment
Class: Monday and Wednesday 2:00-3:15 p.m., Room 204
Required Materials
Mueller & Kirkpatrick, Evidence Under the Rules, 10th edition
Grading
Final Examination 70%
Participation 10%
Trial Brief 20%

COURSE SCHEDULE
August 24 — Introduction to Evidence
Read Mueller pp. 1-28
August 26 — Relevance
Read Mueller pp. 29-56; Old Chief v. United States
September 2 — No class, university holiday
September 9 — Character Evidence
Read Rules 404-405 and Mueller pp. 120-147
Trial brief due September 18 at 11:59 p.m.
October 12 — Hearsay
Read Mueller pp. 300-
335 and Federal Rules of Evidence 801-807
Quiz due at start of class
December 9 — Review
Final exam December 16 at 9:00 a.m.

Attendance Policy
More than two absences may reduce the final grade.
Academic Integrity
All submitted work must comply with the student handbook.
`;

export async function GET() {
  const preview = buildWizardPreview(SAMPLE, 'Evidence', {
    timezone: 'America/Chicago',
    referenceDate: '2026-08-01',
    minutesPerPage: 3,
  });

  const allTaskTitles = preview.tasks.map(task => task.title.toLowerCase());
  const allReadingText = preview.readings.map(reading => `${reading.short_title} ${reading.pages || ''}`.toLowerCase());
  const checks = [
    { name: 'Course title detected', passed: preview.course?.title?.toLowerCase().includes('evidence') === true },
    { name: 'Professor email detected', passed: preview.course?.professor_email === 'dana@example.edu' },
    { name: 'Meeting days detected', passed: Boolean(preview.course?.meeting_days?.includes(1) && preview.course?.meeting_days?.includes(3)) },
    { name: 'Office hours retained', passed: preview.sections?.office_hours.some(item => /tuesdays/i.test(item)) === true },
    { name: 'Required material retained', passed: preview.sections?.required_materials.some(item => /mueller/i.test(item)) === true },
    { name: 'Grading components retained', passed: (preview.sections?.grading_components.length || 0) >= 2 },
    { name: 'No-class date detected', passed: preview.sessions.some(session => session.canceled && session.date === '2026-09-02') },
    { name: 'Case citation extracted', passed: allReadingText.some(text => /old chief v\./i.test(text)) },
    { name: 'Wrapped page range joined', passed: allReadingText.some(text => /300.*335/.test(text)) },
    { name: 'Explicit brief deadline extracted', passed: allTaskTitles.some(title => title.includes('trial brief')) },
    { name: 'Start-of-class due time extracted', passed: preview.tasks.some(task => /quiz/i.test(task.title) && task.due_datetime.includes('T14:00:00')) },
    { name: 'Final exam extracted', passed: preview.tasks.some(task => task.type === 'exam' && task.due_datetime.startsWith('2026-12-16T09:00')) },
    { name: 'Policies retained', passed: (preview.sections?.policies.length || 0) >= 1 },
  ];

  return NextResponse.json({
    passed: checks.every(check => check.passed),
    checks,
    diagnostics: preview.diagnostics,
    counts: { sessions: preview.sessions.length, readings: preview.readings.length, tasks: preview.tasks.length },
  });
}
