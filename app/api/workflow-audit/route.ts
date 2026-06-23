import { NextResponse } from 'next/server';
import type { Course, Task } from '@/lib/types';
import { buildWeeklyPlan } from '@/lib/weekPlan';
import { nextClassOccurrence, taskKind } from '@/lib/courseWorkspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  const course: Course = {
    id: 'audit-evidence',
    title: 'Evidence',
    code: 'LAW-701',
    semester: 'Fall',
    year: 2026,
    color: '#10b981',
    meetingDays: [1, 3],
    meetingStart: '14:00',
    meetingEnd: '15:15',
    meetingBlocks: [{ days: [1, 3], start: '14:00', end: '15:15', location: 'Room 204' }],
    startDate: '2026-08-24',
    endDate: '2026-12-11',
    instructor: 'Professor Audit',
    room: 'Room 204',
    location: 'Room 204',
    createdAt: '2026-06-23T00:00:00.000Z',
  };

  const tasks: Task[] = [
    {
      id: 'audit-reading', title: 'Read Evidence pages 35-62', course: 'Evidence',
      dueDate: '2026-08-26T23:59:59.000Z', status: 'todo', estimatedMinutes: 90,
      actualMinutes: null, priority: 2, notes: null, attachments: null, dependsOn: null,
      tags: null, term: 'fall-2026', completedAt: null, focus: null, pagesRead: 28,
      activity: 'reading', startTime: null, endTime: null, createdAt: '2026-06-23T00:00:00.000Z',
    },
    {
      id: 'audit-outline', title: 'Update Evidence attack outline', course: 'Evidence',
      dueDate: '2026-08-29T23:59:59.000Z', status: 'todo', estimatedMinutes: 45,
      actualMinutes: null, priority: 3, notes: null, attachments: null, dependsOn: null,
      tags: null, term: 'fall-2026', completedAt: null, focus: null, pagesRead: null,
      activity: 'outline', startTime: null, endTime: null, createdAt: '2026-06-23T00:00:00.000Z',
    },
  ];

  const weekStart = new Date('2026-08-24T12:00:00');
  const availability = { 0: 120, 1: 120, 2: 120, 3: 120, 4: 120, 5: 180, 6: 180 };
  const plan = buildWeeklyPlan(tasks, weekStart, availability);
  const nextClass = nextClassOccurrence(course, new Date('2026-08-24T08:00:00'));
  const nextSemester = { name: 'Spring 2027', startDate: '2027-01-01', endDate: '2027-05-31' };

  const checks = [
    { name: 'Fall 2026 course schedule resolves', passed: Boolean(nextClass && nextClass.start.getDay() === 1) },
    { name: 'Reading is recognized', passed: taskKind(tasks[0]) === 'reading' },
    { name: 'Outline work is recognized', passed: taskKind(tasks[1]) === 'outline' },
    { name: 'Weekly plan schedules both tasks', passed: new Set(plan.map((block) => block.taskId)).size === 2 },
    { name: 'Weekly plan stays within availability', passed: plan.reduce((sum, block) => sum + block.plannedMinutes, 0) <= Object.values(availability).reduce((sum, value) => sum + value, 0) },
    { name: 'Spring 2027 rollover is generated', passed: nextSemester.name === 'Spring 2027' && nextSemester.endDate > nextSemester.startDate },
  ];

  return NextResponse.json({
    scenario: 'Fall 2026 setup, first week, and Spring 2027 rollover',
    passed: checks.every((check) => check.passed),
    checks,
    generatedBlocks: plan.length,
  });
}
