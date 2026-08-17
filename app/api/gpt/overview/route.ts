
import { NextRequest } from 'next/server';
import { ensureSchema, getGptPool, listCourses, listSessions, listTasks } from '@/lib/storage';
import { countNotesByTask, hybridSearchAiNotes, listNotebooks } from '@/lib/aiNotes';
import { notesGptDb } from '@/lib/notes/db';
import { readingMetrics } from '@/lib/reading';
import { noStoreJson, requireGptToken } from '@/lib/actionAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

export async function GET(req: NextRequest) {
  const denied = requireGptToken(req); if (denied) return denied;
  try {
    await ensureSchema();
    const days = boundedInteger(req.nextUrl.searchParams.get('days'), 14, 1, 60);
    const recentLimit = boundedInteger(req.nextUrl.searchParams.get('recentNotes'), 8, 1, 20);
    const now = new Date(); const horizon = new Date(now.getTime() + days * 864e5); const sevenDaysAgo = new Date(now.getTime() - 7 * 864e5);
    const gptPool = getGptPool(); const notePool = notesGptDb();
    const [courses, tasks, sessions, notebooks, noteCounts, recentNotes] = await Promise.all([
      listCourses(gptPool), listTasks(gptPool), listSessions(gptPool), listNotebooks(false, notePool), countNotesByTask(notePool).catch(() => ({} as Record<string, number>)), hybridSearchAiNotes('', { sort: 'recent', limit: recentLimit }, notePool),
    ]);
    const taskById = new Map(tasks.map(task => [String(task.id), task]));
    const summarizeTask = (task: any) => ({
      id: task.id, title: task.title, course: task.course ?? null, courseId: task.courseId ?? null, dueDate: task.dueDate, status: task.status,
      estimatedMinutes: task.estimatedMinutes ?? null, estimateOrigin: task.estimateOrigin ?? null, priority: task.priority ?? null, activity: task.activity ?? null,
      pagesRead: task.pagesRead ?? null, tags: task.tags ?? [], noteCount: noteCounts[String(task.id)] || 0,
      ...(task.activity === 'reading' || task.originalPageRanges || task.remainingPageRanges ? readingMetrics(task, sessions, courses) : {}),
    });
    const openTasks = tasks.filter(task => task.status !== 'done');
    const upcomingAssignments = openTasks.filter(task => { const due = new Date(task.dueDate); return !Number.isNaN(due.getTime()) && due >= now && due <= horizon; }).sort((a,b)=>+new Date(a.dueDate)-+new Date(b.dueDate)).map(summarizeTask);
    const overdueAssignments = openTasks.filter(task => { const due = new Date(task.dueDate); return !Number.isNaN(due.getTime()) && due < now; }).sort((a,b)=>+new Date(a.dueDate)-+new Date(b.dueDate)).map(summarizeTask);
    const recentSessions = sessions.filter(session => { const when = new Date(session.when); return !Number.isNaN(when.getTime()) && when >= sevenDaysAgo && when <= now; });
    const studyByCourse = new Map<string, { minutes: number; sessions: number; practiceQs: number; pagesRead: number }>();
    for (const session of recentSessions) {
      const task = session.taskId ? taskById.get(String(session.taskId)) : null; const course = task?.course || 'Unlinked';
      const current = studyByCourse.get(course) || { minutes:0, sessions:0, practiceQs:0, pagesRead:0 };
      current.minutes += Number(session.minutes)||0; current.sessions += 1; current.practiceQs += Number(session.practiceQs)||0; current.pagesRead += Number(session.pagesRead)||0; studyByCourse.set(course,current);
    }
    const scored = recentSessions.filter(session => typeof session.focus === 'number'); const totalMinutes = recentSessions.reduce((sum,s)=>sum+(Number(s.minutes)||0),0);
    const openReadings = openTasks.filter(task => task.activity === 'reading' || task.originalPageRanges || task.remainingPageRanges).map(task => summarizeTask(task));
    return noStoreJson({
      generatedAt: now.toISOString(), planningHorizonDays: days,
      semesters: Array.from(new Set([...courses.map(c=>c.semester).filter(Boolean), ...notebooks.map(n=>n.semester).filter(Boolean)])),
      courses: courses.map(course => ({ id:course.id, code:course.code??null, title:course.title, instructor:course.instructor??null, semester:course.semester??null, year:course.year??null, startDate:course.startDate??null, endDate:course.endDate??null })),
      upcomingAssignments, overdueAssignments, openReadings,
      notebooks: notebooks.map(notebook => ({ id:notebook.id, name:notebook.name, course:notebook.course, semester:notebook.semester, pageCount:notebook.noteCount })), recentNotes,
      studyLast7Days: { totalMinutes, totalHours: Math.round((totalMinutes/60)*10)/10, sessionCount: recentSessions.length, averageFocus: scored.length ? Math.round((scored.reduce((sum,s)=>sum+Number(s.focus),0)/scored.length)*10)/10 : null, byCourse:Array.from(studyByCourse.entries()).map(([course,totals])=>({course,...totals})).sort((a,b)=>b.minutes-a.minutes) },
    });
  } catch (error) {
    console.error('[gpt/overview]', error); return noStoreJson({ error: 'Unable to build the workspace overview. Try again shortly.' }, { status: 500 });
  }
}
