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

  // Load-balancing assist: move tasks from heavy to lighter days within +/-2 days
  async function balanceWeek() {
    // threshold from localStorage or 240
    const heavy = (typeof window !== 'undefined') ? parseFloat(window.localStorage.getItem('heavyDayThreshold') || '240') : 240;
    const today = startOfDay(new Date());
    const dayKeys = days.map(d => d.key);
    const indexOf = Object.fromEntries(dayKeys.map((k, i) => [k, i] as const));
    // Build loads and buckets
    const loads: Record<string, number> = Object.fromEntries(dayKeys.map(k => [k, 0] as const));
    const bucketTasks: Record<string, Task[]> = Object.fromEntries(dayKeys.map(k => [k, [] as Task[]] as const));
    for (const t of tasks) {
      if (t.status === 'done') continue;
      const key = keyOf(new Date(t.dueDate));
      if (loads[key] === undefined) continue;
      loads[key] += (t.estimatedMinutes || 0);
      bucketTasks[key].push(t);
    }
    // For each heavy day, try to move largest tasks to nearby lighter days
    const moves: Array<{ id: string; toKey: string }> = [];
    for (const k of dayKeys) {
      if ((loads[k] || 0) <= heavy) continue;
      const tasksBySize = bucketTasks[k].slice().sort((a, b) => (b.estimatedMinutes || 0) - (a.estimatedMinutes || 0));
      for (const t of tasksBySize) {
        if ((loads[k] || 0) <= heavy) break;
        const i = indexOf[k];
        // candidate offsets: -2,-1,+1,+2 prefer earlier days
        for (const off of [-2, -1, 1, 2]) {
          const j = i + off;
          if (j < 0 || j >= dayKeys.length) continue;
          const targetKey = dayKeys[j];
          // keep before or on due date if moving earlier; allow +1/+2 only if still before original due end
          const due = startOfDay(new Date(t.dueDate));
          const targetDate = new Date(days[j].date);
          if (targetDate > due) continue; // don't push later than due
          const est = t.estimatedMinutes || 0;
          if ((loads[targetKey] || 0) + est <= heavy) {
            loads[k] -= est; loads[targetKey] += est;
            moves.push({ id: t.id, toKey: targetKey });
            break;
          }
        }
      }
    }
    // Apply moves
    for (const m of moves) {
      const [y, mo, d] = m.toKey.split('-').map(n => parseInt(n, 10));
      const nd = new Date(y, mo - 1, d, 23, 59, 59, 999);
      await fetch(`/api/tasks/${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate: nd.toISOString() }) });
    }
    if (moves.length) await refresh();
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

  async function applySuggestion(s: { id: string; title: string; course: string | null | undefined; dueKey: string; plan: Array<{ key: string; minutes: number }> }) {
    try {
      // Create prep subtasks
      const createdIds: string[] = [];
      const total = s.plan.length;
      for (let i = 0; i < s.plan.length; i++) {
        const p = s.plan[i];
        const [y, m, d] = p.key.split('-').map(n => parseInt(n, 10));
        const due = new Date(y, m - 1, d, 23, 59, 59, 999);
        const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          title: `[Prep] ${s.title} (part ${i+1}/${total})`,
          course: s.course || null,
          dueDate: due.toISOString(),
          status: 'todo',
          estimatedMinutes: p.minutes,
        })});
        if (!res.ok) throw new Error('failed to create prep');
        const data = await res.json();
        createdIds.push(data.task.id);
      }
      // Update main task dependsOn
      const main = tasks.find(t => t.id === s.id);
      const prev = (main?.dependsOn || []) as string[];
      const patch = await fetch(`/api/tasks/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dependsOn: [...prev, ...createdIds] }) });
      if (!patch.ok) throw new Error('failed to update main task');
      await refresh();
    } catch { /* ignore for now, could add toast */ }
  }

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
              <li key={s.id} className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-slate-200">{s.title}</span> {s.course ? `(${s.course}) ` : ''}→ {s.plan.map(p => `${p.key}: ~${p.minutes}m`).join(', ')}
                </div>
                <button onClick={() => applySuggestion(s)} className="px-2 py-1 rounded border border-[#1b2344]">Apply</button>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <button onClick={balanceWeek} className="px-3 py-2 rounded border border-[#1b2344]">Balance this week</button>
          </div>
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
