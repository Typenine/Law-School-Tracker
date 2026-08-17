import { NextRequest } from 'next/server';
import { ensureSchema, getGptPool, listCourses, listSessions } from '@/lib/storage';
import { countNotesByTask } from '@/lib/aiNotes';
import { notesGptDb } from '@/lib/notes/db';
import { readingMetrics } from '@/lib/reading';
import { ensureTaskV2Schema, listVisibleTasks } from '@/lib/taskV2';
import { noStoreJson, requireGptToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(req: NextRequest) {
  const denied = requireGptToken(req);
  if (denied) return denied;
  try {
    await ensureSchema();
    await ensureTaskV2Schema();
    const params = req.nextUrl.searchParams;
    const status = params.get('status');
    const course = params.get('course')?.trim().toLowerCase() || '';
    const activity = params.get('activity')?.trim().toLowerCase() || '';
    const from = validDate(params.get('from')); const to = validDate(params.get('to'));
    const requestedLimit = Number(params.get('limit') || 50);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.floor(requestedLimit), 100)) : 50;
    const gptPool = getGptPool();
    const [tasks, sessions, courses, noteCounts] = await Promise.all([
      listVisibleTasks({ includeBlocked: true, overridePool: gptPool }),
      listSessions(gptPool),
      listCourses(gptPool),
      countNotesByTask(notesGptDb()).catch(() => ({} as Record<string, number>)),
    ]);
    const taskById = new Map(tasks.map(task => [String(task.id), task]));
    const assignments = tasks
      .filter(task => !status || status === 'all' || task.status === status)
      .filter(task => !course || (task.course || '').toLowerCase().includes(course))
      .filter(task => !activity || (task.activity || '').toLowerCase() === activity)
      .filter(task => { const due = new Date(task.dueDate); return (!from || due >= from) && (!to || due <= to); })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, limit)
      .map(task => {
        const blockers = (task.dependsOn || []).map(String).filter(id => taskById.get(id)?.status !== 'done').map(id => ({ id, title: taskById.get(id)?.title || 'Missing prerequisite' }));
        const hasSessions = sessions.some(session => String(session.taskId || '') === String(task.id));
        const workflowState = task.status === 'done' ? 'done' : hasSessions ? 'in-progress' : 'not-started';
        return {
          id: task.id, title: task.title, course: task.course ?? null, courseId: task.courseId ?? null, dueDate: task.dueDate, status: task.status,
          workflowState, blocked: blockers.length > 0 && task.status !== 'done', blockedBy: blockers,
          estimatedMinutes: task.estimatedMinutes ?? null, estimateOrigin: task.estimateOrigin ?? null, priority: task.priority ?? null, notes: task.notes ?? null,
          tags: task.tags ?? [], activity: task.activity ?? null, pagesRead: task.pagesRead ?? null, term: task.term ?? null, dependsOn: task.dependsOn ?? [], noteCount: noteCounts[task.id] || 0,
          ...(task.activity === 'reading' || task.originalPageRanges || task.remainingPageRanges ? readingMetrics(task, sessions, courses) : {}),
        };
      });
    return noStoreJson({ assignments, count: assignments.length });
  } catch (error) {
    console.error('[gpt/assignments]', error);
    return noStoreJson({ error: 'Unable to load assignments. Try again shortly.' }, { status: 500 });
  }
}
