import { NextResponse } from 'next/server';
import {
  assignmentMilestones,
  buildOutlineProposal,
  compareSyllabusVersions,
  examPlanTasks,
  recoveryReason,
} from '@/lib/academicWorkflow';
import type { ClassCapture, CourseQuestion, StoredSyllabusAnalysis } from '@/lib/courseWorkspace';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'title' | 'dueDate'>): Task {
  return {
    id: overrides.id,
    title: overrides.title,
    course: overrides.course ?? 'Evidence',
    dueDate: overrides.dueDate,
    status: overrides.status ?? 'todo',
    estimatedMinutes: overrides.estimatedMinutes ?? 60,
    actualMinutes: overrides.actualMinutes ?? null,
    priority: overrides.priority ?? null,
    notes: overrides.notes ?? null,
    attachments: overrides.attachments ?? null,
    dependsOn: overrides.dependsOn ?? null,
    tags: overrides.tags ?? null,
    term: overrides.term ?? 'fall-2026',
    completedAt: overrides.completedAt ?? null,
    focus: overrides.focus ?? null,
    pagesRead: overrides.pagesRead ?? null,
    activity: overrides.activity ?? 'other',
    startTime: overrides.startTime ?? null,
    endTime: overrides.endTime ?? null,
    createdAt: overrides.createdAt ?? '2026-08-20T12:00:00.000Z',
  };
}

export async function GET() {
  const finalDue = '2026-10-30T23:59:59.000Z';
  const milestones = assignmentMilestones('Appellate brief', finalDue, 'brief');

  const captures: ClassCapture[] = [{
    id: 'capture-1',
    classDate: '2026-09-14',
    topic: 'Character evidence and Rule 404 exceptions',
    cases: 'Old Chief v. United States',
    professorEmphasis: 'Always separate propensity from another permissible purpose.',
    question: 'When does limiting-instruction analysis matter?',
    outlineFlag: true,
    createdAt: '2026-09-14T20:00:00.000Z',
  }];
  const questions: CourseQuestion[] = [{
    id: 'question-1',
    text: 'When does limiting-instruction analysis matter?',
    source: 'class',
    status: 'open',
    officeHours: true,
    createdAt: '2026-09-14T20:00:00.000Z',
  }];
  const completed = [task({ id: 'read-1', title: 'Read Rules 404-405', dueDate: '2026-09-14T14:00:00.000Z', status: 'done', activity: 'reading', completedAt: '2026-09-14T12:00:00.000Z' })];
  const syllabus: StoredSyllabusAnalysis = {
    id: 'syllabus-1',
    importedAt: '2026-08-20T12:00:00.000Z',
    sessionSummary: [{ date: '2026-09-14', topic: 'Character Evidence', readingCount: 1, assignmentCount: 0 }],
  };
  const proposal = buildOutlineProposal('Evidence', captures, questions, completed, syllabus, new Date('2026-09-16T12:00:00.000Z'));

  const previous: StoredSyllabusAnalysis = {
    id: 'version-1',
    importedAt: '2026-08-01T12:00:00.000Z',
    importItems: [
      { sourceKey: 'reading:a', kind: 'task', title: 'Read pages 1-20', dueDate: '2026-08-24T14:00:00', activity: 'reading', selected: true },
      { sourceKey: 'reading:b', kind: 'task', title: 'Read pages 21-40', dueDate: '2026-08-26T14:00:00', activity: 'reading', selected: true },
    ],
  };
  const current: StoredSyllabusAnalysis = {
    id: 'version-2',
    importedAt: '2026-08-05T12:00:00.000Z',
    importItems: [
      { sourceKey: 'reading:a', kind: 'task', title: 'Read pages 1-25', dueDate: '2026-08-25T14:00:00', activity: 'reading', selected: true },
      { sourceKey: 'reading:c', kind: 'task', title: 'Read pages 41-60', dueDate: '2026-08-28T14:00:00', activity: 'reading', selected: true },
    ],
  };
  const diff = compareSyllabusVersions(previous, current);
  const examTasks = examPlanTasks('Evidence', '2026-12-16', ['Hearsay exceptions']);
  const overdue = task({ id: 'late-1', title: 'Read hearsay chapter', dueDate: '2026-06-20T23:59:59.000Z', activity: 'reading' });

  const checks = [
    { name: 'Major assignment receives research and drafting milestones', passed: milestones.some(item => item.tag === 'research') && milestones.some(item => item.tag === 'draft') },
    { name: 'Assignment plan includes citation review and submission', passed: milestones.some(item => item.tag === 'citations') && milestones.some(item => item.tag === 'submit') },
    { name: 'Outline proposal includes captured doctrine', passed: Boolean(proposal?.content.includes('Character evidence')) },
    { name: 'Outline proposal preserves professor emphasis', passed: Boolean(proposal?.content.includes('propensity')) },
    { name: 'Outline proposal includes unresolved questions', passed: Boolean(proposal?.content.includes('limiting-instruction')) },
    { name: 'Syllabus comparison detects addition', passed: diff.added.length === 1 },
    { name: 'Syllabus comparison detects changed reading', passed: diff.changed.length === 1 },
    { name: 'Syllabus comparison detects removal', passed: diff.removed.length === 1 },
    { name: 'Exam plan includes outline and timed practice', passed: examTasks.some(item => item.activity === 'outline') && examTasks.some(item => item.activity === 'practice') },
    { name: 'Exam plan adds weak-area drill', passed: examTasks.some(item => item.title.includes('Hearsay exceptions')) },
    { name: 'Recovery reason explains overdue status', passed: /overdue/i.test(recoveryReason(overdue, 20)) },
  ];

  return NextResponse.json({
    passed: checks.every(check => check.passed),
    checks,
    counts: {
      assignmentMilestones: milestones.length,
      examPlanTasks: examTasks.length,
      syllabusAdded: diff.added.length,
      syllabusChanged: diff.changed.length,
      syllabusRemoved: diff.removed.length,
    },
  });
}
