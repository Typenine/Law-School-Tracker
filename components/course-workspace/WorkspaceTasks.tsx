"use client";

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { taskKind } from '@/lib/courseWorkspace';
import { tasksClient } from '@/lib/tasksClient';
import type { Course, Task } from '@/lib/types';

function dueLabel(task: Task) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(task.dueDate));
}

export default function WorkspaceTasks({ course, currentTerm, openTasks, onChanged }: {
  course: Course;
  currentTerm: string | null;
  openTasks: Task[];
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'reading' | 'assignment' | 'outline' | 'practice'>('reading');
  const [due, setDue] = useState('');

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !due) return;
    await tasksClient.create({
      title: title.trim(),
      course: course.title,
      courseId: course.id,
      dueDate: new Date(`${due}T23:59:59`).toISOString(),
      status: 'todo',
      term: currentTerm,
      activity: type === 'assignment' ? 'other' : type,
    }, { silent: true });
    setTitle('');
    await onChanged();
  }

  return <div className="space-y-6">
    <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
      <div className="flex items-end justify-between gap-3"><div><h2 className="font-semibold text-slate-100">Open work</h2><p className="text-sm text-slate-400">Start work without leaving the course workspace.</p></div><Link href={`/tasks?course=${encodeURIComponent(course.title)}`} className="text-sm text-emerald-300">All tasks</Link></div>
      <div className="mt-3 space-y-2">{openTasks.slice(0, 8).map(task => <div key={task.id} className="flex items-start justify-between gap-4 rounded-lg bg-slate-950/40 p-3"><div><p className="text-sm font-medium text-slate-200">{task.title}</p><p className="mt-1 text-xs capitalize text-slate-500">{taskKind(task)} · due {dueLabel(task)}</p></div><Link href={`/work?task=${task.id}`} className="text-xs text-emerald-300">Start</Link></div>)}{!openTasks.length ? <p className="py-4 text-sm text-slate-500">No open tasks for this course.</p> : null}</div>
    </section>
    <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5"><h2 className="font-semibold text-slate-100">Quick add</h2><form onSubmit={addTask} className="mt-3 space-y-3"><input value={title} onChange={event => setTitle(event.target.value)} placeholder="Reading or assignment" className="w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100" /><div className="grid grid-cols-2 gap-2"><select value={type} onChange={event => setType(event.target.value as typeof type)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100"><option value="reading">Reading</option><option value="assignment">Assignment</option><option value="outline">Outline</option><option value="practice">Practice</option></select><input type="date" value={due} onChange={event => setDue(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100" /></div><button disabled={!title.trim() || !due} className="w-full rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 disabled:opacity-50">Add task</button></form></section>
  </div>;
}
