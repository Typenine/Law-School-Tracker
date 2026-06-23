"use client";

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { tasksClient } from '@/lib/tasksClient';
import type { Course, Task } from '@/lib/types';

function dateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function todayKey() { return dateKey(new Date().toISOString()); }
function dueText(task: Task) {
  const due = dateKey(task.dueDate);
  if (due < todayKey()) return 'Overdue';
  if (due === todayKey()) return 'Today';
  return new Date(task.dueDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function CurrentTaskCard({ task, courses, refresh }: { task: Task; courses: Course[]; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [course, setCourse] = useState(task.course || '');
  const [dueDate, setDueDate] = useState(dateKey(task.dueDate));
  const courseRecord = courses.find((item) => item.title === task.course);
  const overdue = task.status !== 'done' && dateKey(task.dueDate) < todayKey();

  async function update(patch: any) {
    setWorking(true);
    try { await tasksClient.update(task.id, patch, { silent: true }); await refresh(); }
    finally { setWorking(false); }
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    await update({ title: title.trim(), course: course || null, dueDate: new Date(`${dueDate}T23:59:59`).toISOString() });
    setEditing(false);
  }
  async function remove() {
    if (!window.confirm(`Delete “${task.title}”?`)) return;
    setWorking(true);
    try { await tasksClient.remove(task.id, { silent: true }); await refresh(); }
    finally { setWorking(false); }
  }
  async function tomorrow() {
    const due = new Date();
    due.setDate(due.getDate() + 1);
    due.setHours(23, 59, 59, 999);
    await update({ dueDate: due.toISOString() });
  }

  return <article className={`rounded-xl border p-4 ${task.status === 'done' ? 'border-slate-800 bg-slate-950/25 opacity-70' : overdue ? 'border-rose-500/35 bg-rose-500/5' : 'border-slate-700 bg-slate-900/45'}`}>
    {editing ? <form onSubmit={saveEdit} className="space-y-3"><input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /><div className="grid gap-2 sm:grid-cols-2"><select value={course} onChange={(event) => setCourse(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"><option value="">No course</option>{courses.map((item) => <option key={item.id} value={item.title}>{item.title}</option>)}</select><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /></div><div className="flex gap-2"><button disabled={working} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950">Save</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Cancel</button></div></form> : <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><div className="flex flex-wrap items-center gap-2 text-xs">{task.course ? <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">{task.course}</span> : null}<span className={overdue ? 'text-rose-300' : 'text-slate-500'}>{dueText(task)}</span><span className="capitalize text-slate-500">{task.activity || 'task'}</span>{task.tags?.includes('skimmed') ? <span className="text-amber-300">Skimmed</span> : null}</div><h3 className={`mt-2 font-semibold ${task.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{task.title}</h3></div>
      <div className="flex flex-wrap gap-2">{task.status !== 'done' ? <Link href={`/work?task=${task.id}`} className="rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950">Start</Link> : null}{task.status !== 'done' ? <button disabled={working} onClick={tomorrow} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200">Tomorrow</button> : null}<button disabled={working} onClick={() => update({ status: task.status === 'done' ? 'todo' : 'done', completedAt: task.status === 'done' ? null : new Date().toISOString() })} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950">{task.status === 'done' ? 'Reopen' : 'Complete'}</button><details className="relative"><summary className="cursor-pointer list-none rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200">More</summary><div className="absolute right-0 z-20 mt-2 w-36 rounded-lg border border-slate-700 bg-slate-950 p-1"><button onClick={() => setEditing(true)} className="block w-full rounded px-2 py-2 text-left text-xs text-slate-200">Edit</button>{courseRecord ? <Link href={`/courses/${courseRecord.id}`} className="block rounded px-2 py-2 text-xs text-slate-200">Course files</Link> : null}{task.status !== 'done' ? <button onClick={() => update({ status: 'done', completedAt: new Date().toISOString(), tags: Array.from(new Set([...(task.tags || []), 'skimmed'])) })} className="block w-full rounded px-2 py-2 text-left text-xs text-amber-300">Mark skimmed</button> : null}<button onClick={remove} className="block w-full rounded px-2 py-2 text-left text-xs text-rose-300">Delete</button></div></details></div>
    </div>}
  </article>;
}
