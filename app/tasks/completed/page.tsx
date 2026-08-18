"use client";

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Task } from '@/lib/types';
import { apiFetch } from '@/lib/apiClient';
import { notifyTasksChanged } from '@/lib/taskBus';
import { notifyToast } from '@/lib/toastBus';

type CompletedTask = Task & {
  workflowState?: string;
  loggedMinutes?: number;
};

type WorkspaceResponse = {
  tasks: CompletedTask[];
};

function fmtMinutes(value: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function completedLabel(value?: string | null): string {
  if (!value) return 'Completion date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function CompletedTasksPage() {
  const [tasks, setTasks] = useState<CompletedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [course, setCourse] = useState('');
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<WorkspaceResponse>('/api/tasks/workspace?allTerms=true');
      const completed = (data.tasks || [])
        .filter(task => task.status === 'done' || task.workflowState === 'done')
        .sort((a, b) => +new Date(b.completedAt || 0) - +new Date(a.completedAt || 0));
      setTasks(completed);
    } catch (e: any) {
      setError(e?.message || 'Unable to load completed tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const courses = useMemo(() => Array.from(new Set(tasks.map(task => task.course || 'Unassigned'))).sort(), [tasks]);
  const visible = useMemo(() => tasks.filter(task => {
    if (course && (task.course || 'Unassigned') !== course) return false;
    if (query) {
      const haystack = `${task.title} ${task.course || ''} ${task.activity || ''}`.toLowerCase();
      if (!haystack.includes(query.toLowerCase())) return false;
    }
    return true;
  }), [tasks, course, query]);

  async function reopen(task: CompletedTask) {
    try {
      await apiFetch(`/api/tasks/${task.id}/reopen`, { method: 'POST', body: {} });
      notifyToast({ kind: 'success', message: 'Task reopened.' });
      notifyTasksChanged();
      await refresh();
    } catch (e: any) {
      notifyToast({ kind: 'error', message: e?.message || 'Unable to reopen task.' });
    }
  }

  return (
    <main className="space-y-4">
      <section className="card p-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <Link href="/tasks" className="text-xs text-slate-400 hover:underline">&larr; Task workspace</Link>
          <h1 className="text-2xl font-semibold mt-2">Completed tasks</h1>
          <p className="text-sm text-slate-400 mt-1">Finished work is kept here with the date it was completed and the time you actually logged.</p>
        </div>
        <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-4 py-3 min-w-32">
          <div className="text-[10px] uppercase tracking-wider text-emerald-300/70">Completed</div>
          <div className="text-2xl font-medium mt-1">{tasks.length}</div>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_auto] gap-2">
          <select value={course} onChange={e => setCourse(e.target.value)} className="px-3 py-2">
            <option value="">All courses</option>
            {courses.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search completed tasks…" className="px-3 py-2" />
          <button onClick={refresh} className="px-3 py-2 rounded border border-white/10">Refresh</button>
        </div>

        {error && <div className="rounded border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-300">{error}</div>}
        {loading ? <div className="p-8 text-center text-sm text-slate-400">Loading completed work…</div> : !visible.length ? <div className="p-8 text-center text-sm text-slate-400">No completed tasks match this view.</div> : (
          <div className="space-y-2">
            {visible.map(task => {
              const actual = task.actualMinutes ?? task.loggedMinutes ?? 0;
              return (
                <article key={task.id} className="rounded-lg border border-white/10 bg-white/[0.015] p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium">{task.title}</h2>
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-700/50 text-emerald-300 bg-emerald-950/30">Done</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{task.course || 'Unassigned'}{task.activity ? ` · ${task.activity}` : ''}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-5 text-sm">
                    <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Finished</div><div className="mt-1">{completedLabel(task.completedAt)}</div></div>
                    <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Actual time</div><div className="mt-1">{fmtMinutes(actual)}</div></div>
                    <button onClick={() => void reopen(task)} className="px-3 py-2 rounded border border-white/10 text-xs">Reopen</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
