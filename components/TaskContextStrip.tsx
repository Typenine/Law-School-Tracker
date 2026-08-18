'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { onTasksChanged } from '@/lib/taskBus';
import { onScheduleChanged } from '@/lib/scheduleBus';

type Task = {
  id: string; title: string; workflowState?: string; blocked?: boolean; atRisk?: boolean;
  blockedBy?: Array<{ id: string; title: string }>; scheduleBlocks?: Array<{ day: string; plannedMinutes: number }>;
};
type Workspace = { tasks: Task[]; summary?: { open?: number; blocked?: number; atRisk?: number } };

function ymd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export default function TaskContextStrip({ mode }: { mode: 'today' | 'calendar' | 'week' }) {
  const [workspace, setWorkspace] = useState<Workspace>({ tasks: [] });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/tasks/workspace', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setWorkspace(data);
      } catch {}
    };
    void load();
    const offTasks = onTasksChanged(() => { void load(); });
    const offSchedule = onScheduleChanged(() => { void load(); });
    return () => { cancelled = true; offTasks(); offSchedule(); };
  }, []);

  const active = useMemo(() => workspace.tasks.filter(task => !['done','canceled'].includes(task.workflowState || '')), [workspace.tasks]);
  const risk = active.filter(task => task.atRisk);
  const blocked = active.filter(task => task.blocked);
  const today = ymd();
  const scheduledToday = active.filter(task => (task.scheduleBlocks || []).some(block => block.day === today));
  const firstBlocked = blocked[0];
  const firstRisk = risk[0];

  if (!active.length && !risk.length && !blocked.length) return null;

  const scheduledLabel = mode === 'today' ? `${scheduledToday.length} scheduled` : `${active.length} open`;
  return <section className="mb-4 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2.5" aria-label="Task status summary">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <span className="text-slate-300">{scheduledLabel}</span>
      <Link href="/tasks?view=at-risk" className={risk.length ? 'text-amber-300' : 'text-slate-500'}>{risk.length} at risk</Link>
      <Link href="/tasks?view=blocked" className={blocked.length ? 'text-rose-300' : 'text-slate-500'}>{blocked.length} blocked</Link>
      {firstBlocked?.blockedBy?.[0] ? <span className="text-slate-500">waiting on <Link href={`?taskId=${encodeURIComponent(firstBlocked.blockedBy[0].id)}`} className="text-slate-300">{firstBlocked.blockedBy[0].title}</Link></span> : null}
      {!blocked.length && firstRisk ? <span className="text-slate-500">next risk: <Link href={`?taskId=${encodeURIComponent(firstRisk.id)}`} className="text-slate-300">{firstRisk.title}</Link></span> : null}
    </div>
  </section>;
}
