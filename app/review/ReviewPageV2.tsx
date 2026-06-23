"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { courseTermMatches, safeUrl, taskKind } from '@/lib/courseWorkspace';
import { taskMatchesCourse } from '@/lib/taskMetadata';
import { tasksClient } from '@/lib/tasksClient';
import type { Course, Task } from '@/lib/types';
import { useCourses } from '@/lib/useCourses';
import { useCourseWorkspaces } from '@/lib/useCourseWorkspaces';
import { useSemester } from '@/lib/useSemester';
import { useSessions } from '@/lib/useSessions';
import { useTasks } from '@/lib/useTasks';

function startOfWeek() {
  const now = new Date();
  const offset = now.getDay() === 0 ? 6 : now.getDay() - 1;
  now.setDate(now.getDate() - offset);
  now.setHours(0, 0, 0, 0);
  return now;
}

function endOfNextWeek() {
  const end = startOfWeek();
  end.setDate(end.getDate() + 13);
  end.setHours(23, 59, 59, 999);
  return end;
}

function formatDue(value: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value));
}

export default function ReviewPageV2() {
  const { tasks, loading: tasksLoading, refresh } = useTasks();
  const { sessions, loading: sessionsLoading } = useSessions();
  const { courses, loading: coursesLoading } = useCourses();
  const { workspaces, loading: workspaceLoading } = useCourseWorkspaces();
  const { currentTerm, activeSemester } = useSemester();
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const loading = tasksLoading || sessionsLoading || coursesLoading || workspaceLoading;
  const weekStart = startOfWeek();
  const nextWeekEnd = endOfNextWeek();
  const now = new Date();

  const activeCourses = useMemo(() => courses.filter(course => courseTermMatches(course, activeSemester?.season, activeSemester?.year)), [courses, activeSemester]);
  const activeTasks = useMemo(() => tasks.filter(task => !currentTerm || !task.term || task.term === currentTerm), [tasks, currentTerm]);
  const overdue = useMemo(() => activeTasks.filter(task => task.status !== 'done' && new Date(task.dueDate) < now).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [activeTasks]);
  const nextWeek = useMemo(() => activeTasks.filter(task => task.status !== 'done' && new Date(task.dueDate) >= now && new Date(task.dueDate) <= nextWeekEnd).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [activeTasks]);
  const completedThisWeek = useMemo(() => activeTasks.filter(task => task.completedAt && new Date(task.completedAt) >= weekStart), [activeTasks]);

  const courseChecks = useMemo(() => activeCourses.map(course => {
    const workspace = workspaces[course.id] || {};
    const matching = activeTasks.filter(task => taskMatchesCourse(task, course));
    const open = matching.filter(task => task.status !== 'done');
    const completed = completedThisWeek.filter(task => taskMatchesCourse(task, course));
    const captureCurrent = (workspace.classCaptures || []).some(capture => new Date(`${capture.classDate}T12:00:00`) >= weekStart);
    const currentDraft = (workspace.outlineProposals || []).some(proposal => proposal.weekStart >= weekStart.toISOString().slice(0, 10) && proposal.status === 'draft');
    const linksReady = Boolean(safeUrl(workspace.notesUrl) && safeUrl(workspace.outlineUrl));
    const behind = overdue.some(task => taskMatchesCourse(task, course));
    const status = behind ? 'Behind' : !captureCurrent ? 'Class capture missing' : currentDraft ? 'Outline draft ready' : completed.length ? 'Outline review needed' : 'On track';
    return { course, workspace, open, completed, captureCurrent, currentDraft, linksReady, status };
  }), [activeCourses, workspaces, activeTasks, completedThisWeek, overdue]);

  const totalMinutes = useMemo(() => sessions.filter(session => new Date(session.when) >= weekStart).reduce((sum, session) => sum + (session.minutes || 0), 0), [sessions]);
  const pages = useMemo(() => sessions.filter(session => new Date(session.when) >= weekStart).reduce((sum, session) => sum + (session.pagesRead || 0), 0), [sessions]);

  async function addOutlineTask(course: Course, source: Task) {
    setWorkingId(`${course.id}:${source.id}`);
    try {
      const due = new Date();
      due.setDate(due.getDate() + 2);
      due.setHours(20, 0, 0, 0);
      await tasksClient.create({
        title: `Add to ${course.title} outline: ${source.title.replace(/^read\s*:?/i, '').trim()}`,
        course: course.title,
        courseId: course.id,
        dueDate: due.toISOString(),
        status: 'todo',
        term: currentTerm || null,
        activity: 'outline',
        dependsOn: [source.id],
        tags: ['weekly-review-follow-up'],
      }, { silent: true });
      setMessage('Outline follow-up added.');
      await refresh();
    } finally { setWorkingId(null); }
  }

  async function moveToNextWeek(task: Task) {
    setWorkingId(task.id);
    try {
      const due = new Date(task.dueDate);
      due.setDate(due.getDate() + 7);
      await tasksClient.update(task.id, { dueDate: due.toISOString() }, { silent: true });
      await refresh();
    } finally { setWorkingId(null); }
  }

  if (loading) return <main className="rounded-xl border border-slate-700 p-6 text-slate-400">Preparing weekly review…</main>;

  return <main className="space-y-6">
    <section className="rounded-2xl border border-sky-500/30 bg-gradient-to-br from-sky-950/30 to-slate-950 p-6"><p className="text-sm font-medium text-sky-300">Weekly review</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Close the week and prepare the next one</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Unfinished work, structured class captures, outline drafts, and the next two weeks are reviewed from the same durable course records.</p></section>
    {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Unfinished</p><p className="mt-2 text-2xl font-semibold text-rose-300">{overdue.length}</p><p className="text-xs text-slate-500">overdue tasks</p></div><div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Coming next</p><p className="mt-2 text-2xl font-semibold text-amber-300">{nextWeek.length}</p><p className="text-xs text-slate-500">tasks through next Sunday</p></div><div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Course follow-up</p><p className="mt-2 text-2xl font-semibold text-sky-300">{courseChecks.filter(item => item.status !== 'On track').length}</p><p className="text-xs text-slate-500">courses need attention</p></div><div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Study history</p><p className="mt-2 text-2xl font-semibold text-emerald-300">{Math.round(totalMinutes / 6) / 10}h</p><p className="text-xs text-slate-500">{pages} pages this week</p></div></section>

    <div className="grid gap-6 xl:grid-cols-2"><section className="space-y-3"><div className="flex items-end justify-between"><div><h2 className="font-semibold text-slate-100">Unfinished work</h2><p className="text-sm text-slate-400">Complete, move, or use Recovery Mode.</p></div><Link href="/recovery" className="text-sm text-rose-300">Open Recovery Mode</Link></div>{overdue.slice(0, 8).map(task => <article key={task.id} className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-200">{task.title}</p><p className="mt-1 text-xs text-slate-500">{task.course || 'General'} · due {formatDue(task.dueDate)}</p></div><button disabled={workingId === task.id} onClick={() => moveToNextWeek(task)} className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-50">Move 1 week</button></div></article>)}{!overdue.length ? <div className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-500">No overdue work in the active semester.</div> : null}</section><section className="space-y-3"><div><h2 className="font-semibold text-slate-100">Next two weeks</h2><p className="text-sm text-slate-400">The deadlines that should shape the weekend.</p></div>{nextWeek.slice(0, 10).map(task => <article key={task.id} className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-200">{task.title}</p><p className="mt-1 text-xs text-slate-500">{task.course || 'General'}</p></div><span className="text-xs text-slate-400">{formatDue(task.dueDate)}</span></div></article>)}{!nextWeek.length ? <div className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-500">No work is due during the next two weeks.</div> : null}</section></div>

    <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5"><div><h2 className="font-semibold text-slate-100">Course maintenance</h2><p className="mt-1 text-sm text-slate-400">Class capture, outline follow-up, and Drive links are checked by stable course identity.</p></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{courseChecks.map(({ course, workspace, open, completed, status, captureCurrent, currentDraft, linksReady }) => { const tone = status === 'Behind' ? 'text-rose-300 bg-rose-500/10' : status === 'On track' ? 'text-emerald-300 bg-emerald-500/10' : currentDraft ? 'text-violet-300 bg-violet-500/10' : 'text-amber-300 bg-amber-500/10'; const source = completed.find(task => ['reading','assignment','review'].includes(taskKind(task))); return <article key={course.id} className="rounded-xl border border-slate-700 bg-slate-950/40 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium text-slate-100">{course.title}</h3><p className="mt-1 text-xs text-slate-500">{open.length} open task{open.length === 1 ? '' : 's'} · outline {workspace.outlineProgress || 0}%</p></div><span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{status}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div className={`rounded-lg p-2 ${captureCurrent ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{captureCurrent ? 'Captured' : 'Capture missing'}</div><div className={`rounded-lg p-2 ${currentDraft ? 'bg-violet-500/10 text-violet-300' : 'bg-slate-700/40 text-slate-400'}`}>{currentDraft ? 'Draft ready' : 'No draft'}</div><div className={`rounded-lg p-2 ${linksReady ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-700/40 text-slate-400'}`}>{linksReady ? 'Drive linked' : 'Links incomplete'}</div></div><div className="mt-3 flex flex-wrap gap-2"><Link href={`/courses/${course.id}`} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200">Open course</Link>{currentDraft ? <Link href="/outline-updates" className="rounded-lg border border-violet-500/40 px-3 py-2 text-xs text-violet-300">Review draft</Link> : null}{source ? <button disabled={workingId === `${course.id}:${source.id}`} onClick={() => addOutlineTask(course, source)} className="rounded-lg border border-sky-500/40 px-3 py-2 text-xs text-sky-300 disabled:opacity-50">Add outline follow-up</button> : null}{safeUrl(workspace.outlineUrl) ? <a href={safeUrl(workspace.outlineUrl)} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200">Open outline</a> : null}</div></article>; })}{!courseChecks.length ? <div className="lg:col-span-2 rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-500">Add active-semester courses to receive course maintenance checks.</div> : null}</div></section>
    <div className="flex flex-wrap gap-2"><Link href="/week-plan" className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950">Plan next week</Link><Link href="/questions" className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Questions</Link><Link href="/outline-updates" className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Outline drafts</Link></div>
  </main>;
}
