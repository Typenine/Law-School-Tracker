import { NextRequest } from 'next/server';
import { createTask, ensureSchema, listCourses } from '@/lib/storage';
import { resolveCurrentSemesterState } from '@/lib/collections';
import { NewTaskInput } from '@/lib/types';
import { normalizeReadingTaskInput } from '@/lib/reading';
import {
  effectiveTaskSemesterId,
  normalizeAcademicTaskInput,
  resolveCourseReference,
} from '@/lib/academic';
import { ensureTaskV2Schema, listVisibleTasks } from '@/lib/taskV2';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  await ensureSchema();
  await ensureTaskV2Schema();
  const includeCanceled = req.nextUrl.searchParams.get('includeCanceled') === 'true';
  const includeBlocked = req.nextUrl.searchParams.get('includeBlocked') !== 'false';
  const showAllTerms = req.nextUrl.searchParams.get('allTerms') === 'true';
  const [allTasks, courses, semesterState] = await Promise.all([
    listVisibleTasks({ includeCanceled, includeBlocked }),
    listCourses(),
    resolveCurrentSemesterState(),
  ]);
  const activeTerm = semesterState.term.id || null;
  const tasks = allTasks
    .map(task => {
      const term = effectiveTaskSemesterId(task, courses, semesterState.semesters);
      return term && !task.term ? { ...task, term } : task;
    })
    .filter(task => showAllTerms || !activeTerm || !task.term || task.term === activeTerm);
  return Response.json({ tasks, activeTerm });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  await ensureTaskV2Schema();
  const schema = z.object({
    title: z.string().min(1),
    course: z.string().trim().min(1).nullable().optional(),
    courseId: z.string().trim().min(1).nullable().optional(),
    dueDate: z.string().min(1),
    status: z.enum(['todo', 'done']).optional(),
    startTime: z.string().trim().nullable().optional().or(z.literal('')).transform(v => v === '' ? null : v),
    endTime: z.string().trim().nullable().optional().or(z.literal('')).transform(v => v === '' ? null : v),
    estimatedMinutes: z.number().int().min(0).nullable().optional(),
    estimateOrigin: z.enum(['learned','default','manual']).nullable().optional(),
    priority: z.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    attachments: z.array(z.string().url()).nullable().optional(),
    dependsOn: z.array(z.string()).nullable().optional(),
    tags: z.array(z.string().trim().min(1)).nullable().optional(),
    term: z.string().trim().min(1).nullable().optional(),
    pagesRead: z.number().int().min(0).nullable().optional(),
    activity: z.string().trim().min(1).nullable().optional(),
    originalPageRanges: z.string().trim().max(500).nullable().optional(),
    remainingPageRanges: z.string().trim().max(500).nullable().optional(),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid task body', { status: 400 });

  const [courses, semesterState] = await Promise.all([
    listCourses(),
    resolveCurrentSemesterState(),
  ]);
  if (parsed.data.courseId && !resolveCourseReference(parsed.data.courseId, parsed.data.course, courses)) {
    return Response.json({ error: 'Course not found.' }, { status: 400 });
  }

  const readingNormalized = normalizeReadingTaskInput(parsed.data as NewTaskInput, courses);
  const normalized = normalizeAcademicTaskInput(
    readingNormalized,
    courses,
    semesterState.semesters,
    semesterState.term.id || null,
  );
  const task = await createTask(normalized);
  return Response.json({ task }, { status: 201 });
}
