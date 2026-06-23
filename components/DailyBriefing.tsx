"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { courseBlocks, ymd } from '@/lib/courseWorkspace';
import { useCourseWorkspaces } from '@/lib/useCourseWorkspaces';
import type { CalendarEvent, Course, Task } from '@/lib/types';

function sameCourse(task: Task, course: Course) {
  return (task.course || '').trim().toLowerCase() === course.title.trim().toLowerCase();
}

function dueKey(task: Task) {
  return task.dueDate.slice(0, 10);
}

export default function DailyBriefing({ courses, tasks, currentTerm }: { courses: Course[]; tasks: Task[]; currentTerm?: string | null }) {
  const { workspaces } = useCourseWorkspaces();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [mode, setMode] = useState<'morning' | 'evening'>(() => new Date().getHours() < 16 ? 'morning' : 'evening');
  const today = ymd(new Date());

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ events: CalendarEvent[] }>('/api/events');
        setEvents(data.events || []);
      } catch {}
    })();
  }, []);

  const classesToday = useMemo(() => courses.flatMap(course => courseBlocks(course)
    .filter(block => block.days.includes(new Date().getDay()))
    .map(block => ({ course, block }))), [courses]);
  const activeTasks = useMemo(() => tasks.filter(task => task.status !== 'done' && (!currentTerm || task.term === currentTerm)), [tasks, currentTerm]);
  const dueToday = activeTasks.filter(task => dueKey(task) === today);
  const overdue = activeTasks.filter(task => dueKey(task) < today);
  const completedToday = tasks.filter(task => task.status === 'done' && task.completedAt?.slice(0, 10) === today);
  const todayEvents = events.filter(event => event.date === today);
  const missingCaptures = classesToday.filter(({ course }) => !(workspaces[course.id]?.classCaptures || []).some(capture => capture.classDate === today));

  return (
    <section className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-sm font-medium text-sky-300">Daily briefing</p><h2 className="mt-1 font-semibold text-slate-100">{mode === 'morning' ? 'Start the day with the actual obligations' : 'Close the day before work rolls forward'}</h2></div>
        <div className="flex rounded-lg border border-slate-700 p-1 text-xs"><button onClick={() => setMode('morning')} className={`rounded px-3 py-1.5 ${mode === 'morning' ? 'bg-sky-500 text-slate-950' : 'text-slate-400'}`}>Morning</button><button onClick={() => setMode('evening')} className={`rounded px-3 py-1.5 ${mode === 'evening' ? 'bg-sky-500 text-slate-950' : 'text-slate-400'}`}>Evening</button></div>
      </div>

      {mode === 'morning' ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs uppercase text-slate-500">Classes</p><p className="mt-2 text-xl font-semibold text-slate-100">{classesToday.length}</p><p className="text-xs text-slate-500">{classesToday.map(item => item.course.title).join(', ') || 'No classes today'}</p></div>
          <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs uppercase text-slate-500">Due today</p><p className="mt-2 text-xl font-semibold text-amber-300">{dueToday.length}</p><p className="text-xs text-slate-500">{overdue.length ? `${overdue.length} overdue also need attention` : 'No overdue work'}</p></div>
          <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs uppercase text-slate-500">Commitments</p><p className="mt-2 text-xl font-semibold text-sky-300">{todayEvents.length}</p><p className="text-xs text-slate-500">{todayEvents.slice(0, 2).map(event => event.title).join(', ') || 'No outside commitments'}</p></div>
          <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs uppercase text-slate-500">Recommended focus</p><p className="mt-2 text-sm font-semibold text-slate-100">{overdue[0]?.title || dueToday[0]?.title || activeTasks[0]?.title || 'No urgent task'}</p><p className="mt-2"><Link href={overdue[0] || dueToday[0] || activeTasks[0] ? `/work?task=${(overdue[0] || dueToday[0] || activeTasks[0]).id}` : '/tasks'} className="text-xs text-sky-300">Open work</Link></p></div>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs uppercase text-slate-500">Completed</p><p className="mt-2 text-xl font-semibold text-emerald-300">{completedToday.length}</p><p className="text-xs text-slate-500">tasks finished today</p></div>
          <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs uppercase text-slate-500">Still due</p><p className="mt-2 text-xl font-semibold text-amber-300">{dueToday.length}</p><p className="text-xs text-slate-500">decide whether to finish or move</p></div>
          <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs uppercase text-slate-500">Class captures missing</p><p className="mt-2 text-xl font-semibold text-rose-300">{missingCaptures.length}</p><p className="text-xs text-slate-500">{missingCaptures.map(item => item.course.title).join(', ') || 'All classes captured'}</p></div>
          <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs uppercase text-slate-500">Week status</p><p className={`mt-2 text-sm font-semibold ${overdue.length ? 'text-rose-300' : 'text-emerald-300'}`}>{overdue.length ? 'Needs recovery plan' : 'On track'}</p><p className="mt-2"><Link href={overdue.length ? '/recovery' : '/review'} className="text-xs text-sky-300">{overdue.length ? 'Open Recovery Mode' : 'Open Weekly Review'}</Link></p></div>
        </div>
      )}

      {mode === 'evening' && dueToday.length ? <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"><p className="text-sm font-medium text-amber-200">Unfinished today</p><div className="mt-2 flex flex-wrap gap-2">{dueToday.slice(0, 4).map(task => <Link key={task.id} href={`/work?task=${task.id}`} className="rounded-lg border border-amber-500/30 px-2.5 py-1.5 text-xs text-amber-200">{task.title}</Link>)}</div></div> : null}
    </section>
  );
}
