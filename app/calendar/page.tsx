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
  const [monthOpen, setMonthOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addCourse, setAddCourse] = useState('');
  const [addDate, setAddDate] = useState(''); // yyyy-mm-dd
  const [addEst, setAddEst] = useState('');

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

  const monthLabel = useMemo(() => new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' }), [year, month]);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function openAdd() {
    const today = new Date();
    let d: Date;
    if (selectedDayKey) {
      const [y, m, da] = selectedDayKey.split('-').map(n => parseInt(n, 10));
      d = new Date(y, (m as number) - 1, da);
    } else if (today.getFullYear() === year && today.getMonth() === month) {
      d = today;
    } else {
      d = new Date(year, month, 1);
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    setAddDate(`${yyyy}-${mm}-${dd}`);
    setAddCourse(''); setAddTitle(''); setAddEst('');
    setAddOpen(true); setMonthOpen(false);
  }

  async function createEvent() {
    if (!addTitle || !addDate) return;
    const parts = addDate.split('-').map(n => parseInt(n, 10));
    if (parts.length !== 3) return;
    const d = new Date(parts[0], parts[1]-1, parts[2], 23,59,59,999);
    const body: any = {
      title: addTitle,
      course: addCourse ? addCourse : null,
      dueDate: d.toISOString(),
      status: 'todo',
      estimatedMinutes: addEst ? parseInt(addEst, 10) : null,
    };
    const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      setAddOpen(false); setAddTitle(''); setAddCourse(''); setAddEst('');
      await refresh();
    }
  }

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
        <div className="flex items-center gap-2 relative">
          <button onClick={() => { const d = new Date(year, month - 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); setMonthOpen(false); }} className="px-2 py-1 rounded border border-[#1b2344]">Prev</button>
          <button onClick={() => setMonthOpen(o => !o)} className="text-sm text-slate-300/90 min-w-[160px] text-center px-3 py-1 rounded border border-[#1b2344] bg-[#0b1020] hover:bg-[#0f1530]">
            {monthLabel}
          </button>
          <button onClick={() => { const d = new Date(year, month + 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); setMonthOpen(false); }} className="px-2 py-1 rounded border border-[#1b2344]">Next</button>
          <button onClick={openAdd} className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500">Add event</button>

          {monthOpen && (
            <div className="absolute z-10 top-[120%] left-1/2 -translate-x-1/2 bg-[#0b1020] border border-[#1b2344] rounded shadow-xl p-3 w-72">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setYear(y => y - 1)} className="px-2 py-1 rounded border border-[#1b2344]">◀</button>
                <div className="text-sm">{year}</div>
                <button onClick={() => setYear(y => y + 1)} className="px-2 py-1 rounded border border-[#1b2344]">▶</button>
              </div>
      {addOpen && (
        <div className="border border-[#1b2344] rounded p-3 bg-[#0b1020]">
          <div className="text-sm font-medium mb-2">Add event</div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs mb-1">Title</label>
              <input value={addTitle} onChange={e => setAddTitle(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            </div>
            <div>
              <label className="block text-xs mb-1">Date</label>
              <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            </div>
            <div>
              <label className="block text-xs mb-1">Course (optional)</label>
              <select value={addCourse} onChange={e => setAddCourse(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
                <option value="">-- none --</option>
                {courses.map((c: any) => (
                  <option key={c.id} value={c.title || c.code || ''}>{c.title || c.code}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1">Est. min (opt)</label>
              <input type="number" min={0} step={5} value={addEst} onChange={e => setAddEst(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={createEvent} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50" disabled={!addTitle || !addDate}>Create</button>
            <button onClick={() => setAddOpen(false)} className="px-3 py-2 rounded border border-[#1b2344]">Cancel</button>
          </div>
        </div>
      )}
              <div className="grid grid-cols-3 gap-2">
                {monthNames.map((name, idx) => (
                  <button key={idx} onClick={() => { setMonth(idx); setMonthOpen(false); }} className={`px-2 py-1 rounded border border-[#1b2344] text-sm ${idx===month ? 'bg-blue-600 hover:bg-blue-500' : 'hover:bg-[#0f1530]'}`}>{name}</button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button onClick={() => { const d = new Date(); setYear(d.getFullYear()); setMonth(d.getMonth()); setMonthOpen(false); }} className="px-2 py-1 rounded border border-[#1b2344]">Today</button>
                <button onClick={() => setMonthOpen(false)} className="px-2 py-1 rounded border border-[#1b2344]">Close</button>
              </div>
            </div>
          )}
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
