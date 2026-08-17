
import { NextRequest } from 'next/server';
import { listAiNotes } from '@/lib/aiNotes';
import { readingMetrics, taskOriginalRanges } from '@/lib/reading';
import { ensureSchema, listCourses, listSessions, listTasks } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  await ensureSchema();
  const includeDone = req.nextUrl.searchParams.get('includeDone') === 'true';
  const [tasks, sessions, courses, notes] = await Promise.all([
    listTasks(), listSessions(), listCourses(), listAiNotes({ limit: 500 }).catch(() => []),
  ]);
  const notesByTask = new Map<string, typeof notes>();
  for (const note of notes) {
    if (!note.taskId) continue;
    const list = notesByTask.get(note.taskId) || [];
    list.push(note);
    notesByTask.set(note.taskId, list);
  }
  const readings = tasks
    .filter(task => includeDone || task.status !== 'done')
    .filter(task => task.activity === 'reading' || Boolean(taskOriginalRanges(task)))
    .map(task => {
      const metrics = readingMetrics(task, sessions, courses);
      const linked = notesByTask.get(task.id) || [];
      const dueMs = new Date(task.dueDate).getTime();
      const hoursUntilDue = Number.isFinite(dueMs) ? (dueMs - Date.now()) / 36e5 : Infinity;
      const atRisk = task.status !== 'done' && (hoursUntilDue < 0 || (hoursUntilDue <= 24 && metrics.estimatedMinutesRemaining >= 60));
      return {
        ...task,
        ...metrics,
        atRisk,
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
    const current = grouped.get(key) || { course: key, readings: 0, assignedPages: 0, completedPages: 0, remainingPages: 0, estimatedMinutesRemaining: 0, atRisk: 0 };
    current.readings += 1;
    current.assignedPages += reading.assignedPages;
    current.completedPages += reading.completedPages;
    current.remainingPages += reading.remainingPages;
    current.estimatedMinutesRemaining += reading.estimatedMinutesRemaining;
    current.atRisk += reading.atRisk ? 1 : 0;
    grouped.set(key, current);
  }
  return Response.json({
    generatedAt: new Date().toISOString(),
    summary: {
      readings: readings.filter(r => r.status !== 'done').length,
      assignedPages: readings.reduce((sum, r) => sum + r.assignedPages, 0),
      completedPages: readings.reduce((sum, r) => sum + r.completedPages, 0),
      remainingPages: readings.reduce((sum, r) => sum + r.remainingPages, 0),
      estimatedMinutesRemaining: readings.reduce((sum, r) => sum + r.estimatedMinutesRemaining, 0),
      atRisk: readings.filter(r => r.atRisk).length,
    },
    courses: Array.from(grouped.values()),
    readings,
  });
}
