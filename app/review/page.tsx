"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { tasksClient } from '@/lib/tasksClient';
import { useCourses } from '@/lib/useCourses';
import { useSessions } from '@/lib/useSessions';
import { useTasks } from '@/lib/useTasks';
import { useSemester } from '@/lib/useSemester';
import type { Course, Task } from '@/lib/types';
import {
  COURSE_WORKSPACES_KEY,
  CourseWorkspaceMap,
  courseTermMatches,
  courseTasks,
  safeUrl,
  taskKind,
} from '@/lib/courseWorkspace';

function startOfWeek() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  now.setDate(now.getDate() - diff);
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

function completionDate(task: Task): Date | null {
  const raw = task.completedAt || (task.status === 'done' ? task.dueDate : null);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function ReviewPage() {
  const { tasks, loading: tasksLoading, refresh } = useTasks();
  const { sessions, loading: sessionsLoading } = useSessions();
  const { courses, loading: coursesLoading } = useCourses();
  const { currentTerm, activeSemester } = useSemester();
  const [workspaceMap, setWorkspaceMap] = useState<CourseWorkspaceMap>({});
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const loading = tasksLoading || sessionsLoading || coursesLoading;

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${COURSE_WORKSPACES_KEY}`);
        setWorkspaceMap((data.settings?.[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap);
      } catch {}
    })();
  }, []);

  const activeCourses = useMemo(() => courses.filter((course) => courseTermMatches(course, activeSemester?.season, activeSemester?.year)), [courses, activeSemester]);
  const activeTasks = useMemo(() => tasks.filter((task) => !currentTerm || task.term === currentTerm), [tasks, currentTerm]);
  const now = new Date();
  const weekStart = startOfWeek();
  const nextWeekEnd = endOfNextWeek();

  const overdue = useMemo(() => activeTasks.filter((task) => task.status !== 'done' && new Date(task.dueDate) < now).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()), [activeTasks]);
  const nextWeek = useMemo(() => activeTasks.filter((task) => task.status !== 'done' && new Date(task.dueDate) >= now && new Date(task.dueDate) <= nextWeekEnd).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()), [activeTasks]);
  const completedThisWeek = useMemo(() => activeTasks.filter((task) => {
    const date = completionDate(task);
    return date && date >= weekStart;
  }), [activeTasks]);

  const courseChecks = useMemo(() => activeCourses.map((course) => {
    const workspace = workspaceMap[course.id] || {};
    const matching = courseTasks(activeTasks, course.title, currentTerm);
    const open = matching.filter((task) => task.status !== 'done');
    const outlineOpen = open.filter((task) => taskKind(task) === 'outline');
    const completed = completedThisWeek.filter((task) => (task.course || '').toLowerCase() === course.title.toLowerCase());
    const lastCapture = workspace.lastClassCaptureAt ? new Date(workspace.lastClassCaptureAt) : null;
    const captureCurrent = Boolean(lastCapture && lastCapture >= weekStart);
    const linksReady = Boolean(safeUrl(workspace.notesUrl) && safeUrl(workspace.outlineUrl));
    const status = overdue.some((task) => (task.course || '').toLowerCase() === course.title.toLowerCase())
      ? 'Behind'
      : !captureCurrent
        ? 'Class capture missing'
        : !outlineOpen.length && completed.length
          ? 'Outline update needed'
          : 'On track';
    return { course, workspace, open, outlineOpen, completed, captureCurrent, linksReady, status };
  }), [activeCourses, workspaceMap, activeTasks, currentTerm, completedThisWeek, overdue]);

  const outlineSuggestions = useMemo(() => {
    return activeCourses.flatMap((course) => completedThisWeek
      .filter((task) => (task.course || '').toLowerCase() === course.title.toLowerCase())
      .filter((task) => taskKind(task) === 'reading' || taskKind(task) === 'assignment' || task.activity === 'review')
      .slice(0, 3)
      .map((task) => ({ course, source: task, suggestion: task.title.replace(/^read\s*:?/i, '').trim() })));
  }, [activeCourses, completedThisWeek]);

  const totalMinutes = useMemo(() => sessions.filter((session) => new Date(session.when) >= weekStart).reduce((sum, session) => sum + (session.minutes || 0), 0), [sessions]);
  const pages = useMemo(() => sessions.filter((session) => new Date(session.when) >= weekStart).reduce((sum, session) => sum + (session.pagesRead || 0), 0), [sessions]);

  async function addOutlineTask(course: Course, topic: string) {
    setWorkingId(course.id + topic);
    try {
      const due = new Date();
      due.setDate(due.getDate() + 2);
      due.setHours(20, 0, 0, 0);
      await tasksClient.create({
        title: `Add to ${course.title} outline: ${topic}`,
        course: course.title,
        dueDate: due.toISOString(),
        status: 'todo',
        term: currentTerm || null,
        activity: 'outline',
      }, { silent: true });
      setMessage('Outline follow-up added.');
      await refresh();
    } finally {
      setWorkingId(null);
    }
  }

  async function moveToNextWeek(task: Task) {
    setWorkingId(task.id);
    try {
      const due = new Date(task.dueDate);
      due.setDate(due.getDate() + 7);
      await tasksClient.update(task.id, { dueDate: due.toISOString() }, { silent: true });
      await refresh();
    } finally {
      setWorkingId(null);
    }
  }

  if (loading) return <main className="rounded-xl border border-slate-700 p-6 text-slate-400">Preparing weekly review…</main>;

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-sky-500/30 bg-gradient-to-br from-sky-950/30 to-slate-950 p-6">
        <p className="text-sm font-medium text-sky-300">Weekly review</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-100">Close the week and prepare the next one</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">This review focuses on unfinished work, missing class follow-up, outline maintenance, and the deadlines coming next.</p>
      </section>

      {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Unfinished</p><p className="mt-2 text-2xl font-semibold text-rose-300">{overdue.length}</p><p className="text-xs text-slate-500">overdue tasks</p></div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Coming next</p><p className="mt-2 text-2xl font-semibold text-amber-300">{nextWeek.length}</p><p className="text-xs text-slate-500">tasks through next Sunday</p></div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Course follow-up</p><p className="mt-2 text-2xl font-semibold text-sky-300">{courseChecks.filter((item) => item.status !== 'On track').length}</p><p className="text-xs text-slate-500">courses need attention</p></div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Completed</p><p className="mt-2 text-2xl font-semibold text-emerald-300">{completedThisWeek.length}</p><p className="text-xs text-slate-500">tasks this week</p></div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-end justify-between"><div><h2 className="font-semibold text-slate-100">Unfinished work</h2><p className="text-sm text-slate-400">Decide now whether to complete, move, or use Recovery Mode.</p></div><Link href="/recovery" className="text-sm text-rose-300">Open Recovery Mode</Link></div>
          {overdue.slice(0, 8).map((task) => <article key={task.id} className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-200">{task.title}</p><p className="mt-1 text-xs text-slate-500">{task.course || 'General'} · due {formatDue(task.dueDate)}</p></div><button disabled={workingId === task.id} onClick={() => moveToNextWeek(task)} className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">Move 1 week</button></div></article>)}
          {!overdue.length ? <div className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-500">No overdue work in the active semester.</div> : null}
        </section>

        <section className="space-y-3">
          <div><h2 className="font-semibold text-slate-100">Next week</h2><p className="text-sm text-slate-400">The deadlines that should shape the weekend.</p></div>
          {nextWeek.slice(0, 10).map((task) => <article key={task.id} className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-200">{task.title}</p><p className="mt-1 text-xs text-slate-500">{task.course || 'General'}</p></div><span className="shrink-0 text-xs text-slate-400">{formatDue(task.dueDate)}</span></div></article>)}
          {!nextWeek.length ? <div className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-500">No tasks are currently due during the next two weeks.</div> : null}
        </section>
      </div>

      <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
        <div><h2 className="font-semibold text-slate-100">Course maintenance</h2><p className="mt-1 text-sm text-slate-400">A course is not considered current until its class follow-up and outline workflow are maintained.</p></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {courseChecks.map(({ course, workspace, open, status, captureCurrent, linksReady }) => {
            const tone = status === 'Behind' ? 'text-rose-300 bg-rose-500/10' : status === 'On track' ? 'text-emerald-300 bg-emerald-500/10' : 'text-amber-300 bg-amber-500/10';
            return <article key={course.id} className="rounded-xl border border-slate-700 bg-slate-950/40 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium text-slate-100">{course.title}</h3><p className="mt-1 text-xs text-slate-500">{open.length} open task{open.length === 1 ? '' : 's'} · outline {workspace.outlineProgress || 0}%</p></div><span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{status}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className={`rounded-lg p-2 ${captureCurrent ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{captureCurrent ? 'Class captured' : 'Capture missing'}</div><div className={`rounded-lg p-2 ${linksReady ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-700/40 text-slate-400'}`}>{linksReady ? 'Drive linked' : 'Links incomplete'}</div></div><div className="mt-3 flex gap-2"><Link href={`/courses/${course.id}`} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800">Open course</Link>{safeUrl(workspace.outlineUrl) ? <a href={safeUrl(workspace.outlineUrl)} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800">Open outline</a> : null}</div></article>;
          })}
          {!courseChecks.length ? <div className="lg:col-span-2 rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-500">Add active-semester courses to receive course maintenance checks.</div> : null}
        </div>
      </section>

      <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
        <div><h2 className="font-semibold text-slate-100">Proposed outline follow-ups</h2><p className="mt-1 text-sm text-slate-400">These suggestions come from work completed this week. They create reviewable tasks rather than silently editing your outline.</p></div>
        <div className="mt-4 space-y-2">
          {outlineSuggestions.map(({ course, source, suggestion }) => <div key={`${course.id}:${source.id}`} className="flex flex-col gap-3 rounded-lg bg-slate-950/45 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-slate-200">{suggestion}</p><p className="mt-1 text-xs text-slate-500">{course.title}</p></div><button disabled={workingId === course.id + suggestion} onClick={() => addOutlineTask(course, suggestion)} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">Add outline task</button></div>)}
          {!outlineSuggestions.length ? <p className="py-4 text-sm text-slate-500">Complete readings or assignments during the week to generate outline follow-up suggestions.</p> : null}
        </div>
      </section>

      <details className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
        <summary className="cursor-pointer font-semibold text-slate-200">Study analytics</summary>
        <p className="mt-2 text-sm text-slate-400">Kept as secondary context, not the main purpose of the review.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-lg bg-slate-950/45 p-3"><p className="text-xl font-semibold text-slate-100">{Math.round(totalMinutes / 60 * 10) / 10}h</p><p className="text-xs text-slate-500">Logged this week</p></div><div className="rounded-lg bg-slate-950/45 p-3"><p className="text-xl font-semibold text-slate-100">{pages}</p><p className="text-xs text-slate-500">Pages logged</p></div><div className="rounded-lg bg-slate-950/45 p-3"><p className="text-xl font-semibold text-slate-100">{sessions.filter((session) => new Date(session.when) >= weekStart).length}</p><p className="text-xs text-slate-500">Sessions</p></div><div className="rounded-lg bg-slate-950/45 p-3"><p className="text-xl font-semibold text-slate-100">{completedThisWeek.length}</p><p className="text-xs text-slate-500">Tasks completed</p></div></div>
      </details>
    </main>
  );
}
