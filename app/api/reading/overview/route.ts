import { NextRequest } from 'next/server';
import { listAiNotes } from '@/lib/aiNotes';
import { ensureSchema } from '@/lib/storage';
import { ensureTaskV2Schema, getTaskWorkspace } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  await ensureSchema();
  await ensureTaskV2Schema();
  const includeDone = req.nextUrl.searchParams.get('includeDone') === 'true';
  const [workspace, notes] = await Promise.all([
    getTaskWorkspace(),
    listAiNotes({ limit: 500 }).catch(() => []),
  ]);
  const notesByTask = new Map<string, typeof notes>();
  for (const note of notes) {
    if (!note.taskId) continue;
    const list = notesByTask.get(note.taskId) || [];
    list.push(note);
    notesByTask.set(note.taskId, list);
  }
  const readings = workspace.tasks
    .filter(task => task.workflowState !== 'canceled')
    .filter(task => includeDone || task.workflowState !== 'done')
    .filter(task => Boolean(task.reading))
    .map(task => {
      const linked = notesByTask.get(task.id) || [];
      return {
        ...task,
        ...(task.reading || {}),
        noteCount: linked.length,
        readingNoteCount: linked.filter(note => note.sourceType === 'reading-notes').length,
        caseBriefCount: linked.filter(note => note.sourceType === 'case-brief').length,
        classNoteCount: linked.filter(note => note.sourceType === 'class-notes').length,
        linkedNotes: linked.slice(0, 8).map(note => ({ id: note.id, title: note.title, sourceType: note.sourceType, section: note.section, notebookName: note.notebookName })),
      };
    })
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const grouped = new Map<string, any>();
  for (const reading of readings) {
    const key = reading.course || 'Unassigned';
    const current = grouped.get(key) || { course: key, readings: 0, assignedPages: 0, completedPages: 0, remainingPages: 0, estimatedMinutesRemaining: 0, atRisk: 0, blocked: 0 };
    current.readings += 1;
    current.assignedPages += reading.assignedPages || 0;
    current.completedPages += reading.completedPages || 0;
    current.remainingPages += reading.remainingPages || 0;
    current.estimatedMinutesRemaining += reading.estimatedMinutesRemaining || 0;
    current.atRisk += reading.atRisk ? 1 : 0;
    current.blocked += reading.blocked ? 1 : 0;
    grouped.set(key, current);
  }

  return Response.json({
    generatedAt: new Date().toISOString(),
    summary: {
      readings: readings.filter(r => r.workflowState !== 'done').length,
      assignedPages: readings.reduce((sum, r) => sum + (r.assignedPages || 0), 0),
      completedPages: readings.reduce((sum, r) => sum + (r.completedPages || 0), 0),
      remainingPages: readings.reduce((sum, r) => sum + (r.remainingPages || 0), 0),
      estimatedMinutesRemaining: readings.reduce((sum, r) => sum + (r.estimatedMinutesRemaining || 0), 0),
      atRisk: readings.filter(r => r.atRisk).length,
      blocked: readings.filter(r => r.blocked).length,
    },
    courses: Array.from(grouped.values()),
    readings,
  });
}
