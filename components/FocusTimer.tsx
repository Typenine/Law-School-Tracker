"use client";
import { useEffect, useMemo, useState } from 'react';
import { Task } from '@/lib/types';

function formatTime(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function FocusTimer() {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [focus, setFocus] = useState(5);
  const [defaultFocus, setDefaultFocus] = useState(5);
  const [taskId, setTaskId] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [saving, setSaving] = useState(false);
  // Pomodoro
  const [mode, setMode] = useState<'free' | 'pomodoro'>('free');
  const [phase, setPhase] = useState<'work' | 'break'>('work');
  const [workMin, setWorkMin] = useState(25);
  const [breakMin, setBreakMin] = useState(5);

  useEffect(() => {
    let id: any;
    if (running) {
      id = setInterval(() => setSeconds(prev => prev + 1), 1000);
    }
    return () => id && clearInterval(id);
  }, [running]);

  // Auto-switch for Pomodoro
  useEffect(() => {
    if (!running || mode !== 'pomodoro') return;
    const target = (phase === 'work' ? workMin : breakMin) * 60;
    if (seconds >= target) {
      // Switch phase and reset
      setPhase(prev => (prev === 'work' ? 'break' : 'work'));
      setSeconds(0);
    }
  }, [seconds, running, mode, phase, workMin, breakMin]);

  useEffect(() => {
    fetch('/api/tasks', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setTasks(d.tasks as Task[]))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const s = window.localStorage.getItem('defaultFocus');
    const n = s ? parseFloat(s) : NaN;
    const val = !isNaN(n) && n >= 1 && n <= 10 ? n : 5;
    setDefaultFocus(val);
    setFocus(val);
  }, []);

  const minutes = useMemo(() => Math.max(1, Math.round(seconds / 60)), [seconds]);

  function start() { setRunning(true); }
  function pause() { setRunning(false); }
  function resume() { setRunning(true); }
  function reset() { setRunning(false); setSeconds(0); setFocus(defaultFocus); }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: taskId || null, minutes, focus }) });
      if (!res.ok) throw new Error(await res.text());
      reset();
    } catch (_) {
      // ignore for now
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-medium mb-3">Focus Timer</h2>
      <div className="flex items-center gap-3 mb-3 text-sm">
        <div className="inline-flex gap-2 items-center">
          <label className="inline-flex items-center gap-1">
            <input type="radio" name="mode" checked={mode==='free'} onChange={() => { setMode('free'); setPhase('work'); setSeconds(0); }} /> Free
          </label>
          <label className="inline-flex items-center gap-1">
            <input type="radio" name="mode" checked={mode==='pomodoro'} onChange={() => { setMode('pomodoro'); setPhase('work'); setSeconds(0); }} /> Pomodoro
          </label>
        </div>
        {mode === 'pomodoro' && (
          <div className="inline-flex items-center gap-2">
            <button onClick={() => { setWorkMin(25); setBreakMin(5); setPhase('work'); setSeconds(0); }} className="px-2 py-1 rounded border border-[#1b2344]">25/5</button>
            <button onClick={() => { setWorkMin(50); setBreakMin(10); setPhase('work'); setSeconds(0); }} className="px-2 py-1 rounded border border-[#1b2344]">50/10</button>
            <span className="text-slate-300/70">Phase: {phase === 'work' ? `Work ${workMin}m` : `Break ${breakMin}m`}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-4">
        <div className="text-4xl font-semibold tabular-nums">{formatTime(seconds)}</div>
        {!running && seconds === 0 && (
          <button onClick={start} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500">Start</button>
        )}
        {running && (
          <button onClick={pause} className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500">Pause</button>
        )}
        {!running && seconds > 0 && (
          <>
            <button onClick={resume} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500">Resume</button>
            <button onClick={reset} className="px-4 py-2 rounded border border-[#1b2344]">Reset</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">{saving ? 'Saving...' : `Save (${minutes}m)`}</button>
          </>
        )}
      </div>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm mb-1">Task (optional)</label>
          <select value={taskId} onChange={e => setTaskId(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
            <option value="">-- none --</option>
            {tasks.map(t => (
              <option key={t.id} value={t.id}>{t.course ? `[${t.course}] ` : ''}{t.title}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">Focus (1-10)</label>
          <input type="number" min={1} max={10} step={0.1} value={focus} onChange={e => setFocus(parseFloat(e.target.value || '1'))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div className="flex items-end">
          <div className="text-xs text-slate-300/70">Minutes will be rounded from elapsed time.</div>
        </div>
      </div>
    </div>
  );
}
