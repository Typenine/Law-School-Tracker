"use client";

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import ClassWorkflow from '@/components/ClassWorkflow';
import DailyBriefing from '@/components/DailyBriefing';
import { tasksClient } from '@/lib/tasksClient';
import type { Task } from '@/lib/types';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';

function key(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(days: number) { const date = new Date(); date.setDate(date.getDate() + days); return key(date); }
function estimate(task: Task) { return task.estimatedMinutes || (task.activity === 'reading' ? 60 : task.activity === 'practice' ? 75 : 30); }
function minutes(value: number) { return value < 60 ? `${value} min` : `${Math.floor(value / 60)}h${value % 60 ? ` ${value % 60}m` : ''}`; }
function score(task: Task) {
  const days = Math.round((new Date(`${key(task.dueDate)}T12:00:00`).getTime() - new Date(`${addDays(0)}T12:00:00`).getTime()) / 86400000);
  return (days < 0 ? 1000 + Math.abs(days) * 25 : days === 0 ? 800 : days === 1 ? 500 : Math.max(0, 250 - days * 20)) + (task.activity === 'practice' ? 20 : task.activity === 'outline' ? 15 : 0);
}

function TaskRow({ task, refresh }: { task: Task; refresh: () => Promise<void> }) {
  const [working, setWorking] = useState(false);
  async function complete() {
    setWorking(true);
    try { await tasksClient.update(task.id, { status: 'done', completedAt: new Date().toISOString() }, { silent: true }); await refresh(); }
    finally { setWorking(false); }
  }
  async function tomorrow() {
    const due = new Date(); due.setDate(due.getDate() + 1); due.setHours(23, 59, 59, 999);
    setWorking(true);
    try { await tasksClient.update(task.id, { dueDate: due.toISOString() }, { silent: true }); await refresh(); }
    finally { setWorking(false); }
  }
  const overdue = key(task.dueDate) < addDays(0);
  return <article className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap gap-2 text-xs">{task.course ? <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-emerald-300">{task.course}</span> : null}<span className={overdue ? 'text-rose-300' : 'text-slate-500'}>{overdue ? 'Overdue' : new Date(task.dueDate).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span></div><h3 className="mt-2 font-semibold text-slate-100">{task.title}</h3><p className="mt-1 text-sm text-slate-400">about {minutes(estimate(task))}</p></div><div className="flex gap-2"><Link href={`/work?task=${task.id}`} className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950">Start</Link><button disabled={working} onClick={tomorrow} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Tomorrow</button><button disabled={working} onClick={complete} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950">Complete</button></div></div></article>;
}

export default function TodayPage() {
  const { tasks, loading, error, refresh } = useTasks();
  const { courses } = useCourses();
  const { currentTerm, showAllTerms, activeSemester, loading: semesterLoading } = useSemester();
  const [title, setTitle] = useState('');
  const [course, setCourse] = useState('');
  const [dueDate, setDueDate] = useState(addDays(0));
  const [adding, setAdding] = useState(false);

  const activeCourses = useMemo(() => activeSemester ? courses.filter(item => item.semester === activeSemester.season && item.year === activeSemester.year) : courses, [courses, activeSemester]);
  const open = useMemo(() => tasks.filter(task => task.status !== 'done' && (showAllTerms || !currentTerm || task.term === currentTerm)).sort((a, b) => score(b) - score(a)), [tasks, currentTerm, showAllTerms]);
  const recommended = open.slice(0, 5);
  const overdue = open.filter(task => key(task.dueDate) < addDays(0));
  const dueToday = open.filter(task => key(task.dueDate) === addDays(0));
  const dueSoon = open.filter(task => key(task.dueDate) >= addDays(0) && key(task.dueDate) <= addDays(7));

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !currentTerm) return;
    setAdding(true);
    try {
      await tasksClient.create({ title: title.trim(), course: course || null, dueDate: new Date(`${dueDate}T23:59:59`).toISOString(), status: 'todo', term: currentTerm }, { silent: true });
      setTitle('');
      await refresh();
    } finally { setAdding(false); }
  }

  return <main className="space-y-6">
    <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-emerald-300">Your law school command center</p>{activeSemester ? <Link href="/semester" className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{activeSemester.name}</Link> : null}</div><h2 className="mt-1 text-2xl font-semibold text-slate-100">What needs your attention today</h2><p className="mt-2 max-w-2xl text-sm text-slate-400">Prepare for class, resolve the highest-value work, and close the day without rebuilding a schedule.</p><div className="mt-4 flex flex-wrap gap-2"><Link href="/recovery" className="rounded-lg border border-rose-500/50 px-3 py-2 text-sm text-rose-300">I’m behind</Link><Link href="/questions" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Questions</Link><Link href="/review" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Weekly review</Link></div></div><div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-slate-800/70 px-4 py-3"><p className="text-xl font-semibold text-rose-300">{overdue.length}</p><p className="text-xs text-slate-400">Overdue</p></div><div className="rounded-xl bg-slate-800/70 px-4 py-3"><p className="text-xl font-semibold text-amber-300">{dueToday.length}</p><p className="text-xs text-slate-400">Due today</p></div><div className="rounded-xl bg-slate-800/70 px-4 py-3"><p className="text-xl font-semibold text-emerald-300">{minutes(recommended.reduce((sum, task) => sum + estimate(task), 0))}</p><p className="text-xs text-slate-400">Top workload</p></div></div></div></section>

    {!semesterLoading && !activeSemester ? <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"><h2 className="font-semibold text-amber-200">Set an active semester before adding work</h2><Link href="/semester" className="mt-3 inline-flex rounded-lg bg-amber-300 px-3 py-2 text-sm font-semibold text-slate-950">Open Term Setup</Link></section> : null}

    <DailyBriefing courses={activeCourses} tasks={tasks} currentTerm={currentTerm} />
    <ClassWorkflow courses={activeCourses} tasks={tasks} currentTerm={currentTerm} activeSemester={activeSemester} />

    <form onSubmit={addTask} className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold text-slate-100">Quick add</h2><p className="text-xs text-slate-500">New work is saved to {activeSemester?.name || 'the active semester'}.</p></div><Link href="/tasks" className="text-sm text-emerald-300">Open all tasks</Link></div><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_170px_auto]"><input value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs to be done?" className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100" /><select value={course} onChange={event => setCourse(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100"><option value="">No course</option>{activeCourses.map(item => <option key={item.id} value={item.title}>{item.title}</option>)}</select><input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100" /><button disabled={adding || !title.trim() || !currentTerm} className="rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">Add task</button></div></form>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]"><section className="space-y-3"><div className="flex items-end justify-between"><div><h2 className="text-lg font-semibold text-slate-100">Recommended next</h2><p className="text-sm text-slate-400">Up to five tasks, ranked automatically.</p></div><Link href="/calendar" className="text-sm text-slate-300">View calendar</Link></div>{loading ? <div className="rounded-xl border border-slate-700 p-6 text-sm text-slate-400">Loading your work…</div> : null}{error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}{!loading && !recommended.length ? <div className="rounded-xl border border-dashed border-slate-600 p-8 text-center text-slate-500">Nothing currently needs attention.</div> : null}{recommended.map(task => <TaskRow key={task.id} task={task} refresh={refresh} />)}</section><aside className="space-y-6"><section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold text-slate-100">Coming up</h2><p className="text-sm text-slate-400">Next seven days</p></div><span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{dueSoon.length}</span></div><div className="space-y-2">{dueSoon.slice(0, 6).map(task => <Link key={task.id} href={`/work?task=${task.id}`} className="flex items-start justify-between gap-3 rounded-lg bg-slate-950/45 px-3 py-2.5"><div><p className="text-sm text-slate-200">{task.title}</p><p className="text-xs text-slate-500">{task.course || 'General'}</p></div><span className="text-xs text-slate-400">{new Date(task.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></Link>)}{!dueSoon.length ? <p className="py-4 text-center text-sm text-slate-500">No deadlines this week.</p> : null}</div></section><section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4"><h2 className="font-semibold text-slate-100">Workflow shortcuts</h2><div className="mt-3 grid gap-2"><Link href="/outline-updates" className="rounded-lg bg-slate-950/45 p-3 text-sm text-slate-200">Weekly outline drafts</Link><Link href="/questions" className="rounded-lg bg-slate-950/45 p-3 text-sm text-slate-200">Office-hours questions</Link><Link href="/exam" className="rounded-lg bg-slate-950/45 p-3 text-sm text-slate-200">Exam preparation</Link></div></section></aside></div>
  </main>;
}
