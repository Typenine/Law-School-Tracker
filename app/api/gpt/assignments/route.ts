import { NextRequest } from 'next/server';
import { ensureSchema, getGptPool, listTasks } from '@/lib/storage';
import { countNotesByTask } from '@/lib/aiNotes';
import { notesGptDb } from '@/lib/notes/db';
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
    const params = req.nextUrl.searchParams;
    const status = params.get('status');
    const course = params.get('course')?.trim().toLowerCase() || '';
    const from = validDate(params.get('from'));
    const to = validDate(params.get('to'));
    const requestedLimit = Number(params.get('limit') || 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.floor(requestedLimit), 100))
      : 50;

    // How many note pages each assignment has, so the assistant knows there is
    // something to read before it goes looking.
    const noteCounts = await countNotesByTask(notesGptDb()).catch(() => ({} as Record<string, number>));

    const assignments = (await listTasks(getGptPool()))
      .filter(task => !status || status === 'all' || task.status === status)
      .filter(task => !course || (task.course || '').toLowerCase().includes(course))
      .filter(task => {
        const due = new Date(task.dueDate);
        if (from && due < from) return false;
        if (to && due > to) return false;
        return true;
      })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, limit)
      .map(task => ({
        id: task.id,
        title: task.title,
        course: task.course ?? null,
        dueDate: task.dueDate,
        status: task.status,
        estimatedMinutes: task.estimatedMinutes ?? null,
        priority: task.priority ?? null,
        notes: task.notes ?? null,
        tags: task.tags ?? [],
        activity: task.activity ?? null,
        pagesRead: task.pagesRead ?? null,
        term: task.term ?? null,
        noteCount: noteCounts[task.id] || 0,
      }));

    return noStoreJson({ assignments, count: assignments.length });
  } catch (error) {
    console.error('[gpt/assignments]', error);
    return noStoreJson({ error: 'Unable to load assignments. Try again shortly.' }, { status: 500 });
  }
}
