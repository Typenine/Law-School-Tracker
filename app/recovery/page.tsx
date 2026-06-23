"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Task } from '@/lib/types';
import { useTasks } from '@/lib/useTasks';
import { useSemester } from '@/lib/useSemester';
import { tasksClient } from '@/lib/tasksClient';
import { taskKind } from '@/lib/courseWorkspace';

function daysUntil(value: string): number {
  const due = new Date(value);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  due.setHours(12, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / 86400000);
}

function minutes(task: Task): number {
  if (task.estimatedMinutes && task.estimatedMinutes > 0) return task.estimatedMinutes;
  const kind = taskKind(task);
  if (kind === 'reading') return Math.max(30, Math.min(180, (task.pagesRead || 20) * 3));
  if (kind === 'outline') return 45;
  if (kind === 'practice') return 75;
  if (kind === 'assignment') return 90;
  return 30;
}

function classify(task: Task): 'must' | 'skim' | 'defer' | 'drop' {
  const days = daysUntil(task.dueDate);
  const title = `${task.title} ${(task.tags || []).join(' ')}`.toLowerCase();
  const kind = taskKind(task);
  if (/(optional|extra credit|recommended only)/.test(title)) return 'drop';
  if (days <= 0) return 'must';
  if (days <= 1 && kind !== 'reading') return 'must';
  if (days <= 1 && kind === 'reading') return minutes(task) > 75 ? 'skim' : 'must';
  if (days <= 3 && kind === 'reading' && minutes(task) > 90) return 'skim';
  if (days <= 3 || task.priority === 1) return 'must';
  return 'defer';
}

