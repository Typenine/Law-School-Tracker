"use client";
import { useEffect, useMemo, useState } from 'react';
import { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function keyOf(d: Date) { const x = startOfDay(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; }

export default function CalendarPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [month, setMonth] = useState<number>(() => new Date().getMonth());
  const [courseFilter, setCourseFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'todo' | 'done'>('all');
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const res = await fetch('/api/tasks', { cache: 'no-store' });
    const data = await res.json();
    setTasks(data.tasks as Task[]);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  const first = new Date(year, month, 1);
  const firstDow = first.getDay(); // 0 Sun
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - ((firstDow + 6) % 7)); // back to Monday start
  const weeks = useMemo(() => {
    const rows: Date[][] = [];
    let cursor = new Date(gridStart);
    for (let r = 0; r < 6; r++) {
      const row: Date[] = [];
      for (let c = 0; c < 7; c++) { row.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }
      rows.push(row);
    }
    return rows;
  }, [year, month]);

  const byDay = useMemo(() => {
    const m: Record<string, Task[]> = {};
    const filtered = tasks.filter(t => (statusFilter === 'all' || t.status === statusFilter) && (!courseFilter || (t.course || '').toLowerCase().includes(courseFilter.toLowerCase())));
    for (const t of filtered) {
      const k = keyOf(new Date(t.dueDate));
      (m[k] ||= []).push(t);
    }
    for (const k of Object.keys(m)) m[k].sort((a,b) => a.title.localeCompare(b.title));
    return m;
  }, [tasks, courseFilter, statusFilter]);

  function onDragStart(e: React.DragEvent, t: Task) {
    e.dataTransfer.setData('text/plain', t.id);
  }

  async function moveTaskToDay(taskId: string, day: Date) {
    const next = new Date(day);
    next.setHours(23, 59, 59, 999);
    await fetch(`/api/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate: next.toISOString() }) });
    await refresh();
  }

  function onDropDay(e: React.DragEvent, day: Date) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) moveTaskToDay(id, day);
  }

  async function toggleDone(t: Task) {
    await fetch(`/api/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: t.status === 'done' ? 'todo' : 'done' }) });
    await refresh();
  }

  async function movePlusOne(t: Task) {
    const d = new Date(t.dueDate);
    d.setDate(d.getDate() + 1);
    d.setHours(23,59,59,999);
    await fetch(`/api/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate: d.toISOString() }) });
    await refresh();
  }

  return (
    <main className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Calendar</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => { const d = new Date(year, month - 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); }} className="px-2 py-1 rounded border border-[#1b2344]">Prev</button>
          <div className="text-sm text-slate-300/80 min-w-[140px] text-center">{new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })}</div>
          <button onClick={() => { const d = new Date(year, month + 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); }} className="px-2 py-1 rounded border border-[#1b2344]">Next</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-slate-300/70 mb-1">Course contains</label>
          <input value={courseFilter} onChange={e => setCourseFilter(e.target.value)} placeholder="e.g., Torts" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div>
          <label className="block text-xs text-slate-300/70 mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
            <option value="all">All</option>
            <option value="todo">Todo</option>
            <option value="done">Done</option>
          </select>
        </div>
      </div>
      {loading && <div className="text-xs text-slate-300/70">Loading…</div>}
      <div className="grid grid-cols-7 gap-2">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
          <div key={d} className="text-center text-xs text-slate-300/70">{d}</div>
        ))}
        {weeks.flat().map((d, idx) => {
          const k = keyOf(d);
          const monthClass = d.getMonth() === month ? '' : 'opacity-50';
          const list = byDay[k] || [];
          return (
            <div key={idx} className={`border border-[#1b2344] rounded p-2 min-h-[100px] ${monthClass}`} onClick={() => setSelectedDayKey(k)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropDay(e, d)}>
              <div className="text-xs text-slate-300/70 mb-1 flex items-center justify-between">
                <span>{d.getDate()}</span>
                {selectedDayKey === k && <span className="text-[10px] text-slate-300/60">Agenda</span>}
              </div>
              {list.length === 0 ? (
                <div className="text-[11px] text-slate-300/50">—</div>
              ) : (
                <ul className="space-y-1">
                  {list.map(t => (
                    <li key={t.id} className="text-[11px] flex items-center justify-between gap-1" draggable onDragStart={(e) => onDragStart(e, t)}>
                      <div className="truncate">
                        <span className="text-slate-200">{t.title}</span>
                        {t.course ? <span className="text-slate-300/60"> · {t.course}</span> : null}
                        {typeof t.estimatedMinutes === 'number' ? <span className="text-slate-300/60"> · {t.estimatedMinutes}m</span> : null}
                      </div>
                      <div className="shrink-0 space-x-1">
                        <button className="px-1 py-0.5 text-[10px] rounded border border-[#1b2344]" onClick={(e) => { e.stopPropagation(); toggleDone(t); }}>{t.status === 'done' ? 'Undo' : 'Done'}</button>
                        <button className="px-1 py-0.5 text-[10px] rounded border border-[#1b2344]" onClick={(e) => { e.stopPropagation(); movePlusOne(t); }}>+1d</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
