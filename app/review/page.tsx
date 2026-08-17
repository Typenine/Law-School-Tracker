"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { useCourses } from '@/lib/useCourses';
import { useSessions } from '@/lib/useSessions';
import { useSchedule } from '@/lib/useSchedule';
import type { Course, StudySession, Task } from '@/lib/types';

type WorkspaceTask = Task & {
  workflowState?: 'not-started' | 'in-progress' | 'done' | 'canceled';
  displayState?: string;
  blocked?: boolean;
  atRisk?: boolean;
  atRiskReason?: string | null;
  loggedMinutes?: number;
  remainingMinutes?: number;
  percentComplete?: number;
  sessionCount?: number;
  averageFocus?: number | null;
  reading?: { assignedPages?: number; completedPages?: number; remainingPages?: number; percentComplete?: number; paceMinutesPerPage?: number | null } | null;
};

type Workspace = { tasks: WorkspaceTask[]; summary?: Record<string, number>; activeTerm?: string | null };

type Period = '7d' | '14d' | '30d' | '90d' | 'semester' | 'all';

function chicagoYmd(value: Date | string) {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function fmtMin(value: number) {
  const n = Math.max(0, Math.round(value || 0));
  const h = Math.floor(n / 60), m = n % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}
function pct(value: number) { return `${Math.round(value)}%`; }
function startOfWeek(date = new Date()) {
  const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d;
}
function weekKey(value: Date | string) { return chicagoYmd(startOfWeek(typeof value === 'string' ? new Date(value) : value)); }
function sessionCourse(session: StudySession, tasks: Map<string, WorkspaceTask>) {
  const task = session.taskId ? tasks.get(String(session.taskId)) : null;
  return (task?.course || '').trim() || 'Unassigned';
}

export default function ReviewPage() {
  const { sessions, loading: sessionsLoading } = useSessions();
  const { courses, loading: coursesLoading } = useCourses();
  const { blocks, loading: scheduleLoading } = useSchedule();
  const [workspace, setWorkspace] = useState<Workspace>({ tasks: [] });
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('30d');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWorkspaceLoading(true);
      try {
        const data = await apiFetch<Workspace>('/api/tasks/workspace?allTerms=true');
        if (!cancelled) setWorkspace(data);
      } finally { if (!cancelled) setWorkspaceLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const loading = sessionsLoading || coursesLoading || scheduleLoading || workspaceLoading;
  const taskMap = useMemo(() => new Map(workspace.tasks.map(task => [String(task.id), task])), [workspace.tasks]);
  const currentCourses = useMemo(() => {
    const today = chicagoYmd(new Date());
    return courses.filter(course => {
      if (course.startDate && chicagoYmd(course.startDate) > today) return false;
      if (course.endDate && chicagoYmd(course.endDate) < today) return false;
      return true;
    });
  }, [courses]);

  const cutoff = useMemo(() => {
    if (period === 'all') return null;
    if (period === 'semester') {
      const starts = currentCourses.map(c => c.startDate).filter(Boolean).map(String).sort();
      return starts.length ? new Date(starts[0]) : null;
    }
    const days = period === '7d' ? 7 : period === '14d' ? 14 : period === '30d' ? 30 : 90;
    const d = new Date(); d.setDate(d.getDate() - days); return d;
  }, [period, currentCourses]);

  const filteredSessions = useMemo(() => sessions.filter(session => !cutoff || new Date(session.when) >= cutoff), [sessions, cutoff]);
  const filteredTaskIds = useMemo(() => new Set(filteredSessions.map(s => String(s.taskId || '')).filter(Boolean)), [filteredSessions]);

  const summary = useMemo(() => {
    const totalMinutes = filteredSessions.reduce((sum, s) => sum + Math.max(0, Number(s.minutes) || 0), 0);
    const pages = filteredSessions.reduce((sum, s) => sum + Math.max(0, Number(s.pagesRead) || 0), 0);
    const practice = filteredSessions.reduce((sum, s) => sum + Math.max(0, Number(s.practiceQs) || 0), 0);
    const focus = filteredSessions.map(s => Number(s.focus)).filter(n => n > 0);
    const done = workspace.tasks.filter(t => t.workflowState === 'done' && (filteredTaskIds.has(String(t.id)) || !cutoff || new Date(t.completedAt || t.dueDate) >= cutoff));
    const relevant = workspace.tasks.filter(t => t.workflowState !== 'canceled' && (filteredTaskIds.has(String(t.id)) || !cutoff || new Date(t.dueDate) >= cutoff));
    return {
      totalMinutes, pages, practice,
      sessions: filteredSessions.length,
      avgFocus: focus.length ? focus.reduce((a, b) => a + b, 0) / focus.length : 0,
      completionRate: relevant.length ? (done.length / relevant.length) * 100 : 0,
    };
  }, [filteredSessions, workspace.tasks, filteredTaskIds, cutoff]);

  const thisWeek = useMemo(() => {
    const start = startOfWeek();
    const actual = sessions.filter(s => new Date(s.when) >= start).reduce((sum, s) => sum + Math.max(0, Number(s.minutes) || 0), 0);
    const planned = blocks.filter(b => new Date(`${b.day}T12:00:00`) >= start).reduce((sum, b) => sum + Math.max(0, Number(b.plannedMinutes) || 0), 0);
    return { actual, planned, variance: actual - planned };
  }, [sessions, blocks]);

  const estimateAccuracy = useMemo(() => {
    const rows = workspace.tasks.filter(t => t.workflowState === 'done' && Number(t.estimatedMinutes) > 0);
    const data = rows.map(task => {
      const actual = Number(task.actualMinutes) > 0 ? Number(task.actualMinutes) : sessions.filter(s => String(s.taskId || '') === String(task.id)).reduce((sum, s) => sum + Math.max(0, Number(s.minutes) || 0), 0);
      return actual > 0 ? { task, actual, estimated: Number(task.estimatedMinutes) } : null;
    }).filter(Boolean) as Array<{ task: WorkspaceTask; actual: number; estimated: number }>;
    if (!data.length) return { averageError: 0, sample: 0, rows: [] as typeof data };
    const averageError = data.reduce((sum, row) => sum + Math.abs(row.actual - row.estimated) / Math.max(1, row.estimated), 0) / data.length * 100;
    return { averageError, sample: data.length, rows: data.sort((a, b) => Math.abs(b.actual - b.estimated) - Math.abs(a.actual - a.estimated)).slice(0, 5) };
  }, [workspace.tasks, sessions]);

  const byCourse = useMemo(() => {
    const map = new Map<string, { minutes: number; pages: number; sessions: number; focus: number[]; practice: number }>();
    for (const s of filteredSessions) {
      const course = sessionCourse(s, taskMap);
      const row = map.get(course) || { minutes: 0, pages: 0, sessions: 0, focus: [], practice: 0 };
      row.minutes += Math.max(0, Number(s.minutes) || 0);
      row.pages += Math.max(0, Number(s.pagesRead) || 0);
      row.practice += Math.max(0, Number(s.practiceQs) || 0);
      row.sessions += 1;
      if (Number(s.focus) > 0) row.focus.push(Number(s.focus));
      map.set(course, row);
    }
    return Array.from(map.entries()).map(([course, row]) => ({
      course, ...row,
      avgFocus: row.focus.length ? row.focus.reduce((a, b) => a + b, 0) / row.focus.length : 0,
      mpp: row.pages ? row.minutes / row.pages : 0,
      share: summary.totalMinutes ? row.minutes / summary.totalMinutes * 100 : 0,
    })).sort((a, b) => b.minutes - a.minutes);
  }, [filteredSessions, taskMap, summary.totalMinutes]);

  const activeCourseMap = useMemo(() => new Map(currentCourses.map(course => [course.title.toLowerCase(), course])), [currentCourses]);
  const neglected = useMemo(() => {
    const last14 = new Date(); last14.setDate(last14.getDate() - 14);
    return currentCourses.map(course => {
      const taskIds = new Set(workspace.tasks.filter(t => t.courseId === course.id || (t.course || '').toLowerCase() === course.title.toLowerCase()).map(t => String(t.id)));
      const minutes = sessions.filter(s => s.taskId && taskIds.has(String(s.taskId)) && new Date(s.when) >= last14).reduce((sum, s) => sum + Math.max(0, Number(s.minutes) || 0), 0);
      const open = workspace.tasks.filter(t => (t.courseId === course.id || (t.course || '').toLowerCase() === course.title.toLowerCase()) && !['done', 'canceled'].includes(t.workflowState || '')).length;
      return { course, minutes, open };
    }).filter(item => item.open > 0).sort((a, b) => a.minutes - b.minutes).slice(0, 4);
  }, [currentCourses, workspace.tasks, sessions]);

  const focusByHour = useMemo(() => {
    const buckets = new Map<number, number[]>();
    for (const s of filteredSessions) {
      const focus = Number(s.focus);
      if (!(focus > 0)) continue;
      const hour = new Date(s.when).getHours();
      const arr = buckets.get(hour) || []; arr.push(focus); buckets.set(hour, arr);
    }
    return Array.from(buckets.entries()).map(([hour, values]) => ({ hour, focus: values.reduce((a, b) => a + b, 0) / values.length, count: values.length })).sort((a, b) => b.focus - a.focus);
  }, [filteredSessions]);

  const weekly = useMemo(() => {
    const keys: string[] = [];
    const start = startOfWeek();
    for (let i = 7; i >= 0; i--) { const d = new Date(start); d.setDate(d.getDate() - i * 7); keys.push(chicagoYmd(d)); }
    const map = new Map(keys.map(key => [key, 0]));
    for (const s of sessions) { const key = weekKey(s.when); if (map.has(key)) map.set(key, (map.get(key) || 0) + Math.max(0, Number(s.minutes) || 0)); }
    return keys.map(key => ({ key, minutes: map.get(key) || 0 }));
  }, [sessions]);
  const weeklyMax = Math.max(1, ...weekly.map(item => item.minutes));

  const risks = useMemo(() => workspace.tasks.filter(t => t.atRisk && !['done', 'canceled'].includes(t.workflowState || '')).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 6), [workspace.tasks]);

  if (loading) return <div className="p-6 text-slate-400">Loading performance data…</div>;

  return (
    <main className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium">Performance analytics</h2>
          <p className="text-sm text-slate-400 mt-1">Actual work, plan accuracy, course balance, pace, focus, and risk.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['7d','14d','30d','90d','semester','all'] as Period[]).map(value => <button key={value} onClick={() => setPeriod(value)} className={`px-3 py-1.5 rounded border text-xs ${period === value ? 'border-[#ffcc00] text-[#ffcc00]' : 'border-white/10 text-slate-300'}`}>{value === 'semester' ? 'Semester' : value === 'all' ? 'All time' : value}</button>)}
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Metric label="Study time" value={fmtMin(summary.totalMinutes)} />
        <Metric label="Sessions" value={String(summary.sessions)} />
        <Metric label="Pages" value={String(summary.pages)} />
        <Metric label="Practice Qs" value={String(summary.practice)} />
        <Metric label="Avg focus" value={summary.avgFocus ? `${summary.avgFocus.toFixed(1)}/10` : '—'} />
        <Metric label="Completion" value={summary.completionRate ? pct(summary.completionRate) : '—'} />
      </section>

      <section className="grid lg:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">This week: planned vs actual</div>
          <div className="mt-3 flex items-end gap-5"><div><div className="text-2xl font-medium">{fmtMin(thisWeek.actual)}</div><div className="text-xs text-slate-400">actual</div></div><div><div className="text-xl">{fmtMin(thisWeek.planned)}</div><div className="text-xs text-slate-400">planned</div></div></div>
          <div className={`mt-3 text-sm ${thisWeek.variance >= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>{thisWeek.variance >= 0 ? '+' : ''}{fmtMin(Math.abs(thisWeek.variance))} {thisWeek.variance >= 0 ? 'above plan' : 'behind plan'}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Estimate accuracy</div>
          <div className="mt-3 text-2xl font-medium">{estimateAccuracy.sample ? `${estimateAccuracy.averageError.toFixed(0)}%` : '—'}</div>
          <div className="text-xs text-slate-400 mt-1">mean absolute error · {estimateAccuracy.sample} completed task{estimateAccuracy.sample === 1 ? '' : 's'}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Risk right now</div>
          <div className="mt-3 text-2xl font-medium">{risks.length}</div>
          <div className="text-xs text-slate-400 mt-1">active tasks currently flagged at risk</div>
          <Link href="/tasks?view=at-risk" className="inline-block mt-3 text-xs">Open at-risk tasks →</Link>
        </div>
      </section>

      <section className="grid xl:grid-cols-[1.4fr_1fr] gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2"><h3 className="text-lg font-medium">Course distribution</h3><span className="text-xs text-slate-500">selected period</span></div>
          <div className="mt-4 space-y-4">
            {byCourse.length ? byCourse.map(row => {
              const course = activeCourseMap.get(row.course.toLowerCase());
              return <div key={row.course}>
                <div className="flex justify-between gap-3 text-sm"><span>{course ? <Link href={`/courses/${course.id}`}>{row.course}</Link> : row.course}</span><span className="text-slate-300">{fmtMin(row.minutes)} · {pct(row.share)}</span></div>
                <div className="mt-1.5 h-2 rounded bg-white/5 overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${Math.max(2, row.share)}%` }} /></div>
                <div className="mt-1 text-[11px] text-slate-500">{row.sessions} sessions{row.pages ? ` · ${row.pages} pages · ${row.mpp.toFixed(1)} min/page` : ''}{row.avgFocus ? ` · focus ${row.avgFocus.toFixed(1)}` : ''}</div>
              </div>;
            }) : <div className="text-sm text-slate-400">No study sessions in this period.</div>}
          </div>
        </div>

        <div className="card p-4">
          <h3 className="text-lg font-medium">Courses needing attention</h3>
          <p className="text-xs text-slate-400 mt-1">Open work with the least logged study time in the last 14 days.</p>
          <div className="mt-4 space-y-3">
            {neglected.length ? neglected.map(item => <Link key={item.course.id} href={`/courses/${item.course.id}`} className="block rounded border border-white/10 p-3 hover:bg-white/5">
              <div className="flex justify-between gap-3"><span className="text-sm font-medium">{item.course.title}</span><span className="text-xs text-slate-400">{fmtMin(item.minutes)}</span></div>
              <div className="mt-1 text-xs text-slate-500">{item.open} open task{item.open === 1 ? '' : 's'}</div>
            </Link>) : <div className="text-sm text-slate-400">No active course currently stands out as neglected.</div>}
          </div>
        </div>
      </section>

      <section className="grid xl:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="text-lg font-medium">Eight-week trend</h3>
          <div className="mt-5 flex items-end gap-2 h-44">
            {weekly.map(item => <div key={item.key} className="flex-1 min-w-0 flex flex-col justify-end items-center gap-1 h-full">
              <div className="text-[10px] text-slate-500">{item.minutes ? fmtMin(item.minutes) : ''}</div>
              <div className="w-full max-w-12 rounded-t bg-blue-500/80" style={{ height: `${Math.max(item.minutes ? 8 : 2, item.minutes / weeklyMax * 120)}px` }} />
              <div className="text-[9px] text-slate-500 truncate w-full text-center">{item.key.slice(5)}</div>
            </div>)}
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-lg font-medium">Strongest focus windows</h3>
          <div className="mt-4 space-y-2">
            {focusByHour.length ? focusByHour.slice(0, 6).map(row => <div key={row.hour} className="flex items-center justify-between rounded border border-white/10 px-3 py-2 text-sm">
              <span>{new Date(2000,0,1,row.hour).toLocaleTimeString([], { hour: 'numeric' })}</span><span className="text-slate-300">{row.focus.toFixed(1)}/10 · {row.count} session{row.count === 1 ? '' : 's'}</span>
            </div>) : <div className="text-sm text-slate-400">Log focus scores to build this view.</div>}
          </div>
        </div>
      </section>

      {(risks.length > 0 || estimateAccuracy.rows.length > 0) && <section className="grid xl:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="text-lg font-medium">At-risk work</h3>
          <div className="mt-3 divide-y divide-white/10">
            {risks.map(task => <Link key={task.id} href={`/tasks?taskId=${encodeURIComponent(String(task.id))}`} className="block py-3">
              <div className="flex justify-between gap-3"><span className="text-sm font-medium">{task.title}</span><span className="text-xs text-slate-400">{new Date(task.dueDate).toLocaleDateString()}</span></div>
              <div className="mt-1 text-xs text-amber-300">{task.atRiskReason || 'At risk'}</div>
            </Link>)}
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-lg font-medium">Largest estimate misses</h3>
          <div className="mt-3 divide-y divide-white/10">
            {estimateAccuracy.rows.map(row => <Link key={row.task.id} href={`/tasks?taskId=${encodeURIComponent(String(row.task.id))}`} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="min-w-0 truncate">{row.task.title}</span><span className="shrink-0 text-xs text-slate-400">est {fmtMin(row.estimated)} · actual {fmtMin(row.actual)}</span>
            </Link>)}
          </div>
        </div>
      </section>}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="card p-4"><div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div><div className="mt-2 text-xl font-medium">{value}</div></div>;
}