function dueText(task: Task) {
  const days = daysUntil(task.dueDate);
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

export default function RecoveryPage() {
  const { tasks, loading, refresh } = useTasks();
  const { currentTerm, activeSemester } = useSemester();
  const [availableMinutes, setAvailableMinutes] = useState(180);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const open = useMemo(() => tasks
    .filter((task) => task.status !== 'done')
    .filter((task) => !currentTerm || task.term === currentTerm)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()), [tasks, currentTerm]);

  const grouped = useMemo(() => {
    const result: Record<'must' | 'skim' | 'defer' | 'drop', Task[]> = { must: [], skim: [], defer: [], drop: [] };
    for (const task of open) result[classify(task)].push(task);
    return result;
  }, [open]);

  const tonightPlan = useMemo(() => {
    const candidates = [...grouped.must, ...grouped.skim].sort((a, b) => {
      const due = daysUntil(a.dueDate) - daysUntil(b.dueDate);
      if (due) return due;
      return minutes(a) - minutes(b);
    });
    const selected: Array<{ task: Task; mode: 'complete' | 'skim'; plannedMinutes: number }> = [];
    let remaining = availableMinutes;
    for (const task of candidates) {
      if (remaining <= 0) break;
      const mode = classify(task) === 'skim' ? 'skim' : 'complete';
      const plannedMinutes = Math.min(remaining, mode === 'skim' ? Math.max(20, Math.round(minutes(task) * 0.45)) : minutes(task));
      if (plannedMinutes < 15 && selected.length) continue;
      selected.push({ task, mode, plannedMinutes });
      remaining -= plannedMinutes;
    }
    return { selected, remaining };
  }, [grouped, availableMinutes]);

  async function moveTask(task: Task, days: number) {
    setWorkingId(task.id);
    try {
      const due = new Date(task.dueDate);
      due.setDate(due.getDate() + days);
      await tasksClient.update(task.id, { dueDate: due.toISOString() }, { silent: true });
      await refresh();
    } finally {
      setWorkingId(null);
    }
  }

  async function complete(task: Task) {
    setWorkingId(task.id);
    try {
      await tasksClient.update(task.id, { status: 'done', completedAt: new Date().toISOString() }, { silent: true });
      await refresh();
    } finally {
      setWorkingId(null);
    }
  }

  function TaskCard({ task, category }: { task: Task; category: 'must' | 'skim' | 'defer' | 'drop' }) {
    const labels = { must: 'Must complete', skim: 'Skim strategically', defer: 'Can defer', drop: 'Can drop' };
    const tones = { must: 'text-rose-300 bg-rose-500/10', skim: 'text-amber-300 bg-amber-500/10', defer: 'text-sky-300 bg-sky-500/10', drop: 'text-slate-300 bg-slate-700/40' };
    return (
      <article className="rounded-xl border border-slate-700 bg-slate-950/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${tones[category]}`}>{labels[category]}</span>{task.course ? <span className="text-xs text-slate-500">{task.course}</span> : null}</div>
            <h3 className="mt-2 text-sm font-semibold text-slate-100">{task.title}</h3>
            <p className="mt-1 text-xs text-slate-500">{dueText(task)} · about {minutes(task)} minutes</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button disabled={workingId === task.id} onClick={() => moveTask(task, category === 'defer' ? 3 : 1)} className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">Move</button>
            <button disabled={workingId === task.id} onClick={() => complete(task)} className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50">Done</button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-rose-500/30 bg-gradient-to-br from-rose-950/40 to-slate-950 p-6">
        <p className="text-sm font-medium text-rose-300">Recovery mode</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-100">Get back under control without rebuilding the tracker</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">The planner separates what must be completed from what can be skimmed, deferred, or dropped. It uses the active semester, deadlines, task type, and estimated workload.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3"><label className="text-sm text-slate-300">Time available today</label><select value={availableMinutes} onChange={(event) => setAvailableMinutes(Number(event.target.value))} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"><option value={60}>1 hour</option><option value={90}>1.5 hours</option><option value={120}>2 hours</option><option value={180}>3 hours</option><option value={240}>4 hours</option><option value={360}>6 hours</option></select><span className="rounded-full bg-slate-800 px-3 py-2 text-xs text-slate-300">{activeSemester?.name || 'Active term'}</span></div>
      </section>

      {loading ? <div className="rounded-xl border border-slate-700 p-6 text-slate-400">Building recovery plan…</div> : null}

      {!loading ? (
        <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-semibold text-slate-100">Today’s realistic plan</h2><p className="text-sm text-slate-400">Complete these in order. Skim items are intentionally reduced.</p></div><span className="text-sm text-emerald-300">{availableMinutes - tonightPlan.remaining} of {availableMinutes} minutes planned</span></div>
          <div className="mt-4 space-y-2">
            {tonightPlan.selected.map(({ task, mode, plannedMinutes }, index) => <div key={task.id} className="flex items-start gap-3 rounded-lg bg-slate-950/45 p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-semibold text-slate-950">{index + 1}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-200">{task.title}</p><p className="mt-1 text-xs text-slate-500">{mode === 'skim' ? 'Skim for rules, holdings, and professor emphasis' : 'Complete'} · {plannedMinutes} minutes</p></div><Link href={`/tasks?text=${encodeURIComponent(task.title)}`} className="text-xs text-emerald-300">Open</Link></div>)}
            {!tonightPlan.selected.length ? <p className="py-4 text-sm text-slate-500">Nothing urgent is currently assigned to {activeSemester?.name || 'the active semester'}.</p> : null}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {(['must', 'skim', 'defer', 'drop'] as const).map((category) => (
          <section key={category} className="space-y-3">
            <div className="flex items-end justify-between"><div><h2 className="font-semibold capitalize text-slate-100">{category === 'must' ? 'Must complete' : category === 'skim' ? 'Skim strategically' : category === 'defer' ? 'Can defer' : 'Can drop'}</h2><p className="text-sm text-slate-500">{grouped[category].length} task{grouped[category].length === 1 ? '' : 's'}</p></div></div>
            {grouped[category].map((task) => <TaskCard key={task.id} task={task} category={category} />)}
            {!grouped[category].length ? <div className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">Nothing in this category.</div> : null}
          </section>
        ))}
      </div>
    </main>
  );
}
