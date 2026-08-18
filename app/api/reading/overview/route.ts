import { NextRequest } from 'next/server';
import { listAiNotes } from '@/lib/aiNotes';
import { resolveCurrentSemesterState } from '@/lib/collections';
import { ensureSchema, listCourses } from '@/lib/storage';
import { effectiveTaskSemesterId } from '@/lib/academic';
import { ensureTaskV2Schema, getTaskWorkspace } from '@/lib/taskV2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  await ensureSchema();
  await ensureTaskV2Schema();
  const includeDone = req.nextUrl.searchParams.get('includeDone') === 'true';
  const showAllTerms = req.nextUrl.searchParams.get('allTerms') === 'true';
  const [workspace, notes, semesterState, courses] = await Promise.all([
    getTaskWorkspace(),
    listAiNotes({ limit: 500 }).catch(() => []),
    resolveCurrentSemesterState(),
    listCourses(),
  ]);
  const activeTerm = semesterState.term.id || null;
  const notesByTask = new Map<string, typeof notes>();
  for (const note of notes) {
    if (!note.taskId) continue;
    const list = notesByTask.get(note.taskId) || [];
    list.push(note);
    notesByTask.set(note.taskId, list);
  }

  const readings = workspace.tasks
    .map(task => {
      const term = effectiveTaskSemesterId(task, courses, semesterState.semesters);
      return term && !task.term ? { ...task, term } : task;
    })
    .filter(task => showAllTerms || !activeTerm || !task.term || task.term === activeTerm)
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
        linkedNotes: linked.slice(0, 8).map(note => ({
          id: note.id,
          title: note.title,
          sourceType: note.sourceType,
          section: note.section,
          notebookName: note.notebookName,
        })),
      };
    })
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const grouped = new Map<string, any>();
  for (const reading of readings) {
    const key = reading.course || 'Unassigned';
    const current = grouped.get(key) || {
      course: key,
      readings: 0,
      assignedPages: 0,
      completedPages: 0,
      remainingPages: 0,
      estimatedMinutesRemaining: 0,
      atRisk: 0,
      blocked: 0,
    };
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
    activeTerm,
    summary: {
      readings: readings.filter(reading => reading.workflowState !== 'done').length,
      assignedPages: readings.reduce((sum, reading) => sum + (reading.assignedPages || 0), 0),
      completedPages: readings.reduce((sum, reading) => sum + (reading.completedPages || 0), 0),
      remainingPages: readings.reduce((sum, reading) => sum + (reading.remainingPages || 0), 0),
      estimatedMinutesRemaining: readings.reduce((sum, reading) => sum + (reading.estimatedMinutesRemaining || 0), 0),
      atRisk: readings.filter(reading => reading.atRisk).length,
      blocked: readings.filter(reading => reading.blocked).length,
    },
    courses: Array.from(grouped.values()),
    readings,
  });
}
