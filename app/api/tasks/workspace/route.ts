import { NextRequest } from 'next/server';
import { ensureSchema, listCourses } from '@/lib/storage';
import { resolveCurrentSemesterState } from '@/lib/collections';
import {
  attachSemesterIds,
  effectiveTaskSemesterId,
} from '@/lib/academic';
import { ensureTaskV2Schema, getTaskWorkspace } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    const [workspace, rawCourses, semesterState] = await Promise.all([
      getTaskWorkspace(),
      listCourses(),
      resolveCurrentSemesterState(),
    ]);
    const showAllTerms = req.nextUrl.searchParams.get('allTerms') === 'true';
    const activeTerm = semesterState.term.id || null;
    const courses = attachSemesterIds(rawCourses, semesterState.semesters);
    const visibleCourses = showAllTerms || !activeTerm
      ? courses
      : courses.filter(course => course.semesterId === activeTerm);

    const withEffectiveTerm = <T extends { term?: string | null; courseId?: string | null; course?: string | null }>(item: T): T => {
      const term = effectiveTaskSemesterId(item, rawCourses, semesterState.semesters);
      return term && !item.term ? { ...item, term } : item;
    };
    const inTerm = <T extends { term?: string | null; courseId?: string | null; course?: string | null }>(item: T) => {
      const normalized = withEffectiveTerm(item);
      return showAllTerms || !activeTerm || !normalized.term || normalized.term === activeTerm;
    };

    const workspaceVersion = new Date().toISOString();
    const tasks = workspace.tasks.filter(inTerm).map(task => ({ ...withEffectiveTerm(task), updatedAt: workspaceVersion }));
    const trash = workspace.trash.filter(inTerm).map(withEffectiveTerm);
    const summary = {
      open: tasks.filter(task => !['done', 'canceled'].includes(task.workflowState)).length,
      inProgress: tasks.filter(task => task.workflowState === 'in-progress').length,
      blocked: tasks.filter(task => task.blocked).length,
      atRisk: tasks.filter(task => task.atRisk).length,
      done: tasks.filter(task => task.workflowState === 'done').length,
      canceled: tasks.filter(task => task.workflowState === 'canceled').length,
      trash: trash.length,
    };

    return Response.json({
      ...workspace,
      tasks,
      trash,
      summary,
      courses: visibleCourses,
      activeTerm,
      semesters: semesterState.semesters,
    });
  } catch (error) {
    console.error('[task workspace]', error);
    return Response.json({ error: 'Unable to load the task workspace.' }, { status: 500 });
  }
}
