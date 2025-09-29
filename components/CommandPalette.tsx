"use client";
import { useEffect, useMemo, useState } from 'react';
import { Task } from '@/lib/types';

function normalize(s: string) { return (s || '').toLowerCase(); }

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(v => !v);
        setQ('');
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch('/api/tasks', { cache: 'no-store' });
        const data = await res.json();
        setTasks((data.tasks || []) as Task[]);
      } catch {}
    })();
  }, [open]);

  const results = useMemo(() => {
    const n = normalize(q);
    if (!n) return tasks.slice(0, 20);
    return tasks.filter(t =>
      normalize(t.title).includes(n) ||
      normalize(t.course || '').includes(n) ||
      normalize(t.notes || '').includes(n) ||
      (t.tags || []).some(tag => normalize(tag).includes(n))
    ).slice(0, 50);
  }, [q, tasks]);

  async function toggleDone(t: Task) {
    await fetch(`/api/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: t.status === 'done' ? 'todo' : 'done' }) });
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: t.status === 'done' ? 'todo' : 'done' } : x));
  }

  async function movePlusOne(t: Task) {
    const d = new Date(t.dueDate); d.setDate(d.getDate() + 1); d.setHours(23,59,59,999);
    await fetch(`/api/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate: d.toISOString() }) });
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, dueDate: d.toISOString() } : x));
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setOpen(false)}>
      <div className="mx-auto mt-24 max-w-2xl rounded border border-[#1b2344] bg-[#0b1020] p-3" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search tasks (title/course/notes/tags). Enter to close."
               onKeyDown={(e) => { if (e.key === 'Enter') setOpen(false); }}
               className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 mb-2" />
        <div className="max-h-96 overflow-y-auto divide-y divide-[#1b2344]">
          {results.length === 0 ? (
            <div className="text-xs text-slate-300/70 p-2">No results.</div>
          ) : results.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-2 p-2">
              <div className="min-w-0">
                <div className="text-sm truncate">{t.title}</div>
                <div className="text-xs text-slate-300/70 truncate">{t.course || '-'} • {new Date(t.dueDate).toLocaleDateString()}</div>
              </div>
              <div className="shrink-0 space-x-1">
                <button className="px-2 py-1 rounded border border-[#1b2344] text-xs" onClick={() => toggleDone(t)}>{t.status === 'done' ? 'Undo' : 'Done'}</button>
                <button className="px-2 py-1 rounded border border-[#1b2344] text-xs" onClick={() => movePlusOne(t)}>+1d</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
