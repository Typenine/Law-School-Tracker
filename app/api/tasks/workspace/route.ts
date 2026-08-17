import { NextRequest } from 'next/server';
import { ensureSchema, listCourses } from '@/lib/storage';
import { activeSemesterId } from '@/lib/collections';
import { ensureTaskV2Schema, getTaskWorkspace } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    const [workspace, courses, activeTerm] = await Promise.all([getTaskWorkspace(), listCourses(), activeSemesterId()]);
    const showAllTerms = req.nextUrl.searchParams.get('allTerms') === 'true';
    const inTerm = <T extends { term?: string | null }>(item: T) => showAllTerms || !activeTerm || !item.term || item.term === activeTerm;
    const workspaceVersion = new Date().toISOString();
    const tasks = workspace.tasks.filter(inTerm).map(task => ({ ...task, updatedAt: workspaceVersion }));
    const trash = workspace.trash.filter(inTerm);
    const summary = {
      open: tasks.filter(task => !['done', 'canceled'].includes(task.workflowState)).length,
      inProgress: tasks.filter(task => task.workflowState === 'in-progress').length,
      blocked: tasks.filter(task => task.blocked).length,
      atRisk: tasks.filter(task => task.atRisk).length,
      done: tasks.filter(task => task.workflowState === 'done').length,
      canceled: tasks.filter(task => task.workflowState === 'canceled').length,
      trash: trash.length,
    };
    return Response.json({ ...workspace, tasks, trash, summary, courses, activeTerm });
  } catch (error) {
    console.error('[task workspace]', error);
    return Response.json({ error: 'Unable to load the task workspace.' }, { status: 500 });
  }
}
