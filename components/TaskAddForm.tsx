"use client";
import { useEffect, useState } from 'react';

type Props = { onCreated?: () => void };

export default function TaskAddForm({ onCreated }: Props) {
  const [newTitle, setNewTitle] = useState('');
  const [newCourse, setNewCourse] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newEst, setNewEst] = useState<string>('');
  const [currentTerm, setCurrentTerm] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try { setCurrentTerm(window.localStorage.getItem('currentTerm') || ''); } catch {}
    }
  }, []);

  function isoToLocalInput(iso: string) {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  async function quickAdd() {
    if (!newTitle || !newDue) return;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          course: newCourse || null,
          dueDate: new Date(newDue).toISOString(),
          status: 'todo',
          estimatedMinutes: newEst ? parseInt(newEst, 10) : null,
          term: currentTerm || null,
        }),
      });
      if (res.ok) {
        setNewTitle(''); setNewCourse(''); setNewDue(''); setNewEst('');
        onCreated?.();
      }
    } catch (_) {}
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      try {
        const item = { title: newTitle, course: newCourse || null, dueDate: new Date(newDue).toISOString(), status: 'todo', estimatedMinutes: newEst ? parseInt(newEst, 10) : null, term: currentTerm || null };
        const arr = JSON.parse(window.localStorage.getItem('offlineQueue') || '[]');
        arr.push(item);
        window.localStorage.setItem('offlineQueue', JSON.stringify(arr));
        setNewTitle(''); setNewCourse(''); setNewDue(''); setNewEst('');
      } catch {}
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); quickAdd(); }} className="mb-3 flex flex-col md:flex-row gap-3 md:items-end justify-between">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 w-full md:w-auto">
        <div className="flex gap-2">
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Title" className="flex-1 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          <button type="button" onClick={async () => {
            if (!newTitle) return;
            try {
              const res = await fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: newTitle }) });
              if (!res.ok) return;
              const data = await res.json();
              const t = (data.tasks || [])[0];
              if (!t) return;
              setNewTitle(t.title || newTitle);
              if (t.course) setNewCourse(t.course || '');
              if (t.dueDate) setNewDue(isoToLocalInput(t.dueDate));
              if (typeof t.estimatedMinutes === 'number') setNewEst(String(t.estimatedMinutes));
            } catch {}
          }} className="px-2 py-2 rounded border border-[#1b2344] text-xs">Parse</button>
        </div>
        <input value={newCourse} onChange={e => setNewCourse(e.target.value)} placeholder="Course (optional)" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        <input type="datetime-local" value={newDue} onChange={e => setNewDue(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        <input type="number" min={0} step={5} value={newEst} onChange={e => setNewEst(e.target.value)} placeholder="Est. min" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        <button type="submit" className="bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded disabled:opacity-50" disabled={!newTitle || !newDue}>Add Task</button>
      </div>
    </form>
  );
}
