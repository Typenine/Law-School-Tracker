"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { useCourses } from '@/lib/useCourses';
import { useSessions } from '@/lib/useSessions';
import { useTasks } from '@/lib/useTasks';

function formatMinutes(minutes: number) {
  const total = Math.max(0, Math.round(minutes || 0));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function dateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export default function StudyHistoryPage() {
  const { sessions, loading, refresh } = useSessions();
  const { tasks } = useTasks();
  const { courses } = useCourses();
  const [courseFilter, setCourseFilter] = useState('');
  const [days, setDays] = useState(30);
  const [deleting, setDeleting] = useState<string | null>(null);

  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const cutoff = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }, [days]);

  const rows = useMemo(() => sessions
    .filter((session) => new Date(session.when) >= cutoff)
    .map((session) => {
      const task = session.taskId ? tasksById.get(session.taskId) : null;
      const course = task?.course || '';
      return { ...session, task, course };
    })
    .filter((session) => !courseFilter || session.course === courseFilter)
    .sort((a, b) => b.when.localeCompare(a.when)), [sessions, cutoff, tasksById, courseFilter]);

  const totalMinutes = rows.reduce((sum, session) => sum + (session.minutes || 0), 0);
  const totalPages = rows.reduce((sum, session) => sum + (session.pagesRead || 0), 0);
  const completedTasks = new Set(rows.map((session) => session.taskId).filter(Boolean)).size;

  const coursePace = useMemo(() => courses.map((course) => {
    const matching = rows.filter((session) => session.course === course.title && (session.pagesRead || 0) > 0);
    const minutes = matching.reduce((sum, session) => sum + (session.minutes || 0), 0);
    const pages = matching.reduce((sum, session) => sum + (session.pagesRead || 0), 0);
    return { course, sessions: matching.length, minutesPerPage: pages ? minutes / pages : null };
  }).filter((item) => item.sessions > 0), [courses, rows]);

  const grouped = useMemo(() => {
    const map: Record<string, typeof rows> = {};
    for (const row of rows) {
      const key = dateKey(row.when);
      (map[key] ||= []).push(row);
    }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);

  async function removeSession(id: string) {
    if (!window.confirm('Delete this study record?')) return;
    setDeleting(id);
    try {
      await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
      await refresh();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
        <p className="text-sm font-medium text-sky-300">Study history</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-100">Use past work to improve future estimates</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Most records should be created automatically when work is finished. This page shows what happened and what the tracker learned.</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Study time</p><p className="mt-2 text-2xl font-semibold text-slate-100">{formatMinutes(totalMinutes)}</p><p className="text-xs text-slate-500">last {days} days</p></div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Pages recorded</p><p className="mt-2 text-2xl font-semibold text-slate-100">{totalPages}</p><p className="text-xs text-slate-500">used for reading estimates</p></div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Tasks represented</p><p className="mt-2 text-2xl font-semibold text-emerald-300">{completedTasks}</p><p className="text-xs text-slate-500">linked study records</p></div>
      </section>

      <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4">
        <div className="grid gap-3 sm:grid-cols-[220px_220px_auto]"><select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"><option value="">All courses</option>{courses.map((course) => <option key={course.id} value={course.title}>{course.title}</option>)}</select><select value={days} onChange={(event) => setDays(Number(event.target.value))} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option></select><div className="flex items-center justify-end"><Link href="/tasks" className="text-sm text-emerald-300">Start from a task</Link></div></div>
      </section>

      {coursePace.length ? <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5"><h2 className="font-semibold text-slate-100">Learned reading pace</h2><p className="mt-1 text-sm text-slate-400">The tracker uses these observations when estimating future readings. Small samples remain tentative.</p><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{coursePace.map((item) => <div key={item.course.id} className="rounded-lg bg-slate-950/40 p-3"><p className="text-sm font-medium text-slate-200">{item.course.title}</p><p className="mt-2 text-xl font-semibold text-sky-300">{item.minutesPerPage?.toFixed(1)} min/page</p><p className="text-xs text-slate-500">from {item.sessions} session{item.sessions === 1 ? '' : 's'}</p></div>)}</div></section> : null}

      <section className="space-y-5">
        <div><h2 className="text-lg font-semibold text-slate-100">Recent work</h2><p className="text-sm text-slate-500">Records are grouped by day and linked back to their task when possible.</p></div>
        {loading ? <div className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading study history…</div> : null}
        {!loading && grouped.map(([day, dayRows]) => <div key={day} className="space-y-2"><h3 className="text-sm font-semibold text-slate-300">{formatDate(`${day}T12:00:00`)}</h3>{dayRows.map((session) => <article key={session.id} className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-sky-500/10 px-2 py-1 capitalize text-sky-300">{session.activity || 'study'}</span>{session.course ? <span className="text-slate-500">{session.course}</span> : null}</div><h4 className="mt-2 font-medium text-slate-100">{session.task?.title || 'Unlinked study session'}</h4><p className="mt-1 text-sm text-slate-400">{formatMinutes(session.minutes || 0)}{session.pagesRead ? ` · ${session.pagesRead} pages` : ''}{session.practiceQs ? ` · ${session.practiceQs} practice questions` : ''}</p>{session.notes ? <p className="mt-2 text-sm text-slate-500">{session.notes}</p> : null}</div><div className="flex gap-2">{session.taskId ? <Link href={`/work/${session.taskId}`} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200">Open task</Link> : null}<button disabled={deleting === session.id} onClick={() => removeSession(session.id)} className="rounded-lg border border-rose-500/40 px-3 py-2 text-xs text-rose-300 disabled:opacity-50">Delete</button></div></div></article>)}</div>)}
        {!loading && !grouped.length ? <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center"><p className="font-medium text-slate-200">No study history in this range.</p><p className="mt-1 text-sm text-slate-500">Open a task and use Start Work to create records automatically.</p></div> : null}
      </section>
    </main>
  );
}
