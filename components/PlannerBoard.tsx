"use client";
import { useEffect, useMemo, useState } from 'react';
import { Task } from '@/lib/types';

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function keyOf(d: Date) { const x = startOfDay(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; }
function labelOf(d: Date) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }

export default function PlannerBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const res = await fetch('/api/tasks', { cache: 'no-store' });
    const data = await res.json();
    setTasks(data.tasks as Task[]);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  const days = useMemo(() => {
    const today = startOfDay(new Date());
    const arr: { date: Date; key: string; label: string }[] = [];
    for (let i=0;i<7;i++) { const d = new Date(today); d.setDate(d.getDate()+i); arr.push({ date: d, key: keyOf(d), label: labelOf(d) }); }
    return arr;
  }, []);

  const buckets = useMemo(() => {
    const map: Record<string, Task[]> = Object.fromEntries(days.map(d => [d.key, [] as Task[]]));
    for (const t of tasks) {
      const k = keyOf(new Date(t.dueDate));
      if (map[k]) map[k].push(t);
    }
    for (const k of Object.keys(map)) map[k].sort((a,b) => a.dueDate.localeCompare(b.dueDate));
    return map;
  }, [tasks, days]);

  function onDragStart(e: React.DragEvent, t: Task) {
    e.dataTransfer.setData('text/plain', t.id);
  }

  async function moveTaskToDay(taskId: string, day: Date) {
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;
    const old = new Date(t.dueDate);
    const next = new Date(day);
    next.setHours(old.getHours(), old.getMinutes(), 0, 0);
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate: next.toISOString() }) });
    if (res.ok) await refresh();
  }

  function onDropDay(e: React.DragEvent, day: Date) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) moveTaskToDay(id, day);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {days.map(d => (
        <div key={d.key} className="card p-4"
             onDragOver={(e) => e.preventDefault()}
             onDrop={(e) => onDropDay(e, d.date)}>
          <div className="text-slate-300/80 text-sm mb-2">{d.label}</div>
          {loading && <div className="text-xs text-slate-300/70">Loading...</div>}
          {buckets[d.key].length === 0 ? (
            <div className="text-sm text-slate-300/70">No tasks.</div>
          ) : (
            <ul className="space-y-2">
              {buckets[d.key].map(t => (
                <li key={t.id} draggable onDragStart={(e) => onDragStart(e, t)} className="border border-[#1b2344] rounded p-2 cursor-move">
                  <div className="text-sm font-medium">{t.title}</div>
                  <div className="text-xs text-slate-300/70">{t.course || '-'} • {new Date(t.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {t.status}{typeof t.estimatedMinutes === 'number' ? ` • est ${t.estimatedMinutes}m` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
