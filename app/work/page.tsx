"use client";

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { tasksClient } from '@/lib/tasksClient';
import { useTasks } from '@/lib/useTasks';

export default function WorkPage() {
  const taskId = useSearchParams().get('task') || '';
  const { tasks, loading, refresh } = useTasks();
  const task = tasks.find((item) => item.id === taskId) || null;
  const [active, setActive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [notes, setNotes] = useState('');
  const [pages, setPages] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!active) return;
    const handle = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(handle);
  }, [active]);

  async function save(done: boolean, skimmed = false) {
    if (!task) return;
    setActive(false);
    const minutes = Math.max(1, Math.round(seconds / 60));
    await apiFetch('/api/sessions', {
      method: 'POST',
      body: {
        taskId: task.id,
        when: new Date().toISOString(),
        minutes,
        notes: notes.trim() || (skimmed ? 'Strategic skim completed.' : null),
        pagesRead: pages ? Number(pages) : null,
        activity: task.activity || 'other',
      },
    });
    await tasksClient.update(task.id, {
      actualMinutes: (task.actualMinutes || 0) + minutes,
      pagesRead: pages ? (task.pagesRead || 0) + Number(pages) : task.pagesRead,
      notes: notes.trim() ? [task.notes, notes.trim()].filter(Boolean).join('\n\n') : task.notes,
      tags: Array.from(new Set([...(task.tags || []), ...(skimmed ? ['skimmed'] : [])])),
      ...(done ? { status: 'done', completedAt: new Date().toISOString() } : {}),
    }, { silent: true });
    setSeconds(0);
    setNotes('');
    setPages('');
    setMessage(done ? 'Completed and added to Study History.' : 'Progress saved.');
    await refresh();
  }

  if (loading) return <main className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading…</main>;
  if (!task) return <main><Link href="/tasks" className="text-emerald-300">Select a task from Tasks to begin.</Link></main>;

  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-2xl border border-emerald-500/30 bg-slate-950 p-6">
        <Link href="/tasks" className="text-sm text-slate-400">Back to Tasks</Link>
        <p className="mt-4 text-sm text-emerald-300">{task.course || 'General work'}</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-100">{task.title}</h2>
        <p className="mt-6 font-mono text-5xl text-slate-100">{time}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button onClick={() => setActive((value) => !value)} className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-slate-950">{active ? 'Pause' : seconds ? 'Resume' : 'Start'}</button>
          <button disabled={!seconds} onClick={() => save(false)} className="rounded-lg border border-slate-600 px-4 py-3 text-sm text-slate-200 disabled:opacity-50">Save progress</button>
          <button disabled={!seconds} onClick={() => save(true)} className="rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">Finish</button>
        </div>
      </section>

      {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}

      <section className="rounded-xl border border-slate-700 bg-slate-900/45 p-5">
        <label className="block text-sm text-slate-300">Pages completed<input type="number" min={0} value={pages} onChange={(event) => setPages(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /></label>
        <label className="mt-4 block text-sm text-slate-300">Notes<textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /></label>
        <button onClick={() => save(true, true)} className="mt-4 rounded-lg border border-amber-500/40 px-4 py-2 text-sm text-amber-300">Mark strategically skimmed</button>
      </section>
    </main>
  );
}
