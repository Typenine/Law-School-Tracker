
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { notifyTasksChanged } from '@/lib/taskBus';
import { notifySessionsChanged } from '@/lib/sessionsBus';
import { notifyToast } from '@/lib/toastBus';

type Reading = {
  id: string; title: string; course?: string | null; dueDate: string; status: 'todo' | 'done';
  originalPageRanges?: string | null; remainingPageRanges?: string | null;
  assignedPages: number; completedPages: number; remainingPages: number; percentComplete: number;
  loggedMinutes: number; estimatedMinutesRemaining: number; paceMinutesPerPage: number; paceSource: string;
  atRisk: boolean; noteCount: number; readingNoteCount: number; caseBriefCount: number; classNoteCount: number;
  linkedNotes: Array<{ id: string; title: string; sourceType: string; section?: string | null }>;
};

type Overview = {
  summary: { readings: number; assignedPages: number; completedPages: number; remainingPages: number; estimatedMinutesRemaining: number; atRisk: number };
  courses: Array<{ course: string; readings: number; assignedPages: number; completedPages: number; remainingPages: number; estimatedMinutesRemaining: number; atRisk: number }>;
  readings: Reading[];
};

function duration(minutes: number) {
  const m = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(m / 60); const r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`;
}

function dueLabel(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'No due date' : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ReadingDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState<Reading | null>(null);
  const [minutes, setMinutes] = useState('30');
  const [focus, setFocus] = useState('6');
  const [pages, setPages] = useState('');
  const [moveToDay, setMoveToDay] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try { setData(await apiFetch<Overview>('/api/reading/overview')); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const byCourse = useMemo(() => {
    const map = new Map<string, Reading[]>();
    for (const reading of data?.readings || []) {
      const key = reading.course || 'Unassigned';
      map.set(key, [...(map.get(key) || []), reading]);
    }
    return Array.from(map.entries());
  }, [data]);

  async function logProgress(mode: 'partial' | 'finish') {
    if (!logging) return;
    setBusyId(logging.id);
    try {
      await apiFetch(`/api/tasks/${logging.id}/progress`, { method: 'POST', body: {
        mode, minutes: Math.max(1, Math.round(Number(minutes) || 0)), focus: Math.max(1, Math.min(10, Number(focus) || 5)),
        pagesCompleted: pages.trim() || null, moveToDay: moveToDay || null,
      }});
      notifyTasksChanged(); notifySessionsChanged();
      notifyToast({ kind: 'success', message: mode === 'finish' ? 'Reading completed.' : 'Reading progress logged.' });
      setLogging(null); setPages(''); setMoveToDay('');
      await refresh();
    } catch (error: any) {
      notifyToast({ kind: 'error', message: error?.message || 'Unable to log reading progress.' });
    } finally { setBusyId(null); }
  }

  async function split(reading: Reading) {
    setBusyId(reading.id);
    try {
      await apiFetch(`/api/tasks/${reading.id}/smart-split`, { method: 'POST', body: {} });
      notifyToast({ kind: 'success', message: 'Reading split across your available days.' });
    } catch (error: any) {
      notifyToast({ kind: 'error', message: error?.message || 'Unable to split reading.' });
    } finally { setBusyId(null); }
  }

  if (loading && !data) return <div className="card p-6 text-sm text-slate-300">Loading reading tracker…</div>;
  const summary = data?.summary;
  return <div className="space-y-4">
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {[
        ['Open readings', summary?.readings ?? 0],
        ['Pages remaining', summary?.remainingPages ?? 0],
        ['Pages completed', summary?.completedPages ?? 0],
        ['Time remaining', duration(summary?.estimatedMinutesRemaining ?? 0)],
        ['At risk', summary?.atRisk ?? 0],
      ].map(([label, value]) => <div className="card p-4" key={String(label)}><div className="text-xs text-slate-400">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>)}
    </div>

    {!data?.readings?.length ? <div className="card p-6"><h2 className="font-medium">No active readings yet</h2><p className="mt-1 text-sm text-slate-400">Create reading tasks from Tasks. Page ranges, pace, progress, linked notes, and scheduling will appear here automatically.</p><Link href="/tasks" className="inline-block mt-3 underline">Go to Tasks</Link></div> : null}

    {byCourse.map(([course, readings]) => {
      const courseSummary = data?.courses.find(c => c.course === course);
      return <section className="card p-5 space-y-3" key={course}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><h2 className="text-lg font-semibold">{course}</h2><p className="text-xs text-slate-400">{courseSummary?.remainingPages || 0} pages left · {duration(courseSummary?.estimatedMinutesRemaining || 0)} estimated</p></div>
          <Link href="/notes" className="text-sm underline decoration-dotted">Open course notes</Link>
        </div>
        <div className="space-y-3">
          {readings.map(reading => <article key={reading.id} className="rounded border border-white/10 p-4 space-y-2">
            <div className="flex flex-wrap justify-between gap-2">
              <div><div className="font-medium">{reading.title}</div><div className="text-xs text-slate-400">Due {dueLabel(reading.dueDate)}{reading.atRisk ? ' · At risk' : ''}</div></div>
              <div className="text-right text-xs text-slate-400"><div>{reading.remainingPageRanges || 'No pages remaining'}</div><div>{reading.remainingPages} pages · {duration(reading.estimatedMinutesRemaining)}</div></div>
            </div>
            <div><div className="h-2 rounded bg-white/10 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${reading.percentComplete}%` }} /></div><div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>{reading.completedPages}/{reading.assignedPages} pages</span><span>{reading.percentComplete}%</span></div></div>
            <div className="grid sm:grid-cols-3 gap-2 text-xs text-slate-400">
              <div>Pace: {reading.paceMinutesPerPage} min/page ({reading.paceSource})</div>
              <div>Logged: {duration(reading.loggedMinutes)}</div>
              <div>Linked: {reading.readingNoteCount} reading notes · {reading.caseBriefCount} briefs</div>
            </div>
            {reading.linkedNotes.length ? <div className="text-xs text-slate-400">Materials: {reading.linkedNotes.map(n => n.title).join(' · ')}</div> : null}
            <div className="flex flex-wrap gap-2">
              <button className="px-3 py-1.5 rounded border border-white/10 text-sm" onClick={() => { setLogging(reading); setPages(''); setMoveToDay(''); setMinutes(reading.estimatedMinutesRemaining ? String(Math.min(60, reading.estimatedMinutesRemaining)) : '30'); }}>Log progress</button>
              <button className="px-3 py-1.5 rounded border border-white/10 text-sm disabled:opacity-50" disabled={busyId === reading.id || reading.remainingPages === 0} onClick={() => split(reading)}>Smart split</button>
            </div>
          </article>)}
        </div>
      </section>;
    })}

    {logging ? <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button className="absolute inset-0 bg-black/70" aria-label="Close" onClick={() => setLogging(null)} /><div className="relative w-full max-w-md rounded-lg border border-white/10 bg-[#0f172a] p-5 space-y-4"><div><h2 className="text-lg font-semibold">Log reading progress</h2><p className="text-sm text-slate-400">{logging.course} · {logging.remainingPageRanges}</p></div><label className="block text-sm">Minutes<input className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" value={minutes} onChange={e => setMinutes(e.target.value)} /></label><label className="block text-sm">Focus (1–10)<input type="number" min="1" max="10" className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" value={focus} onChange={e => setFocus(e.target.value)} /></label><label className="block text-sm">Pages completed<input className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" placeholder="e.g. 100–122" value={pages} onChange={e => setPages(e.target.value)} /></label><label className="block text-sm">Move remainder to day <span className="text-slate-500">(optional)</span><input type="date" className="mt-1 w-full rounded border border-white/10 bg-slate-800 px-3 py-2" value={moveToDay} onChange={e => setMoveToDay(e.target.value)} /></label><div className="flex justify-end gap-2"><button className="px-3 py-2" onClick={() => setLogging(null)}>Cancel</button><button className="px-3 py-2 rounded border border-white/10" disabled={busyId === logging.id} onClick={() => logProgress('partial')}>Log partial</button><button className="px-3 py-2 rounded bg-emerald-600" disabled={busyId === logging.id} onClick={() => logProgress('finish')}>Complete</button></div></div></div> : null}
  </div>;
}
