"use client";

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { tasksClient } from '@/lib/tasksClient';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';
import type { Task } from '@/lib/types';

function ymd(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return ymd(date);
}

function dueLabel(task: Task) {
  const due = ymd(task.dueDate);
  const today = addDays(0);
  if (due < today) return 'Overdue';
  if (due === today) return 'Today';
  if (due === addDays(1)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(task.dueDate));
}

function estimate(task: Task) {
  if (task.estimatedMinutes && task.estimatedMinutes > 0) return task.estimatedMinutes;
  if (task.activity === 'reading') return Math.max(30, Math.min(180, (task.pagesRead || 20) * 3));
  if (task.activity === 'practice') return 75;
  if (task.activity === 'outline') return 45;
  return 30;
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function TaskCard({ task, courses, refresh }: { task: Task; courses: string[]; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [course, setCourse] = useState(task.course || '');
  const [dueDate, setDueDate] = useState(ymd(task.dueDate));

  async function complete() {
    setWorking(true);
    try {
      await tasksClient.update(task.id, {
        status: task.status === 'done' ? 'todo' : 'done',
        completedAt: task.status === 'done' ? null : new Date().toISOString(),
      }, { silent: true });
      await refresh();
    } finally {
      setWorking(false);
    }
  }

  async function moveTomorrow() {
    setWorking(true);
    try {
      const due = new Date();
      due.setDate(due.getDate() + 1);
      due.setHours(23, 59, 59, 999);
      await tasksClient.update(task.id, { dueDate: due.toISOString() }, { silent: true });
      await refresh();
    } finally {
      setWorking(false);
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !dueDate) return;
    setWorking(true);
    try {
      await tasksClient.update(task.id, {
        title: title.trim(),
        course: course || null,
        dueDate: new Date(`${dueDate}T23:59:59`).toISOString(),
      }, { silent: true });
      setEditing(false);
      await refresh();
    } finally {
      setWorking(false);
    }
  }

  const overdue = task.status !== 'done' && ymd(task.dueDate) < addDays(0);

  return (
    <article className={`rounded-xl border p-4 ${task.status === 'done' ? 'border-slate-800 bg-slate-950/25 opacity-70' : overdue ? 'border-rose-500/35 bg-rose-500/5' : 'border-slate-700 bg-slate-900/45'}`}>
      {editing ? (
        <form onSubmit={saveEdit} className="space-y-3">
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" />
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={course} onChange={(event) => setCourse(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"><option value="">No course</option>{courses.map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" />
          </div>
          <div className="flex gap-2"><button disabled={working} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Save</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Cancel</button></div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {task.course ? <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-300">{task.course}</span> : null}
              <span className={`rounded-full px-2.5 py-1 font-medium ${overdue ? 'bg-rose-500/15 text-rose-300' : 'bg-slate-800 text-slate-300'}`}>{dueLabel(task)}</span>
              <span className="capitalize text-slate-500">{task.activity || 'task'}</span>
            </div>
            <h3 className={`mt-2 font-semibold ${task.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{task.title}</h3>
            <p className="mt-1 text-xs text-slate-500">About {formatMinutes(estimate(task))}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {task.status !== 'done' ? <button disabled={working} onClick={moveTomorrow} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">Tomorrow</button> : null}
            <button disabled={working} onClick={() => setEditing(true)} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">Edit</button>
            <button disabled={working} onClick={complete} className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50 ${task.status === 'done' ? 'border border-slate-600 text-slate-200' : 'bg-emerald-500 text-slate-950'}`}>{task.status === 'done' ? 'Reopen' : 'Complete'}</button>
          </div>
        </div>
      )}
    </article>
  );
}

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
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setCourseFilter(params.get('course') || '');
    setSearch(params.get('text') || '');
  }, []);

  const activeCourses = useMemo(() => activeSemester ? courses.filter((item) => item.semester === activeSemester.season && item.year === activeSemester.year) : courses, [courses, activeSemester]);
  const courseNames = activeCourses.map((item) => item.title).sort();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks
      .filter((task) => showAllTerms || !currentTerm || task.term === currentTerm)
      .filter((task) => showCompleted || task.status !== 'done')
      .filter((task) => !courseFilter || (task.course || '') === courseFilter)
      .filter((task) => !query || `${task.title} ${task.course || ''} ${task.notes || ''}`.toLowerCase().includes(query))
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [tasks, currentTerm, showAllTerms, showCompleted, courseFilter, search]);

  const groups = useMemo(() => {
    const today = addDays(0);
    const week = addDays(7);
    return {
      overdue: filtered.filter((task) => task.status !== 'done' && ymd(task.dueDate) < today),
      today: filtered.filter((task) => task.status !== 'done' && ymd(task.dueDate) === today),
      week: filtered.filter((task) => task.status !== 'done' && ymd(task.dueDate) > today && ymd(task.dueDate) <= week),
      later: filtered.filter((task) => task.status !== 'done' && ymd(task.dueDate) > week),
      completed: filtered.filter((task) => task.status === 'done'),
    };
  }, [filtered]);

  const openCount = filtered.filter((task) => task.status !== 'done').length;
  const workload = filtered.filter((task) => task.status !== 'done' && ymd(task.dueDate) <= addDays(7)).reduce((sum, task) => sum + estimate(task), 0);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !dueDate || !currentTerm) return;
    setAdding(true);
    try {
      await tasksClient.create({ title: title.trim(), course: course || null, dueDate: new Date(`${dueDate}T23:59:59`).toISOString(), status: 'todo', term: currentTerm }, { silent: true });
      setTitle('');
      await refresh();
    } finally {
      setAdding(false);
    }
  }

  const sections: Array<{ key: keyof typeof groups; title: string; description: string }> = [
    { key: 'overdue', title: 'Overdue', description: 'Complete, move, or use Recovery Mode.' },
    { key: 'today', title: 'Today', description: 'Work that must move today.' },
    { key: 'week', title: 'Next seven days', description: 'The work shaping this week.' },
    { key: 'later', title: 'Later', description: 'Future work that does not need attention yet.' },
  ];

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="text-sm font-medium text-emerald-300">Current work</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Tasks without the control-panel clutter</h2><p className="mt-2 max-w-2xl text-sm text-slate-400">Current work is grouped by urgency. Estimates, priority, and task type are inferred where possible instead of requiring manual setup.</p></div><div className="grid grid-cols-2 gap-2 text-center"><div className="rounded-xl bg-slate-800/70 px-4 py-3"><p className="text-xl font-semibold text-slate-100">{openCount}</p><p className="text-xs text-slate-400">Open</p></div><div className="rounded-xl bg-slate-800/70 px-4 py-3"><p className="text-xl font-semibold text-amber-300">{formatMinutes(workload)}</p><p className="text-xs text-slate-400">Due this week</p></div></div></div>
      </section>

      <form onSubmit={addTask} className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_170px_auto]"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a reading, assignment, or follow-up" className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100 placeholder:text-slate-500" /><select value={course} onChange={(event) => setCourse(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100"><option value="">No course</option>{courseNames.map((name) => <option key={name} value={name}>{name}</option>)}</select><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100" /><button disabled={adding || !title.trim() || !currentTerm} className="rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">Add task</button></div>
      </form>

      <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px_auto_auto]"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search current work" className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100 placeholder:text-slate-500" /><select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100"><option value="">All courses</option>{courseNames.map((name) => <option key={name} value={name}>{name}</option>)}</select><button onClick={() => setShowCompleted((value) => !value)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">{showCompleted ? 'Hide completed' : 'Show completed'}</button><button onClick={toggleShowAll} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">{showAllTerms ? 'Current term only' : 'Include history'}</button></div>
      </section>

      {error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}
      {loading ? <div className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading tasks…</div> : null}

      {!loading ? <div className="space-y-7">{sections.map((section) => {
        const items = groups[section.key];
        if (!items.length) return null;
        return <section key={section.key} className="space-y-3"><div className="flex items-end justify-between"><div><h2 className="text-lg font-semibold text-slate-100">{section.title}</h2><p className="text-sm text-slate-500">{section.description}</p></div><span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{items.length}</span></div>{items.map((task) => <TaskCard key={task.id} task={task} courses={courseNames} refresh={refresh} />)}</section>;
      })}</div> : null}

      {!loading && !filtered.length ? <section className="rounded-xl border border-dashed border-slate-700 p-8 text-center"><p className="font-medium text-slate-200">No work matches this view.</p><p className="mt-1 text-sm text-slate-500">Import a syllabus or add the next assignment above.</p><Link href="/wizard" className="mt-3 inline-flex rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Import syllabus</Link></section> : null}

      {showCompleted && groups.completed.length ? <details className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5"><summary className="cursor-pointer font-semibold text-slate-200">Completed tasks ({groups.completed.length})</summary><div className="mt-4 space-y-3">{groups.completed.map((task) => <TaskCard key={task.id} task={task} courses={courseNames} refresh={refresh} />)}</div></details> : null}

      {groups.overdue.length ? <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-rose-200">Too much is overdue?</h2><p className="text-sm text-slate-400">Recovery Mode builds a realistic must-do, skim, defer, and drop plan.</p></div><Link href="/recovery" className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white">Open Recovery Mode</Link></div></section> : null}
    </main>
  );
}
