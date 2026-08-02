import { NextRequest } from 'next/server';
import { ensureSchema, listSessions, listTasks } from '@/lib/storage';
import { noStoreJson, requireGptToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The study log: what was worked on, for how long, and how it went.
 *
 * The tracker has recorded this all along and the assistant could not see any
 * of it, so questions like "how much have I actually put into Torts this
 * month" had nothing to answer from. Read-only, like the rest of the Action.
 */
export async function GET(req: NextRequest) {
  const denied = requireGptToken(req);
  if (denied) return denied;

  try {
    await ensureSchema();
    const params = req.nextUrl.searchParams;
    const course = params.get('course')?.trim().toLowerCase() || '';
    const from = validDate(params.get('from'));
    const to = validDate(params.get('to'));
    const requestedLimit = Number(params.get('limit') || 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.floor(requestedLimit), 200))
      : 50;

    // Sessions record a task, not a course, so the course filter goes through
    // the task each one belongs to.
    const tasks = await listTasks();
    const taskById = new Map(tasks.map(task => [task.id, task]));

    const matching = (await listSessions())
      .filter(session => {
        const when = new Date(session.when);
        if (from && when < from) return false;
        if (to && when > to) return false;
        return true;
      })
      .filter(session => {
        if (!course) return true;
        const task = session.taskId ? taskById.get(session.taskId) : null;
        return (task?.course || '').toLowerCase().includes(course);
      });

    const sessions = matching.slice(0, limit).map(session => {
      const task = session.taskId ? taskById.get(session.taskId) : null;
      return {
        id: session.id,
        when: session.when,
        minutes: session.minutes,
        focus: session.focus ?? null,
        activity: session.activity ?? null,
        pagesRead: session.pagesRead ?? null,
        outlinePages: session.outlinePages ?? null,
        practiceQs: session.practiceQs ?? null,
        notes: session.notes ?? null,
        taskId: session.taskId ?? null,
        taskTitle: task?.title ?? null,
        course: task?.course ?? null,
      };
    });

    // Totals over everything that matched, not just the page returned, so a
    // limit does not quietly understate the term.
    const totalMinutes = matching.reduce((sum, session) => sum + (Number(session.minutes) || 0), 0);
    const scored = matching.filter(session => typeof session.focus === 'number');
    const averageFocus = scored.length
      ? Math.round((scored.reduce((sum, s) => sum + (s.focus as number), 0) / scored.length) * 10) / 10
      : null;

    return noStoreJson({
      sessions,
      count: sessions.length,
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      averageFocus,
    });
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : 'Unable to load study sessions.' },
      { status: 500 },
    );
  }
}
