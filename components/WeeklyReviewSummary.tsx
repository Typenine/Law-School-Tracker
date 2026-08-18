'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';

type Task = { id: string; title: string; course?: string | null; dueDate: string; workflowState?: string; atRisk?: boolean; blocked?: boolean; remainingMinutes?: number };
type Session = { when: string; minutes: number; taskId?: string | null; focus?: number | null };
type Workspace = { tasks: Task[] };

function startOfWeek() {
  const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d;
}
function fmtMin(value: number) {
  const n = Math.max(0, Math.round(value)); const h = Math.floor(n/60), m = n%60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

export default function WeeklyReviewSummary() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [planned, setPlanned] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [workspace, sessionData, schedule] = await Promise.all([
          apiFetch<Workspace>('/api/tasks/workspace'),
          apiFetch<{ sessions: Session[] }>('/api/sessions'),
          apiFetch<{ blocks: Array<{ day: string; plannedMinutes: number }> }>('/api/schedule'),
        ]);
        if (cancelled) return;
        const start = startOfWeek();
        setTasks(workspace.tasks || []);
        setSessions((sessionData.sessions || []).filter(s => new Date(s.when) >= start));
        setPlanned((schedule.blocks || []).filter(b => new Date(`${b.day}T12:00:00`) >= start).reduce((sum,b) => sum + Math.max(0, Number(b.plannedMinutes)||0), 0));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const review = useMemo(() => {
    const actual = sessions.reduce((sum, s) => sum + Math.max(0, Number(s.minutes)||0), 0);
    const focus = sessions.map(s => Number(s.focus)).filter(n => n > 0);
    const avgFocus = focus.length ? focus.reduce((a,b) => a+b,0)/focus.length : 0;
    const done = tasks.filter(t => t.workflowState === 'done').length;
    const risks = tasks.filter(t => t.atRisk && !['done','canceled'].includes(t.workflowState || '')).length;
    const blocked = tasks.filter(t => t.blocked && !['done','canceled'].includes(t.workflowState || '')).length;
    const remaining = tasks.filter(t => !['done','canceled'].includes(t.workflowState || '')).reduce((sum,t) => sum + Math.max(0, Number(t.remainingMinutes)||0), 0);
    const headline = actual === 0
      ? 'No study time has been logged yet this week.'
      : planned > 0 && actual >= planned
        ? `You have logged ${fmtMin(actual)}, meeting or exceeding the ${fmtMin(planned)} currently planned.`
        : planned > 0
          ? `You have logged ${fmtMin(actual)} of ${fmtMin(planned)} currently planned.`
          : `You have logged ${fmtMin(actual)} this week.`;
    const workload = risks || blocked
      ? `${risks ? `${risks} task${risks === 1 ? '' : 's'} at risk` : 'No tasks at risk'}${blocked ? ` and ${blocked} blocked` : ''}. About ${fmtMin(remaining)} of open work remains.`
      : `No active task is currently flagged at risk or blocked. About ${fmtMin(remaining)} of open work remains.`;
    const quality = avgFocus ? `Average logged focus is ${avgFocus.toFixed(1)}/10 across ${sessions.length} session${sessions.length === 1 ? '' : 's'}.` : `${sessions.length} session${sessions.length === 1 ? '' : 's'} logged; add focus scores to track study quality.`;
    return { actual, done, risks, blocked, headline, workload, quality };
  }, [sessions, tasks, planned]);

  if (loading) return <section className="card p-4 mb-5 text-sm text-slate-400">Building weekly review…</section>;
  return <section className="card p-5 mb-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Weekly review</div><h2 className="mt-1 text-xl font-medium">What the week says so far</h2></div><Link href="/week-plan" className="text-xs">Adjust week plan →</Link></div>
    <div className="mt-4 grid gap-3 lg:grid-cols-3 text-sm">
      <div className="rounded border border-white/10 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">Pace</div><p className="mt-1 text-slate-300">{review.headline}</p></div>
      <div className="rounded border border-white/10 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">Workload</div><p className="mt-1 text-slate-300">{review.workload}</p></div>
      <div className="rounded border border-white/10 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">Study quality</div><p className="mt-1 text-slate-300">{review.quality}</p></div>
    </div>
  </section>;
}
