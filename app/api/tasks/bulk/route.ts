import { NextRequest } from 'next/server';
import { ensureSchema, createTask, listCourses } from '@/lib/storage';
import { resolveCurrentSemesterState } from '@/lib/collections';
import { normalizeReadingTaskInput } from '@/lib/reading';
import { normalizeAcademicTaskInput, resolveCourseReference } from '@/lib/academic';
import { NewTaskInput, Task } from '@/lib/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  await ensureSchema();
  const taskSchema = z.object({
    title: z.string().min(1),
    dueDate: z.string().min(1),
    course: z.string().trim().min(1).nullable().optional(),
    courseId: z.string().trim().min(1).nullable().optional(),
    status: z.enum(['todo', 'done']).optional(),
    estimatedMinutes: z.number().int().min(0).nullable().optional(),
    estimateOrigin: z.enum(['learned','default','manual']).nullable().optional(),
    priority: z.number().int().min(1).max(5).nullable().optional(),
    tags: z.array(z.string().trim().min(1)).nullable().optional(),
    term: z.string().trim().min(1).nullable().optional(),
    activity: z.string().trim().min(1).nullable().optional(),
    pagesRead: z.number().int().min(0).nullable().optional(),
    originalPageRanges: z.string().trim().max(500).nullable().optional(),
    remainingPageRanges: z.string().trim().max(500).nullable().optional(),
  });
  const parsed = z.object({ tasks: z.array(taskSchema).min(1) }).safeParse(await req.json());
  if (!parsed.success) return new Response('Invalid bulk body', { status: 400 });

  const [courses, semesterState] = await Promise.all([
    listCourses(),
    resolveCurrentSemesterState(),
  ]);

  for (const item of parsed.data.tasks) {
    if (item.courseId && !resolveCourseReference(item.courseId, item.course, courses)) {
      return Response.json({ error: 'One of the selected courses no longer exists.' }, { status: 400 });
    }
  }

  const created: Task[] = [];
  for (const item of parsed.data.tasks as NewTaskInput[]) {
    const readingNormalized = normalizeReadingTaskInput(item, courses);
    const normalized = normalizeAcademicTaskInput(
      readingNormalized,
      courses,
      semesterState.semesters,
      semesterState.term.id || null,
    );
    created.push(await createTask(normalized));
  }
  return Response.json({ createdCount: created.length, tasks: created }, { status: 201 });
}
