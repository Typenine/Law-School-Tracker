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

  // Suggestions: split large readings/assignments across days before due (informational only)
  const suggestions = useMemo(() => {
    const today = startOfDay(new Date());
    const out: Array<{ id: string; title: string; course: string | null | undefined; dueKey: string; plan: Array<{ key: string; minutes: number }> }> = [];
    for (const t of tasks) {
      if (t.status === 'done') continue;
      const est = t.estimatedMinutes || 0;
      if (est < 120) continue; // threshold for suggesting splits
      const due = startOfDay(new Date(t.dueDate));
      if (due < today) continue;
      const daysBefore = Math.max(0, Math.floor((due.getTime() - today.getTime()) / (24*60*60*1000)));
      if (daysBefore < 1) continue; // nothing to split before due
      const splits = Math.min(3, Math.max(2, Math.ceil(est / 90))); // 90m chunks, 2-3 parts
      const per = Math.round(est / splits);
      const plan: Array<{ key: string; minutes: number }> = [];
      for (let i = splits - 1; i >= 1; i--) { // allocate to preceding days; keep final work on due day implicitly
        const d = new Date(due); d.setDate(d.getDate() - i);
        if (d < today) continue;
        plan.push({ key: keyOf(d), minutes: per });
      }
      if (plan.length) out.push({ id: t.id, title: t.title, course: t.course, dueKey: keyOf(due), plan });
    }
    return out;
  }, [tasks]);

  function onDragStart(e: React.DragEvent, t: Task) {
    e.dataTransfer.setData('text/plain', t.id);
  }

  async function moveTaskToDay(taskId: string, day: Date) {
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;
    const old = new Date(t.dueDate);
    const next = new Date(day);
    // date-only preference: normalize to end-of-day
    next.setHours(23, 59, 59, 999);
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate: next.toISOString() }) });
    if (res.ok) await refresh();
  }

  function onDropDay(e: React.DragEvent, day: Date) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) moveTaskToDay(id, day);
  }

  return (
    <div className="space-y-4">
      {suggestions.length > 0 && (
        <div className="rounded border border-[#1b2344] p-4">
          <div className="text-slate-300/70 text-xs mb-2">Suggestions to spread large readings/assignments across days (date-only)</div>
          <ul className="text-xs space-y-1">
            {suggestions.map((s) => (
              <li key={s.id}>
                <span className="text-slate-200">{s.title}</span> {s.course ? `(${s.course}) ` : ''}→ {s.plan.map(p => `${p.key}: ~${p.minutes}m`).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
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
                    <div className="text-xs text-slate-300/70">{t.course || '-'} • {t.status}{typeof t.estimatedMinutes === 'number' ? ` • est ${t.estimatedMinutes}m` : ''}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
