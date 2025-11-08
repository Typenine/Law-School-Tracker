"use client";
import { useEffect, useMemo, useState } from 'react';
import { Task } from '@/lib/types';
import { courseColorClass } from '@/lib/colors';
import TimePickerField from '@/components/TimePickerField';

export const dynamic = 'force-dynamic';

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }

function minutesToHM(min?: number | null) {
  const n = Math.max(0, Math.round(Number(min || 0)));
  const h = Math.floor(n/60);
  const m = n % 60;
  return `${h}:${String(m).padStart(2,'0')}`;
}

function extractPageRanges(title: string): string[] {
  try {
    const m = title.match(/p(?:ages?)?\.?\s*([0-9,\s–-]+(?:\s*,\s*[0-9–-]+)*)/i);
    if (!m) return [];
    const raw = m[1] || '';
    return raw.split(/\s*,\s*/).map(x => x.replace(/-/g, '–').trim()).filter(x => /\d/.test(x));
  } catch { return []; }
}

// Fallback course color as HSL string for left stripe
function hueFromString(s: string): number { let h = 0; for (let i=0;i<s.length;i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h % 360; }
function fallbackCourseHsl(name?: string | null): string { const key=(name||'').toString().trim().toLowerCase(); if (!key) return 'hsl(215 16% 47%)'; const h=hueFromString(key); return `hsl(${h} 70% 55%)`; }
function fmtYmd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function fmt12(hhmm?: string | null) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return '';
  const h12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

// Inline bulk-add events (tasks) for Calendar
function BulkAddEvents({ courses, onDone }: { courses: any[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<{ title: string; course: string; due: string; type: string; est: string }>>([]);
  function addRow() { setRows(r => [...r, { title: '', course: '', due: '', type: 'other', est: '' }]); }
  function removeRow(i: number) { setRows(r => r.filter((_, idx) => idx !== i)); }
  function updateRow(i: number, patch: Partial<{ title: string; course: string; due: string; type: string; est: string }>) {
    setRows(r => r.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  }
  async function submit() {
    const items = rows.filter(r => r.title && r.due).map(r => {
      const [y, m, d] = r.due.split('-').map(n => parseInt(n, 10));
      const due = new Date(y, (m as number) - 1, d, 23, 59, 59, 999).toISOString();
      const tags = r.type ? [r.type.toLowerCase()] : undefined;
      return { title: r.title, course: r.course || null, dueDate: due, status: 'todo', estimatedMinutes: r.est ? parseInt(r.est, 10) : null, tags };
    });
    if (!items.length) return;
    const res = await fetch('/api/tasks/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: items }) });
    if (res.ok) { setRows([]); setOpen(false); onDone(); }
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">Bulk add events</div>
        <button onClick={() => setOpen(o => !o)} className="text-xs underline">{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-12 text-[11px] text-slate-300/70">
            <div className="md:col-span-5">Title</div>
            <div className="md:col-span-3">Course</div>
            <div className="md:col-span-2">Date</div>
            <div className="md:col-span-1">Type</div>
            <div className="md:col-span-1">Est</div>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              <input value={r.title} onChange={e => updateRow(i, { title: e.target.value })} placeholder="e.g., Dentist appointment" className="md:col-span-5 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
              <select value={r.course} onChange={e => updateRow(i, { course: e.target.value })} className="md:col-span-3 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm">
                <option value="">-- none --</option>
                {(courses || []).map((c: any) => (
                  <option key={c.id} value={c.title || c.code || ''}>{c.title || c.code}</option>
                ))}
              </select>
              <input type="date" value={r.due} onChange={e => updateRow(i, { due: e.target.value })} className="md:col-span-2 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
              <select value={r.type} onChange={e => updateRow(i, { type: e.target.value })} className="md:col-span-1 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm">
                <option value="other">Other</option>
                <option value="reading">Reading</option>
                <option value="review">Review</option>
                <option value="outline">Outline</option>
                <option value="practice">Practice</option>
              </select>
              <div className="md:col-span-1 flex items-center gap-2">
                <input type="number" min={0} step={5} value={r.est} onChange={e => updateRow(i, { est: e.target.value })} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
                <button onClick={() => removeRow(i)} className="text-xs px-2 py-1 rounded border border-[#1b2344]">X</button>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button onClick={addRow} className="px-3 py-1.5 rounded border border-[#1b2344]">Add row</button>
            <button onClick={submit} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50" disabled={rows.length === 0}>Create events</button>
          </div>
        </div>
      )}
    </div>
  );
}
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
  const [addType, setAddType] = useState<string>('');
  const [addStartTime, setAddStartTime] = useState<string>('');
  const [addEndTime, setAddEndTime] = useState<string>('');
  const [showClasses, setShowClasses] = useState<boolean>(true);
  const [timedIcs, setTimedIcs] = useState<boolean>(false);
  const [icsToken, setIcsToken] = useState<string>('');
  const [density, setDensity] = useState<'comfortable'|'compact'>('comfortable');
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCourse, setEditCourse] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editEst, setEditEst] = useState('');
  const [editType, setEditType] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');

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
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const v = window.localStorage.getItem('calendarShowClasses');
      setShowClasses(v === null ? true : v === 'true');
      setIcsToken(window.localStorage.getItem('icsToken') || '');
      const d = window.localStorage.getItem('calendarDensity');
      if (d === 'comfortable' || d === 'compact') setDensity(d);
    }
  }, []);
  // Server-backed density setting
  useEffect(() => { (async () => { try { const r = await fetch('/api/settings?keys=calendarDensity', { cache: 'no-store' }); if (!r.ok) return; const j = await r.json(); const s = (j?.settings||{}) as Record<string,any>; const d = s.calendarDensity; if (d === 'comfortable' || d === 'compact') setDensity(d); } catch {} })(); }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('calendarShowClasses', String(showClasses));
  }, [showClasses]);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('calendarDensity', density);
    try { void fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calendarDensity: density }) }); } catch {}
  }, [density]);

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
    const toMin = (hhmm?: string | null) => {
      if (!hhmm || !/^[0-2]\d:[0-5]\d$/.test(hhmm)) return null;
      const [h, mi] = hhmm.split(':').map(Number);
      return h*60 + mi;
    };
    for (const k of Object.keys(m)) m[k].sort((a,b) => {
      const am = toMin((a as any).startTime);
      const bm = toMin((b as any).startTime);
      if (am !== null && bm !== null && am !== bm) return am - bm;
      if (am !== null && bm === null) return -1;
      if (am === null && bm !== null) return 1;
      return (a.title || '').localeCompare(b.title || '');
    });
    return m;
  }, [tasks, courseFilter, statusFilter]);

  const classesByDay = useMemo(() => {
    type ClassItem = { title: string; code?: string | null; time?: string | null; room?: string | null; colorKey: string; color?: string | null; startMin?: number; endMin?: number; conflict?: boolean };
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
                time: (b as any).start && (b as any).end ? `${fmt12((b as any).start)}–${fmt12((b as any).end)}` : null,
                room: (b as any).location || c.room || c.location || null,
                colorKey: c.title || c.code || 'course',
                color: (c as any).color || null,
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

  // Finals as calendar-only events (not tasks)
  const finalsByDay = useMemo(() => {
    type FinalItem = { title: string; time: string };
    const m: Record<string, FinalItem[]> = {};
    const finals: Array<{ iso: string; title: string }> = [
      { iso: '2025-12-12T09:00:00-06:00', title: 'Final — Amateur Sports Law' },
      { iso: '2025-12-17T09:00:00-06:00', title: 'Final — Intellectual Property' },
    ];
    for (const f of finals) {
      const dayKey = f.iso.slice(0, 10); // YYYY-MM-DD Chicago date
      (m[dayKey] ||= []).push({ title: f.title, time: fmt12('09:00') });
    }
    return m;
  }, []);

  const courseColors = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const c of courses as any[]) {
      const key = ((c.title || c.code || '') as string).toLowerCase();
      map[key] = (c as any).color || null;
    }
    return map;
  }, [courses]);

  const monthLabel = useMemo(() => new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' }), [year, month]);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const icsHref = useMemo(() => {
    const params: string[] = [];
    if (courseFilter) params.push(`course=${encodeURIComponent(courseFilter)}`);
    if (statusFilter !== 'all') params.push(`status=${encodeURIComponent(statusFilter)}`);
    if (timedIcs) params.push('timed=1');
    if (showClasses) params.push('classes=1');
    if (icsToken) params.push(`token=${encodeURIComponent(icsToken)}`);
    return `/api/export/ics${params.length ? `?${params.join('&')}` : ''}`;
  }, [courseFilter, statusFilter, timedIcs, showClasses, icsToken]);

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

  async function createEvent(stay?: boolean) {
    if (!addTitle || !addDate) return;
    const parts = addDate.split('-').map(n => parseInt(n, 10));
    if (parts.length !== 3) return;
    const d = new Date(parts[0], parts[1]-1, parts[2], 23,59,59,999);
    // If user set only start time, default end time to +60 minutes
    const toEnd = (start?: string) => {
      if (!start || !/^\d{2}:\d{2}$/.test(start)) return '';
      const [h, m] = start.split(':').map(Number);
      const total = h * 60 + m + 60; // +1h
      const hh = Math.floor((total % (24*60)) / 60);
      const mm = total % 60;
      return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    };

    const body: any = {
      title: addTitle,
      course: addCourse ? addCourse : null,
      dueDate: d.toISOString(),
      status: 'todo',
      estimatedMinutes: addEst ? parseInt(addEst, 10) : null,
      tags: addType ? [addType] : undefined,
    };
    if (addStartTime) body.startTime = addStartTime;
    const effectiveEnd = addEndTime || (addStartTime ? toEnd(addStartTime) : '');
    if (effectiveEnd) body.endTime = effectiveEnd;
    const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      if (stay) {
        setAddTitle(''); setAddEst('');
      } else {
        setAddOpen(false); setAddTitle(''); setAddCourse(''); setAddEst(''); setAddType(''); setAddStartTime(''); setAddEndTime('');
      }
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

  function openEdit(t: Task) {
    setEditTask(t);
    setEditTitle(t.title || '');
    setEditCourse(t.course || '');
    const d = new Date(t.dueDate);
    setEditDate(fmtYmd(d));
    setEditEst(typeof t.estimatedMinutes === 'number' ? String(t.estimatedMinutes) : '');
    setEditType((t.tags && t.tags.length) ? (t.tags[0] as any) : '');
    setEditStartTime((t as any).startTime || '');
    setEditEndTime((t as any).endTime || '');
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editTask) return;
    const body: any = {
      title: editTitle,
      course: editCourse || null,
      estimatedMinutes: editEst ? parseInt(editEst, 10) : null,
      tags: editType ? [editType] : null,
      startTime: editStartTime || null,
      endTime: editEndTime || null,
    };
    if (editDate) {
      const parts = editDate.split('-').map(n => parseInt(n, 10));
      if (parts.length === 3) {
        const nd = new Date(parts[0], parts[1]-1, parts[2], 23,59,59,999);
        body.dueDate = nd.toISOString();
      }
    }
    await fetch(`/api/tasks/${editTask.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setEditOpen(false); setEditTask(null);
    await refresh();
  }

  async function deleteEdit() {
    if (!editTask) return;
    await fetch(`/api/tasks/${editTask.id}`, { method: 'DELETE' });
    setEditOpen(false); setEditTask(null);
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
          <a href={icsHref} className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500">Download .ics</a>

          {monthOpen && (
            <div className="absolute z-10 top-[120%] left-1/2 -translate-x-1/2 bg-[#0b1020] border border-[#1b2344] rounded shadow-xl p-3 w-72">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setYear(y => y - 1)} className="px-2 py-1 rounded border border-[#1b2344]">◀</button>
                <div className="text-sm">{year}</div>
                <button onClick={() => setYear(y => y + 1)} className="px-2 py-1 rounded border border-[#1b2344]">▶</button>
              </div>
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
      {/* Add Event Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded border border-[#1b2344] bg-[#0b1020] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">Add event</div>
              <button onClick={() => setAddOpen(false)} className="text-xs underline">Close</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1">Title</label>
                <input value={addTitle} onChange={e => setAddTitle(e.target.value)} onKeyDown={e => { if (e.key==='Enter' && addTitle && addDate) createEvent(); }} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" placeholder="e.g., Dentist appointment" autoFocus />
              </div>
              <div>
                <label className="block text-xs mb-1">Date</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
                  <div className="flex items-center gap-1 text-[11px]">
                    <button onClick={() => setAddDate(fmtYmd(new Date()))} className="px-2 py-1 rounded border border-[#1b2344]">Today</button>
                    <button onClick={() => { const d=new Date(); d.setDate(d.getDate()+1); setAddDate(fmtYmd(d)); }} className="px-2 py-1 rounded border border-[#1b2344]">Tomorrow</button>
                    <button onClick={() => { const d=new Date(); const delta=(8-d.getDay())%7||7; d.setDate(d.getDate()+delta); setAddDate(fmtYmd(d)); }} className="px-2 py-1 rounded border border-[#1b2344]">Next Mon</button>
                    <button onClick={() => { const d=new Date(); const delta=(12-d.getDay())%7||7; d.setDate(d.getDate()+delta); setAddDate(fmtYmd(d)); }} className="px-2 py-1 rounded border border-[#1b2344]">Next Fri</button>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1">Course (optional)</label>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {(courses || []).map((c: any) => {
                    const label = c.title || c.code || '';
                    const selected = addCourse === label;
                    return (
                      <button key={c.id} onClick={() => setAddCourse(selected ? '' : label)} className={`px-2 py-1 rounded border text-xs whitespace-nowrap ${selected ? 'border-blue-500 bg-[#1a2243]' : 'border-[#1b2344]'}`}>
                        <span className={`inline-block w-2 h-2 rounded-full mr-1 ${c.color ? '' : courseColorClass(label, 'bg')}`} style={c.color ? { backgroundColor: (c.color as any) } : undefined}></span>
                        {label || '—'}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1">Type</label>
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  {['reading','review','outline','practice','assignment','other'].map(t => (
                    <button key={t} onClick={() => setAddType(addType===t ? '' : t)} className={`px-2 py-1 rounded border ${addType===t ? 'border-blue-500 bg-[#1a2243]' : 'border-[#1b2344]'}`}>{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1">Time (optional)</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <TimePickerField value={addStartTime} onChange={setAddStartTime} />
                  <span className="text-xs">–</span>
                  <TimePickerField value={addEndTime} onChange={setAddEndTime} />
                  <button onClick={() => { setAddStartTime(''); setAddEndTime(''); }} className="text-xs underline">No time</button>
                </div>
                <div className="mt-2 flex items-center gap-1 flex-wrap text-[11px]">
                  {[13,14,15,16,17,18,19,20].map(h => (
                    <button key={h} onClick={() => { const s=`${String(h).padStart(2,'0')}:00`; const e=`${String((h+1)%24).padStart(2,'0')}:00`; setAddStartTime(s); setAddEndTime(e); }} className="px-2 py-1 rounded border border-[#1b2344]">{fmt12(`${String(h).padStart(2,'0')}:00`)}–{fmt12(`${String((h+1)%24).padStart(2,'0')}:00`)}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1">Est. minutes (optional)</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="number" min={0} step={5} value={addEst} onChange={e => setAddEst(e.target.value)} className="w-28 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
                  {[15,30,45,60].map(n => (
                    <button key={n} onClick={() => setAddEst(String(n))} className="px-2 py-1 rounded border border-[#1b2344] text-xs">{n}m</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => createEvent(false)} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50" disabled={!addTitle || !addDate}>Create</button>
                <button onClick={() => createEvent(true)} className="px-3 py-2 rounded border border-[#1b2344] disabled:opacity-50" disabled={!addTitle || !addDate}>Create & Add Another</button>
                <button onClick={() => setAddOpen(false)} className="px-3 py-2 rounded border border-[#1b2344]">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Bulk add events */}
      <div className="card p-4">
        <BulkAddEvents courses={courses} onDone={refresh} />
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
        <div>
          <label className="block text-xs text-slate-300/70 mb-1">Display</label>
          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={showClasses} onChange={e => setShowClasses(e.target.checked)} /> Show class times</label>
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={timedIcs} onChange={e => setTimedIcs(e.target.checked)} /> Timed blocks (.ics)</label>
            <label className="inline-flex items-center gap-2 text-sm">
              Density
              <select value={density} onChange={e=>setDensity(e.target.value as any)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1">
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
          </div>
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
            <div key={idx} className={`border border-[#1b2344] rounded p-3 min-h-[160px] sm:min-h-[180px] md:min-h-[220px] ${monthClass}`} onClick={() => setSelectedDayKey(k)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropDay(e, d)}>
              <div className="text-xs text-slate-300/70 mb-1 flex items-center justify-between">
                <span className={`${fmtYmd(new Date())===k ? 'text-slate-200 font-semibold' : ''}`}>{d.getDate()}</span>
                {selectedDayKey === k && <span className="text-[10px] text-slate-300/60">Agenda</span>}
              </div>
              {/* Class meetings */}
              {showClasses && (classesByDay[k] && classesByDay[k].length > 0) && (
                <ul className="space-y-0.5 mb-1">
                  {classesByDay[k].map((c, idx) => (
                    <li key={idx} className={`text-[10px] flex flex-wrap items-center gap-1 break-words ${c.conflict ? 'text-rose-400' : 'text-slate-300/80'}`} title={c.conflict ? 'Time conflict' : ''}>
                      <span className={`inline-block w-2 h-2 rounded-full ${c.color ? '' : courseColorClass(c.title, 'bg')}`} style={c.color ? { backgroundColor: c.color as any } : undefined}></span>
                      <span className="text-slate-200">{c.code || c.title}</span>
                      {c.time ? <span className="text-slate-300/60"> · {c.time}</span> : null}
                      {c.conflict ? <span className="ml-1 text-[9px] px-1 rounded border border-rose-500 text-rose-400">conflict</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {/* Finals (calendar-only) */}
              {(finalsByDay[k] && finalsByDay[k].length > 0) && (
                <ul className="space-y-1 mb-1">
                  {finalsByDay[k].map((ev, idx) => (
                    <li key={idx} className="text-[11px] rounded border border-amber-600/60 bg-[#0b1020] px-2 py-1.5" style={{ borderLeft: '3px solid #f59e0b' }}>
                      <div className="min-w-0 flex flex-wrap items-center gap-2">
                        <span className="text-slate-200">{ev.title}</span>
                        <span className="text-slate-300/70">· {ev.time} CT</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {/* Tasks */}
              {list.length === 0 ? (
                <div className="text-[11px] text-slate-300/50">—</div>
              ) : (
                <ul className="space-y-1">
                  {(() => {
                    const maxVisible = density === 'compact' ? 6 : 4;
                    const isExpanded = expandedDays.has(k);
                    const visible = isExpanded ? list : list.slice(0, maxVisible);
                    const hidden = list.length - visible.length;
                    return (
                      <>
                        {visible.map(t => {
                          const key = (t.course || '').toLowerCase();
                          const stripe = courseColors[key] || fallbackCourseHsl(t.course || '');
                          return (
                            <li key={t.id} className="text-[11px] cursor-pointer rounded border border-[#2a3b6e] bg-[#0b1020] px-2 py-1.5" style={{ borderLeft: `3px solid ${stripe}` }} draggable onDragStart={(e) => onDragStart(e, t)} onClick={(e) => { e.stopPropagation(); openEdit(t); }}>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 break-words leading-tight">
                                  <span className="text-slate-200">{t.title}</span>
                                  {((t as any).startTime || (t as any).endTime) ? (
                                    <span className="text-slate-300/70">
                                      {((t as any).startTime ? fmt12((t as any).startTime as any) : '')}{((t as any).startTime && (t as any).endTime) ? '–' : ''}{((t as any).endTime ? fmt12((t as any).endTime as any) : '')}
                                    </span>
                                  ) : null}
                                  {t.course ? <span className="text-slate-300/70">· {t.course}</span> : null}
                                  {typeof t.estimatedMinutes === 'number' ? <span className="text-slate-300/70">· {minutesToHM(t.estimatedMinutes)}</span> : null}
                                </div>
                                {(t.tags && t.tags.length > 0) && (
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {t.tags.map((tg, i) => (
                                      <span key={i} className="text-[10px] px-1 py-0.5 rounded border border-[#2a3b6e]">{tg}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </li>
                          );
                        })}
                        {hidden > 0 && (
                          <li>
                            <button className="text-[11px] underline" onClick={(e) => { e.stopPropagation(); setExpandedDays(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; }); }}>
                              {isExpanded ? 'Show less' : `+${hidden} more`}
                            </button>
                          </li>
                        )}
                      </>
                    );
                  })()}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {editOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setEditOpen(false)}>
          <div className="w-full max-w-lg rounded border border-[#1b2344] bg-[#0b1020] p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">Edit event</div>
              <button onClick={() => setEditOpen(false)} className="text-xs underline">Close</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1">Title</label>
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
              </div>
              <div>
                <label className="block text-xs mb-1">Date</label>
                <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
              </div>
              <div>
                <label className="block text-xs mb-1">Course (optional)</label>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {(courses || []).map((c: any) => {
                    const label = c.title || c.code || '';
                    const selected = editCourse === label;
                    return (
                      <button key={c.id} onClick={() => setEditCourse(selected ? '' : label)} className={`px-2 py-1 rounded border text-xs whitespace-nowrap ${selected ? 'border-blue-500 bg-[#1a2243]' : 'border-[#1b2344]'}`}>
                        <span className={`inline-block w-2 h-2 rounded-full mr-1 ${c.color ? '' : courseColorClass(label, 'bg')}`} style={c.color ? { backgroundColor: (c.color as any) } : undefined}></span>
                        {label || '—'}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1">Type</label>
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  {['reading','review','outline','practice','assignment','other'].map(t => (
                    <button key={t} onClick={() => setEditType(editType===t ? '' : t)} className={`px-2 py-1 rounded border ${editType===t ? 'border-blue-500 bg-[#1a2243]' : 'border-[#1b2344]'}`}>{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1">Time (optional)</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <TimePickerField value={editStartTime} onChange={setEditStartTime} />
                  <span className="text-xs">–</span>
                  <TimePickerField value={editEndTime} onChange={setEditEndTime} />
                  <button onClick={() => { setEditStartTime(''); setEditEndTime(''); }} className="text-xs underline">No time</button>
                </div>
              </div>
              {(() => { const ranges = extractPageRanges(editTitle || ''); return ranges.length ? (
                <div className="text-xs text-slate-300/70">Pages: <span className="text-slate-100">{ranges.join(', ')}</span></div>
              ) : null; })()}
              <div>
                <label className="block text-xs mb-1">Est. minutes (optional)</label>
                <input type="number" min={0} step={5} value={editEst} onChange={e => setEditEst(e.target.value)} className="w-28 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={saveEdit} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500">Save</button>
                <button onClick={deleteEdit} className="px-3 py-2 rounded border border-rose-600 text-rose-400">Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
