"use client";

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import CurrentTaskCard from '@/components/CurrentTaskCard';
import { tasksClient } from '@/lib/tasksClient';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';

function dateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(days: number) { const date = new Date(); date.setDate(date.getDate() + days); return dateKey(date); }
function estimate(task: any) { if (task.estimatedMinutes) return task.estimatedMinutes; if (task.activity === 'reading') return 60; if (task.activity === 'practice') return 75; if (task.activity === 'outline') return 45; return 30; }
function formatMinutes(minutes: number) { return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ''}`.trim(); }

export default function TasksPage() {
  const { tasks, loading, error, refresh } = useTasks();
  const { courses } = useCourses();
  const { currentTerm, activeSemester, showAllTerms, toggleShowAll } = useSemester();
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [title, setTitle] = useState('');
  const [course, setCourse] = useState('');
  const [dueDate, setDueDate] = useState(addDays(0));
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCourseFilter(params.get('course') || '');
    setSearch(params.get('text') || '');
  }, []);

  const activeCourses = useMemo(() => activeSemester ? courses.filter((item) => item.semester === activeSemester.season && item.year === activeSemester.year) : courses, [courses, activeSemester]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks
      .filter((task) => showAllTerms || !currentTerm || task.term === currentTerm)
      .filter((task) => showCompleted || task.status !== 'done')
      .filter((task) => !courseFilter || task.course === courseFilter)
      .filter((task) => !query || `${task.title} ${task.course || ''} ${task.notes || ''}`.toLowerCase().includes(query))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [tasks, showAllTerms, currentTerm, showCompleted, courseFilter, search]);

  const groups = useMemo(() => {
    const today = addDays(0);
    const week = addDays(7);
    return {
      overdue: filtered.filter((task) => task.status !== 'done' && dateKey(task.dueDate) < today),
      today: filtered.filter((task) => task.status !== 'done' && dateKey(task.dueDate) === today),
      week: filtered.filter((task) => task.status !== 'done' && dateKey(task.dueDate) > today && dateKey(task.dueDate) <= week),
      later: filtered.filter((task) => task.status !== 'done' && dateKey(task.dueDate) > week),
      completed: filtered.filter((task) => task.status === 'done'),
    };
  }, [filtered]);

  const open = filtered.filter((task) => task.status !== 'done');
  const workload = open.filter((task) => dateKey(task.dueDate) <= addDays(7)).reduce((sum, task) => sum + estimate(task), 0);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !currentTerm) return;
    setAdding(true);
    try {
      let taskTitle = title.trim();
      let selectedCourse = course;
      if (!selectedCourse && taskTitle.includes(':')) {
        const [prefix, ...rest] = taskTitle.split(':');
        const match = activeCourses.find((item) => item.title.toLowerCase().startsWith(prefix.trim().toLowerCase()));
        if (match && rest.join(':').trim()) { selectedCourse = match.title; taskTitle = rest.join(':').trim(); }
      }
      await tasksClient.create({ title: taskTitle, course: selectedCourse || null, dueDate: new Date(`${dueDate}T23:59:59`).toISOString(), status: 'todo', term: currentTerm }, { silent: true });
      setTitle('');
      await refresh();
    } finally { setAdding(false); }
  }

  const sections = [
    ['overdue', 'Overdue', 'Complete, move, or use Recovery Mode.'],
    ['today', 'Today', 'Work that must move today.'],
    ['week', 'Next seven days', 'The work shaping this week.'],
    ['later', 'Later', 'Future work that does not need attention yet.'],
  ] as const;

  return <main className="space-y-6">
    <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6"><div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="text-sm font-medium text-emerald-300">Current work</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Start, update, skim, or remove work directly</h2><p className="mt-2 max-w-2xl text-sm text-slate-400">Tasks are grouped by urgency. Detailed work happens in Start Work, not in a crowded table.</p></div><div className="grid grid-cols-2 gap-2 text-center"><div className="rounded-xl bg-slate-800/70 px-4 py-3"><p className="text-xl font-semibold text-slate-100">{open.length}</p><p className="text-xs text-slate-400">Open</p></div><div className="rounded-xl bg-slate-800/70 px-4 py-3"><p className="text-xl font-semibold text-amber-300">{formatMinutes(workload)}</p><p className="text-xs text-slate-400">Due this week</p></div></div></div></section>

    <form onSubmit={addTask} className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_170px_auto]"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add work, or type Course: assignment" className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100 placeholder:text-slate-500" /><select value={course} onChange={(event) => setCourse(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100"><option value="">Detect course</option>{activeCourses.map((item) => <option key={item.id} value={item.title}>{item.title}</option>)}</select><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100" /><button disabled={adding || !title.trim() || !currentTerm} className="rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">Add task</button></div></form>

    <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px_auto_auto]"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search current work" className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100 placeholder:text-slate-500" /><select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100"><option value="">All courses</option>{activeCourses.map((item) => <option key={item.id} value={item.title}>{item.title}</option>)}</select><button onClick={() => setShowCompleted((value) => !value)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">{showCompleted ? 'Hide completed' : 'Show completed'}</button><button onClick={toggleShowAll} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">{showAllTerms ? 'Current term only' : 'Include history'}</button></div></section>

    {error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}
    {loading ? <div className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading tasks…</div> : null}
    {!loading ? <div className="space-y-7">{sections.map(([key, heading, description]) => { const items = groups[key]; if (!items.length) return null; return <section key={key} className="space-y-3"><div className="flex items-end justify-between"><div><h2 className="text-lg font-semibold text-slate-100">{heading}</h2><p className="text-sm text-slate-500">{description}</p></div><span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{items.length}</span></div>{items.map((task) => <CurrentTaskCard key={task.id} task={task} courses={activeCourses} refresh={refresh} />)}</section>; })}</div> : null}
    {!loading && !filtered.length ? <section className="rounded-xl border border-dashed border-slate-700 p-8 text-center"><p className="font-medium text-slate-200">No work matches this view.</p><Link href="/wizard" className="mt-3 inline-flex rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Import syllabus</Link></section> : null}
    {showCompleted && groups.completed.length ? <details className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5"><summary className="cursor-pointer font-semibold text-slate-200">Completed tasks ({groups.completed.length})</summary><div className="mt-4 space-y-3">{groups.completed.map((task) => <CurrentTaskCard key={task.id} task={task} courses={activeCourses} refresh={refresh} />)}</div></details> : null}
    {groups.overdue.length ? <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-rose-200">Too much is overdue?</h2><p className="text-sm text-slate-400">Recovery Mode builds a realistic must-do, skim, defer, and drop plan.</p></div><Link href="/recovery" className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white">Open Recovery Mode</Link></div></section> : null}
  </main>;
}
