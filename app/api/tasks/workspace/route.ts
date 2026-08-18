import { NextRequest } from 'next/server';
import { ensureSchema, getSettings, listCourses } from '@/lib/storage';
import { resolveCurrentSemesterState } from '@/lib/collections';
import {
  attachSemesterIds,
  effectiveTaskSemesterId,
} from '@/lib/academic';
import { ensureTaskV2Schema, getTaskWorkspace } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function availabilityTemplateIsUnconfigured(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const record = value as Record<string | number, unknown>;
  const values = Array.from({ length: 7 }, (_, day) => Number(record[day] ?? record[String(day)]));
  return values.every(minutes => !Number.isFinite(minutes) || minutes <= 0);
}

export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    const [workspace, rawCourses, semesterState, settings] = await Promise.all([
      getTaskWorkspace(),
      listCourses(),
      resolveCurrentSemesterState(),
      getSettings(['availabilityTemplateV1']),
    ]);
    const showAllTerms = req.nextUrl.searchParams.get('allTerms') === 'true';
    const activeTerm = semesterState.term.id || null;
    const courses = attachSemesterIds(rawCourses, semesterState.semesters);
    const visibleCourses = showAllTerms || !activeTerm
      ? courses
      : courses.filter(course => course.semesterId === activeTerm);
    const availabilityUnconfigured = availabilityTemplateIsUnconfigured(settings?.availabilityTemplateV1);

    const withEffectiveTerm = <T extends { term?: string | null; courseId?: string | null; course?: string | null }>(item: T): T => {
      const term = effectiveTaskSemesterId(item, rawCourses, semesterState.semesters);
      return term && !item.term ? { ...item, term } : item;
    };
    const inTerm = <T extends { term?: string | null; courseId?: string | null; course?: string | null }>(item: T) => {
      const normalized = withEffectiveTerm(item);
      return showAllTerms || !activeTerm || !normalized.term || normalized.term === activeTerm;
    };

    const workspaceVersion = new Date().toISOString();
    const tasks = workspace.tasks
      .filter(inTerm)
      .map(task => ({ ...withEffectiveTerm(task), updatedAt: workspaceVersion }))
      .map(task => {
        // Older planner settings can leave an all-zero availability template
        // behind after the newer availability-window UI takes over. Treat that
        // state as "not configured" rather than "the student has zero minutes
        // available forever." Preserve real overdue and blocked risk signals.
        const falseCapacityRisk = availabilityUnconfigured
          && task.atRisk
          && !task.blocked
          && /Needs \d+ min; about 0 min is available before the deadline/i.test(task.atRiskReason || '');
        return falseCapacityRisk ? { ...task, atRisk: false, atRiskReason: null } : task;
      });
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
