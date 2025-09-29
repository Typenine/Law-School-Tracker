"use client";
import { useEffect, useState } from 'react';
import { StudySession, Task } from '@/lib/types';

export default function SessionLogger() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [minutes, setMinutes] = useState<number>(60);
  const [focus, setFocus] = useState<number>(5);
  const [notes, setNotes] = useState('');
  const [taskId, setTaskId] = useState<string>('');
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [saving, setSaving] = useState(false);
  async function refresh() {
    const [tRes, sRes] = await Promise.all([
      fetch('/api/tasks', { cache: 'no-store' }),
      fetch('/api/sessions', { cache: 'no-store' })
    ]);
    const [tData, sData] = await Promise.all([tRes.json(), sRes.json()]);
    setTasks(tData.tasks || []);
    setSessions(sData.sessions || []);
  }

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const s = window.localStorage.getItem('defaultFocus');
    const n = s ? parseInt(s, 10) : NaN;
    if (!isNaN(n) && n >= 1 && n <= 10) setFocus(n);
  }, []);

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: taskId || null, minutes, focus, notes })
      });
      if (!res.ok) throw new Error(await res.text());
      setNotes('');
      setTaskId('');
      await refresh();
    } catch (e) {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-medium mb-3">Log Study Session</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          <label className="block text-sm mb-1">Minutes</label>
          <input type="number" value={minutes} onChange={e => setMinutes(parseInt(e.target.value || '0', 10))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm mb-1">Focus (1-10)</label>
          <input type="number" min={1} max={10} value={focus} onChange={e => setFocus(parseInt(e.target.value || '1', 10))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm mb-1">Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
      </div>
      <div className="mt-3">
        <button onClick={submit} disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded">{saving ? 'Saving...' : 'Save Session'}</button>
      </div>

      <div className="mt-5">
        <h3 className="font-medium mb-2">Recent Sessions</h3>
        {sessions.slice(0, 5).map(s => (
          <div key={s.id} className="text-sm border-t border-[#1b2344] py-2">
            <div className="flex items-center justify-between">
              <div>{new Date(s.when).toLocaleString()} • {s.minutes}m • Focus {s.focus ?? '-'}{s.taskId ? '' : ''}</div>
              <div className="text-slate-300/70">{s.notes}</div>
            </div>
          </div>
        ))}
        {sessions.length === 0 && <p className="text-sm text-slate-300/80">No sessions yet.</p>}
      </div>
    </div>
  );
}
