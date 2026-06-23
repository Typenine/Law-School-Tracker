import { NextResponse } from 'next/server';
import { assignmentMilestones } from '@/lib/assignmentPlanning';
import { examPlanTasks } from '@/lib/examPlanning';
import { buildOutlineProposal } from '@/lib/outlineWorkflow';
import { compareSyllabusVersions } from '@/lib/syllabusCompare';
import {
  isActiveTask,
  mergeTaskTags,
  syllabusSourceFromTags,
  taskMatchesCourse,
} from '@/lib/taskMetadata';
import type { ClassCapture, CourseQuestion, StoredSyllabusAnalysis } from '@/lib/courseWorkspace';
import type { Task } from '@/lib/types';
import { buildWeeklyPlanDetailed } from '@/lib/weekPlan';
import { elapsedSeconds } from '@/lib/workSessionState';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'title' | 'dueDate'>): Task {
  return {
    id: overrides.id,
    title: overrides.title,
    course: overrides.course ?? 'Evidence',
    dueDate: overrides.dueDate,
    status: overrides.status ?? 'todo',
    createdAt: overrides.createdAt ?? '2026-08-20T12:00:00.000Z',
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
    loggedMinutes: overrides.loggedMinutes ?? null,
    courseId: overrides.courseId ?? null,
    lifecycle: overrides.lifecycle ?? 'active',
  };
}

export async function GET() {
  const now = new Date('2026-09-16T12:00:00.000Z');
  const prior: StoredSyllabusAnalysis = {
    id: 'old', importedAt: '2026-08-01T12:00:00.000Z', importItems: [
      { sourceKey: 'reading:old', kind: 'task', title: 'Read: Erie pages 1-20', dueDate: '2026-09-14T09:00:00.000Z', activity: 'reading', selected: true },
    ],
  };
  const current: StoredSyllabusAnalysis = {
    id: 'new', importedAt: '2026-08-02T12:00:00.000Z', importItems: [
      { sourceKey: 'reading:new', kind: 'task', title: 'Read: Erie pages 1-25', dueDate: '2026-09-16T09:00:00.000Z', activity: 'reading', selected: true },
    ],
  };
  const syllabusDiff = compareSyllabusVersions(prior, current);

  const replacedTags = mergeTaskTags(
    ['syllabus-import', 'syllabus-source:reading%3Aold', 'assignment-plan-created'],
    ['syllabus-import', 'syllabus-source:reading%3Anew'],
    { courseId: 'course-1', lifecycle: 'active' },
  );
  const archivedTags = mergeTaskTags([], [], { lifecycle: 'archived' });
  const courseTags = mergeTaskTags([], [], { courseId: 'course-1' });
  const linkedTask = task({ id: 'linked', title: 'Linked work', dueDate: '2026-09-18T20:00:00.000Z', course: 'Old Evidence Name', tags: courseTags });

  const assignmentDue = new Date('2026-09-21T20:00:00.000Z');
  const assignmentPlan = assignmentMilestones('Appellate brief', assignmentDue.toISOString(), 'brief', now);
  const examDate = '2026-09-22';
  const examPlan = examPlanTasks('Evidence', examDate, ['Hearsay'], now);

  const weeklyTask = task({ id: 'weekly', title: 'Long research task', dueDate: '2026-09-21T20:00:00.000Z', estimatedMinutes: 180 });
  const weeklyPlan = buildWeeklyPlanDetailed(
    [weeklyTask],
    new Date('2026-09-21T12:00:00.000Z'),
    { 1: 60, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 0: 0 },
    { '2026-09-21': 30 },
  );

  const captures: ClassCapture[] = [{ id: 'capture-new', classDate: '2026-09-15', topic: 'Hearsay', outlineFlag: true, createdAt: '2026-09-15T20:00:00.000Z' }];
  const questions: CourseQuestion[] = [
    { id: 'question-old', text: 'Old question', source: 'class', status: 'open', officeHours: true, createdAt: '2026-09-01T20:00:00.000Z' },
    { id: 'question-new', text: 'New question', source: 'class', status: 'open', officeHours: true, createdAt: '2026-09-15T20:00:00.000Z' },
  ];
  const outline = buildOutlineProposal('Evidence', captures, questions, [], undefined, now);

  const checks = [
    { name: 'Moved syllabus reading is changed rather than added and removed', passed: syllabusDiff.changed.length === 1 && syllabusDiff.added.length === 0 && syllabusDiff.removed.length === 0 },
    { name: 'Syllabus source identity is replaced without losing protected plan tag', passed: syllabusSourceFromTags(replacedTags) === 'reading:new' && replacedTags.includes('assignment-plan-created') && !replacedTags.includes('syllabus-source:reading%3Aold') },
    { name: 'Archived work is excluded from active workflows', passed: !isActiveTask(task({ id: 'archived', title: 'Removed reading', dueDate: now.toISOString(), tags: archivedTags, lifecycle: 'archived' })) },
    { name: 'Course ID survives a course display-name change', passed: taskMatchesCourse(linkedTask, { id: 'course-1', title: 'Evidence' }) },
    { name: 'Compressed assignment plan stays between now and final due date', passed: assignmentPlan.every(item => new Date(item.dueDate) > now && new Date(item.dueDate) <= assignmentDue) },
    { name: 'Compressed exam plan stays between now and exam', passed: examPlan.every(item => new Date(item.dueDate) > now && new Date(item.dueDate) <= new Date(`${examDate}T20:00:00.000Z`)) },
    { name: 'Weekly plan subtracts fixed commitments', passed: weeklyPlan.availableByDay['2026-09-21'] === 30 },
    { name: 'Weekly plan retains unplanned remainder for partial scheduling', passed: weeklyPlan.remainders[0]?.plannedMinutes === 30 && weeklyPlan.remainders[0]?.remainingMinutes === 150 },
    { name: 'Timestamp timer restores accumulated and running time', passed: elapsedSeconds({ taskId: 'timer', running: true, accumulatedSeconds: 30, startedAt: 1_000, sessionStartedAt: now.toISOString(), notes: '', pages: '' }, 66_000) === 95 },
    { name: 'Outline draft includes only current-week open questions', passed: Boolean(outline) && outline?.sourceQuestionIds.length === 1 && outline.sourceQuestionIds[0] === 'question-new' },
  ];

  return NextResponse.json({ passed: checks.every(check => check.passed), checks });
}
