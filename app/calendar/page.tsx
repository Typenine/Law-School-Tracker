"use client";
import { useEffect, useMemo, useState } from 'react';
import { Task } from '@/lib/types';
import { courseColorClass } from '@/lib/colors';

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
  const [courses, setCourses] = useState<any[]>([]);

  async function refresh() {
    setLoading(true);
    const res = await fetch('/api/tasks', { cache: 'no-store' });
    const data = await res.json();
    setTasks(data.tasks as Task[]);
    try {
      const cr = await fetch('/api/courses', { cache: 'no-store' });
      const cd = await cr.json();
      setCourses(cd.courses || []);
    } catch {}
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

  const classesByDay = useMemo(() => {
    type ClassItem = { title: string; code?: string | null; time?: string | null; room?: string | null; colorKey: string; startMin?: number; endMin?: number; conflict?: boolean };
    const m: Record<string, ClassItem[]> = {};
    const toMin = (hhmm: string | null | undefined) => {
      if (!hhmm) return undefined;
      const [h, mi] = hhmm.split(':').map((x: string) => parseInt(x, 10));
      if (isNaN(h) || isNaN(mi)) return undefined;
      return h * 60 + mi;
    };
    for (const c of courses) {
      if (courseFilter) {
        const hay = `${c.title || ''} ${c.code || ''}`.toLowerCase();
        if (!hay.includes(courseFilter.toLowerCase())) continue;
      }
      const start = c.startDate ? new Date(c.startDate) : null;
      const end = c.endDate ? new Date(c.endDate) : null;
      const blocks = (Array.isArray(c.meetingBlocks) && c.meetingBlocks.length)
        ? c.meetingBlocks
        : ((Array.isArray(c.meetingDays) && c.meetingStart && c.meetingEnd) ? [{ days: c.meetingDays, start: c.meetingStart, end: c.meetingEnd, location: c.room || c.location || null }] : []);
      if (!Array.isArray(blocks) || !blocks.length) continue;
      for (const row of weeks) {
        for (const d of row) {
          const within = (!start || d >= start) && (!end || d <= end);
          if (!within) continue;
          for (const b of blocks) {
            if (!Array.isArray(b.days)) continue;
            if (b.days.includes(d.getDay())) {
              const sMin = toMin((b as any).start);
              const eMin = toMin((b as any).end);
              const key = keyOf(d);
              (m[key] ||= []).push({
                title: c.title,
                code: c.code,
                time: (b as any).start && (b as any).end ? `${(b as any).start}–${(b as any).end}` : null,
                room: (b as any).location || c.room || c.location || null,
                colorKey: c.title || c.code || 'course',
                startMin: sMin,
                endMin: eMin,
              });
            }
          }
        }
      }
    }
    // Mark conflicts within each day by time overlap
    for (const k of Object.keys(m)) {
      const list = m[k];
      const withTimes = list.filter(x => typeof x.startMin === 'number' && typeof x.endMin === 'number');
      withTimes.sort((a, b) => (a.startMin! - b.startMin!));
      for (let i = 1; i < withTimes.length; i++) {
        const prev = withTimes[i - 1];
        const cur = withTimes[i];
        if (cur.startMin! < prev.endMin!) { prev.conflict = true; cur.conflict = true; }
      }
    }
    return m;
  }, [courses, weeks, year, month, courseFilter]);

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
              {/* Class meetings */}
              {(classesByDay[k] && classesByDay[k].length > 0) && (
                <ul className="space-y-0.5 mb-1">
                  {classesByDay[k].map((c, idx) => (
                    <li key={idx} className={`text-[10px] truncate flex items-center gap-1 ${c.conflict ? 'text-rose-400' : 'text-slate-300/80'}`} title={c.conflict ? 'Time conflict' : ''}>
                      <span className={`inline-block w-2 h-2 rounded-full ${courseColorClass(c.title, 'bg')}`}></span>
                      <span className="text-slate-300/60">Class:</span> {c.code ? `${c.code} ` : ''}{c.title}
                      {c.time ? <span className="text-slate-300/60"> · {c.time}</span> : null}
                      {c.room ? <span className="text-slate-300/60"> · {c.room}</span> : null}
                      {c.conflict ? <span className="ml-1 text-[9px] px-1 rounded border border-rose-500 text-rose-400">conflict</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {/* Tasks */}
              {list.length === 0 ? (
                <div className="text-[11px] text-slate-300/50">—</div>
              ) : (
                <ul className="space-y-1">
                  {list.map(t => (
                    <li key={t.id} className="text-[11px] flex items-center justify-between gap-1" draggable onDragStart={(e) => onDragStart(e, t)}>
                      <div className="min-w-0">
                        <div className="truncate flex items-center gap-2">
                          {t.course ? <span className={`inline-block w-2 h-2 rounded-full ${courseColorClass(t.course, 'bg')}`}></span> : null}
                          <span className="text-slate-200">{t.title}</span>
                          {t.course ? <span className="text-slate-300/60"> · {t.course}</span> : null}
                          {typeof t.estimatedMinutes === 'number' ? <span className="text-slate-300/60"> · {t.estimatedMinutes}m</span> : null}
                        </div>
                        {(t.tags && t.tags.length > 0) && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {t.tags.map((tg, i) => (
                              <span key={i} className="text-[10px] px-1 py-0.5 rounded border border-[#1b2344]">{tg}</span>
                            ))}
                          </div>
                        )}
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
