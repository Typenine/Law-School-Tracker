"use client";

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { tasksClient } from '@/lib/tasksClient';
import { useTasks } from '@/lib/useTasks';
import {
  clearWorkSession,
  elapsedSeconds,
  loadWorkSession,
  newestWorkSession,
  newWorkSession,
  saveWorkSession,
  type PersistedWorkSession,
} from '@/lib/workSessionState';

export default function WorkSessionClientV2() {
  const taskId = useSearchParams().get('task') || '';
  const { tasks, loading, refresh } = useTasks();
  const task = tasks.find(item => item.id === taskId) || null;
  const [session, setSession] = useState<PersistedWorkSession | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const suppressRemote = useRef(false);

  useEffect(() => {
    if (!taskId) { setSession(null); setSeconds(0); return; }
    let cancelled = false;
    void (async () => {
      const local = loadWorkSession(taskId);
      let remote: PersistedWorkSession | null = null;
      try {
        const data = await apiFetch<{ session: PersistedWorkSession | null }>(`/api/active-session?taskId=${encodeURIComponent(taskId)}`);
        remote = data.session;
      } catch {}
      if (cancelled) return;
      const restored = newestWorkSession(local, remote) || newWorkSession(taskId);
      setSession(restored);
      setSeconds(elapsedSeconds(restored));
      if (remote && (!local || remote.updatedAt > local.updatedAt)) setMessage('Restored the latest active session from another device.');
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  useEffect(() => {
    if (!session) return;
    saveWorkSession(session);
    setSeconds(elapsedSeconds(session));
    const syncTimer = window.setTimeout(() => {
      if (!suppressRemote.current) void apiFetch('/api/active-session', { method: 'PUT', body: session }).catch(() => undefined);
    }, 500);
    const timer = session.running ? window.setInterval(() => setSeconds(elapsedSeconds(session)), 1000) : null;
    return () => {
      window.clearTimeout(syncTimer);
      if (timer) window.clearInterval(timer);
    };
  }, [session]);

  const notes = session?.notes || '';
  const pages = session?.pages || '';
  const hasMeaningfulTime = seconds >= 15;
  const time = useMemo(() => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, [seconds]);

  function changeSession(patch: Partial<PersistedWorkSession>) {
    setSession(current => current ? { ...current, ...patch, updatedAt: new Date().toISOString() } : current);
  }

  function toggleTimer() {
    setMessage('');
    setSession(current => {
      if (!current) return current;
      const updatedAt = new Date().toISOString();
      if (current.running) return { ...current, running: false, accumulatedSeconds: elapsedSeconds(current), startedAt: null, updatedAt };
      return { ...current, running: true, startedAt: Date.now(), sessionStartedAt: current.accumulatedSeconds ? current.sessionStartedAt : updatedAt, updatedAt };
    });
  }

  async function save(done: boolean, skimmed = false) {
    if (!task || !session) return;
    const exactSeconds = elapsedSeconds(session);
    if (exactSeconds < 15) { setMessage('Run the timer for at least 15 seconds before saving a study session.'); return; }
    setSaving(true);
    const paused = { ...session, running: false, accumulatedSeconds: exactSeconds, startedAt: null, updatedAt: new Date().toISOString() };
    setSession(paused);
    const minutes = Math.max(1, Math.round(exactSeconds / 60));
    try {
      await apiFetch('/api/sessions', { method: 'POST', body: {
        taskId: task.id,
        when: paused.sessionStartedAt,
        minutes,
        notes: notes.trim() || (skimmed ? 'Strategic skim completed.' : null),
        pagesRead: pages ? Number(pages) : null,
        activity: task.activity || 'other',
      }});
      await tasksClient.update(task.id, {
        actualMinutes: (task.actualMinutes || 0) + minutes,
        pagesRead: pages ? (task.pagesRead || 0) + Number(pages) : task.pagesRead,
        notes: notes.trim() ? [task.notes, notes.trim()].filter(Boolean).join('\n\n') : task.notes,
        tags: Array.from(new Set([...(task.tags || []), ...(skimmed ? ['skimmed'] : [])])),
        ...(done ? { status: 'done', completedAt: new Date().toISOString() } : {}),
      }, { silent: true });
      suppressRemote.current = true;
      clearWorkSession(task.id);
      await apiFetch(`/api/active-session?taskId=${encodeURIComponent(task.id)}`, { method: 'DELETE' }).catch(() => undefined);
      const reset = newWorkSession(task.id);
      setSession(reset);
      setSeconds(0);
      window.setTimeout(() => { suppressRemote.current = false; }, 1000);
      setMessage(done ? 'Completed and added to Study History.' : 'Progress saved.');
      await refresh();
    } catch (cause: any) {
      setSession(paused);
      setMessage(cause?.message || 'The session could not be saved. Your timer state remains available locally and on the server.');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading…</div>;
  if (!task) return <Link href="/tasks" className="text-emerald-300">Select a task from Tasks to begin.</Link>;

  return <div className="mx-auto max-w-3xl space-y-6">
    <section className="rounded-2xl border border-emerald-500/30 bg-slate-950 p-6">
      <Link href="/tasks" className="text-sm text-slate-400">Back to Tasks</Link>
      <p className="mt-4 text-sm text-emerald-300">{task.course || 'General work'}</p>
      <h2 className="mt-1 text-2xl font-semibold text-slate-100">{task.title}</h2>
      <p className="mt-6 font-mono text-5xl text-slate-100">{time}</p>
      <p className="mt-2 text-xs text-slate-500">Timer, notes, and pages are restored after refreshes, closed tabs, or switching devices.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button disabled={saving} onClick={toggleTimer} className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">{session?.running ? 'Pause' : seconds ? 'Resume' : 'Start'}</button>
        <button disabled={!hasMeaningfulTime || saving} onClick={() => save(false)} className="rounded-lg border border-slate-600 px-4 py-3 text-sm text-slate-200 disabled:opacity-50">Save progress</button>
        <button disabled={!hasMeaningfulTime || saving} onClick={() => save(true)} className="rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">Finish</button>
      </div>
    </section>
    {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}
    <section className="rounded-xl border border-slate-700 bg-slate-900/45 p-5">
      <label className="block text-sm text-slate-300">Pages completed<input type="number" min={0} value={pages} onChange={event => changeSession({ pages: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /></label>
      <label className="mt-4 block text-sm text-slate-300">Notes<textarea rows={5} value={notes} onChange={event => changeSession({ notes: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /></label>
      <button disabled={!hasMeaningfulTime || saving} onClick={() => save(true, true)} className="mt-4 rounded-lg border border-amber-500/40 px-4 py-2 text-sm text-amber-300 disabled:opacity-50">Mark strategically skimmed</button>
    </section>
  </div>;
}
