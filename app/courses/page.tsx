"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Course, CourseMeetingBlock, Semester } from '@/lib/types';
import { courseColorClass } from '@/lib/colors';

export const dynamic = 'force-dynamic';

const SEMS: Semester[] = ['Spring','Summer','Fall'];

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');
  const [semFilter, setSemFilter] = useState<Semester | 'all'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Course>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [newCourse, setNewCourse] = useState<Partial<Course>>({ title: '', meetingDays: [], meetingBlocks: [], semester: undefined, year: undefined, color: undefined });
  const [timeMode, setTimeMode] = useState<'simple' | 'advanced'>('simple');
  const [simpleDuration, setSimpleDuration] = useState<string>('75'); // minutes
  const [addErr, setAddErr] = useState<string>('');
  const [adding, setAdding] = useState<boolean>(false);
  const [addDebug, setAddDebug] = useState<{ status?: number; message?: string; payload?: any } | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    setLoading(true);
    const res = await fetch('/api/courses', { cache: 'no-store' });
    const data = await res.json();
    setCourses((data.courses || []) as Course[]);
    setLoading(false);
  }
  const timeSlots = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const value = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        const hh = ((h + 11) % 12) + 1;
        const ampm = h < 12 ? 'AM' : 'PM';
        const label = `${hh}:${String(m).padStart(2,'0')} ${ampm}`;
        out.push({ value, label });
      }
    }
    return out;
  }, []);

  function computeEnd(hhmm: string | null | undefined, minutes: number) {
    if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
    const [hStr, mStr] = hhmm.split(':');
    const h = parseInt(hStr, 10), m = parseInt(mStr, 10);
    if (isNaN(h) || isNaN(m)) return '';
    const total = h * 60 + m + (isNaN(minutes) ? 0 : minutes);
    const norm = ((total % 1440) + 1440) % 1440;
    const hh = Math.floor(norm / 60);
    const mi = norm % 60;
    return `${String(hh).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
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
  useEffect(() => { refresh(); }, []);

  // When opening Add Course, prefill semester/year from current filters (if set)
  useEffect(() => {
    if (addOpen) {
      setNewCourse(n => ({
        ...n,
        semester: n.semester ?? (semFilter !== 'all' ? semFilter : n.semester),
        year: n.year ?? (yearFilter !== 'all' ? yearFilter : n.year),
      }));
    }
  }, [addOpen, semFilter, yearFilter]);

  const years = useMemo(() => {
    const ys = Array.from(new Set(courses.map(c => c.year).filter((n): n is number => typeof n === 'number'))).sort((a,b)=>b-a);
    return ys;
  }, [courses]);

  const titleInvalid = !String(newCourse.title || '').trim();

  const filtered = useMemo(() => courses.filter(c =>
    (yearFilter === 'all' || c.year === yearFilter) &&
    (semFilter === 'all' || c.semester === semFilter)
  ), [courses, yearFilter, semFilter]);

  function prettyDays(days?: number[] | null) {
    if (!days || days.length === 0) return '-';
    const map = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return days.map(d => map[d] || '').join(' ');
  }

  const conflictIds = useMemo(() => {
    // Detect conflicts (time overlaps) between courses in the filtered list
    const ids = new Set<string>();
    const toMin = (hhmm?: string | null) => {
      if (!hhmm) return null;
      const [h, m] = hhmm.split(':').map(x => parseInt(x, 10));
      if (isNaN(h) || isNaN(m)) return null; return h*60+m;
    };
    type Block = { id: string; days: number[]; startMin: number; endMin: number; startDate?: Date | null; endDate?: Date | null };
    const blocks: Block[] = [];
    for (const c of filtered) {
      const startDate = c.startDate ? new Date(c.startDate) : null;
      const endDate = c.endDate ? new Date(c.endDate) : null;
      const mb = Array.isArray(c.meetingBlocks) && c.meetingBlocks.length
        ? c.meetingBlocks
        : ((Array.isArray(c.meetingDays) && c.meetingStart && c.meetingEnd) ? [{ days: c.meetingDays, start: c.meetingStart, end: c.meetingEnd } as any] : []);
      for (const b of mb as CourseMeetingBlock[]) {
        const s = toMin((b as any).start); const e = toMin((b as any).end);
        if (s == null || e == null || !Array.isArray(b.days) || b.days.length === 0) continue;
        blocks.push({ id: c.id, days: b.days, startMin: s, endMin: e, startDate, endDate });
      }
    }
    // Compare pairwise
    for (let i=0;i<blocks.length;i++) {
      for (let j=i+1;j<blocks.length;j++) {
        const a = blocks[i], b = blocks[j];
        if (a.id === b.id) continue;
        // date range overlap (ignore if either has no range)
        const drOverlap = (!a.startDate || !b.startDate || !a.endDate || !b.endDate) || (a.startDate! <= b.endDate! && b.startDate! <= a.endDate!);
        if (!drOverlap) continue;
        if (a.days.some(d => b.days.includes(d))) {
          if (a.startMin < b.endMin && b.startMin < a.endMin) {
            ids.add(a.id); ids.add(b.id);
          }
        }
      }
    }
    return ids;
  }, [filtered]);

  function startEdit(c: Course) {
    setEditingId(c.id);
    setForm({ ...c });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({});
  }

  async function saveEdit() {
    if (!editingId) return;
    const payload: any = { ...form };
    // Coerce year to number or null
    if (payload.year !== undefined) {
      const n = typeof payload.year === 'string' ? parseInt(payload.year, 10) : payload.year;
      payload.year = isNaN(n as any) ? null : n;
    }
    // Ensure meetingDays is number[]
    if (Array.isArray(payload.meetingDays)) {
      payload.meetingDays = (payload.meetingDays as number[]).filter((n) => typeof n === 'number');
    }
    const res = await fetch(`/api/courses/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) {
      cancelEdit();
      await refresh();
    }
  }

  async function removeCourse(id: string) {
    if (!confirm('Delete this course?')) return;
    const res = await fetch(`/api/courses/${id}`, { method: 'DELETE' });
    if (res.ok) await refresh();
  }

  return (
    <main className="space-y-4">
      {/* Global time suggestions for time inputs */}
      <datalist id="time-options">
        {timeSlots.map(ts => (<option key={ts.value} value={ts.value} label={ts.label} />))}
      </datalist>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Courses</h2>
        <button onClick={refresh} className="px-2 py-1 rounded border border-[#1b2344]">Refresh</button>
      </div>
      <div className="border border-[#1b2344] rounded p-3 bg-[#0b1020]">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Add Course</div>
          <button onClick={() => setAddOpen(v => !v)} className="text-xs underline">{addOpen ? 'Hide' : 'Show'}</button>
        </div>
        {addOpen && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const titleFromRef = (titleRef.current?.value ?? '');
              const titleFromState = String(newCourse.title || '');
              const titleTrim = (titleFromRef || titleFromState).trim();
              setAddDebug({ status: undefined, message: 'Submit fired', payload: { title_ref: titleFromRef, title_state: newCourse.title ?? null } });
              if (!titleTrim) {
                // Show hint but still attempt POST so server error surfaces clearly.
                setAddErr('Please enter a course title.');
              } else {
                setAddErr('');
              }
              setAdding(true);
              const clean = (v: any) => (v === undefined || v === '' ? null : v);
              const semVal = (() => {
                const s = (newCourse.semester as any) || null;
                return (s === 'Spring' || s === 'Summer' || s === 'Fall' || s === 'Winter') ? s : null;
              })();
              const blocksRaw = Array.isArray(newCourse.meetingBlocks) ? (newCourse.meetingBlocks as any[]) : [];
              const blocks = blocksRaw
                .map(b => ({
                  days: Array.isArray((b as any).days) ? ((b as any).days as number[]) : [],
                  start: String((b as any).start || '').trim(),
                  end: String((b as any).end || '').trim(),
                  location: clean((b as any).location),
                }))
                .filter(b => b.days.length > 0 && b.start && b.end);
              const payload: any = {
                code: clean(newCourse.code),
                title: (titleTrim || ''),
                instructor: clean(newCourse.instructor),
                instructorEmail: clean(newCourse.instructorEmail),
                room: clean(newCourse.room ?? newCourse.location),
                location: clean(newCourse.location),
                color: clean(newCourse.color as any),
                meetingDays: (newCourse.meetingDays && (newCourse.meetingDays as number[]).length) ? newCourse.meetingDays : null,
                meetingStart: clean(newCourse.meetingStart),
                meetingEnd: clean(newCourse.meetingEnd),
                meetingBlocks: blocks.length ? blocks : null,
                startDate: clean(newCourse.startDate ? String(newCourse.startDate).slice(0,10) : ''),
                endDate: clean(newCourse.endDate ? String(newCourse.endDate).slice(0,10) : ''),
                semester: semVal,
                year: typeof newCourse.year === 'number' ? newCourse.year : (newCourse.year ? parseInt(String(newCourse.year), 10) : null),
              };
              try {
                setAddDebug({ status: undefined, message: 'Submitting…', payload });
                const res = await fetch('/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (res.ok) {
                  const data = await res.json().catch(() => null as any);
                  const created = (data && (data as any).course) ? (data as any).course : null;
                  if (created) {
                    setCourses(prev => [...prev, created as any].sort((a, b) => (a.title || '').localeCompare(b.title || '')));
                  }
                  setNewCourse({ title: '', meetingDays: [], meetingBlocks: [], color: undefined });
                  setTimeMode('simple'); setSimpleDuration('75');
                  await refresh();
                  setAddDebug({ status: res.status, message: created?.id ? `Created (${created.id})` : 'Created', payload: undefined });
                } else {
                  const ct = res.headers.get('content-type') || '';
                  const body = ct.includes('application/json') ? await res.json() : await res.text();
                  const msg = typeof body === 'string' ? body : (body?.error || JSON.stringify(body));
                  setAddErr(msg || 'Failed to create course');
                  setAddDebug({ status: res.status, message: msg, payload });
                }
              } catch (e: any) {
                setAddErr(e?.message || 'Failed to create course');
                setAddDebug({ status: undefined, message: e?.message || 'Network error', payload });
              } finally {
                setAdding(false);
              }
            }}
            className="mt-2"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input placeholder="Code (optional)" value={newCourse.code ?? ''} onChange={e => setNewCourse(n => ({ ...n, code: e.target.value }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
            <div className="space-y-1">
              <input ref={titleRef} name="title" required placeholder="Title*" value={newCourse.title ?? ''} onChange={e => setNewCourse(n => ({ ...n, title: e.target.value }))} className={`bg-[#0b1020] border rounded px-2 py-1 ${titleInvalid ? 'border-rose-500' : 'border-[#1b2344]'}`} />
              {titleInvalid && <div className="text-[11px] text-rose-400">Title is required. Seen: "{String(newCourse.title || '')}"</div>}
            </div>
            <input placeholder="Instructor" value={newCourse.instructor ?? ''} onChange={e => setNewCourse(n => ({ ...n, instructor: e.target.value }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
            <input placeholder="Instructor Email" value={newCourse.instructorEmail ?? ''} onChange={e => setNewCourse(n => ({ ...n, instructorEmail: e.target.value }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
            <input placeholder="Room/Location" value={newCourse.room ?? newCourse.location ?? ''} onChange={e => setNewCourse(n => ({ ...n, room: e.target.value, location: e.target.value }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-300/70">Color</label>
              <input type="color" value={(newCourse.color as any) ?? '#7c3aed'} onChange={e => setNewCourse(n => ({ ...n, color: e.target.value }))} className="h-8 w-12 bg-transparent" />
            </div>

            {/* Time entry mode */}
            <div className="md:col-span-3 flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-300/70">Time entry mode</span>
              <div className="inline-flex rounded border border-[#1b2344] overflow-hidden text-xs">
                <button type="button" onClick={() => setTimeMode('simple')} className={`px-2 py-1 ${timeMode==='simple'?'bg-[#1a2243]':''}`}>Simple</button>
                <button type="button" onClick={() => setTimeMode('advanced')} className={`px-2 py-1 ${timeMode==='advanced'?'bg-[#1a2243]':''}`}>Advanced</button>
              </div>
              <span className="text-[11px] text-slate-300/60">Simple: one set of days/time. Advanced: different times per day.</span>
            </div>

            {timeMode === 'simple' && (
            <div className="flex items-center gap-2 flex-wrap">
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, idx) => (
                <label key={idx} className="inline-flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={(newCourse.meetingDays || []).includes(idx)} onChange={e => {
                    const set: Set<number> = new Set<number>((newCourse.meetingDays || []) as number[]);
                    if (e.target.checked) set.add(idx); else set.delete(idx);
                    setNewCourse(n => ({ ...n, meetingDays: (Array.from(set as Set<number>) as number[]).sort((a, b) => a - b) }));
                  }} />{d}
                </label>
              ))}
              {/* Quick patterns */}
              <div className="inline-flex items-center gap-1 ml-2">
                <span className="text-[11px] text-slate-300/60">Quick:</span>
                <button type="button" className="text-[11px] px-2 py-0.5 rounded border border-[#1b2344]" onClick={() => setNewCourse(n => ({ ...n, meetingDays: [1,3] }))}>M/W</button>
                <button type="button" className="text-[11px] px-2 py-0.5 rounded border border-[#1b2344]" onClick={() => setNewCourse(n => ({ ...n, meetingDays: [2,4] }))}>T/Th</button>
                <button type="button" className="text-[11px] px-2 py-0.5 rounded border border-[#1b2344]" onClick={() => setNewCourse(n => ({ ...n, meetingDays: [1,3,5] }))}>M/W/F</button>
                <button type="button" className="text-[11px] px-2 py-0.5 rounded border border-[#1b2344]" onClick={() => setNewCourse(n => ({ ...n, meetingDays: [1,2,3,4,5] }))}>Mon–Fri</button>
                <button type="button" className="text-[11px] px-2 py-0.5 rounded border border-[#1b2344]" onClick={() => setNewCourse(n => ({ ...n, meetingDays: [] }))}>Clear</button>
              </div>
            </div>
            )}
            {timeMode === 'simple' && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <input type="time" step={60} list="time-options" onFocus={e => (e.currentTarget as any).showPicker?.()} value={newCourse.meetingStart ?? ''} onChange={e => {
                  const v = e.target.value;
                  setNewCourse(n => ({ ...n, meetingStart: v, meetingEnd: computeEnd(v, parseInt(simpleDuration || '0', 10) || 0) || n.meetingEnd }));
                }} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                <span className="text-xs">–</span>
                <input type="time" step={60} list="time-options" onFocus={e => (e.currentTarget as any).showPicker?.()} value={newCourse.meetingEnd ?? ''} onChange={e => setNewCourse(n => ({ ...n, meetingEnd: e.target.value }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-300/70">Duration (min)</span>
                <input type="number" min={0} step={5} value={simpleDuration} onChange={e => { const v = e.target.value; setSimpleDuration(v); setNewCourse(n => ({ ...n, meetingEnd: computeEnd(n.meetingStart || '', parseInt(v || '0', 10) || 0) || n.meetingEnd })); }} className="w-20 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                <div className="inline-flex gap-1">
                  {['50','75','90'].map(p => (
                    <button key={p} type="button" onClick={() => { setSimpleDuration(p); setNewCourse(n => ({ ...n, meetingEnd: computeEnd(n.meetingStart || '', parseInt(p, 10)) || n.meetingEnd })); }} className="text-[11px] px-2 py-0.5 rounded border border-[#1b2344]">{p}m</button>
                  ))}
                </div>
              </div>
              <div className="text-[11px] text-slate-300/60">Preview: {prettyDays(newCourse.meetingDays)} {newCourse.meetingStart && newCourse.meetingEnd ? ` ${fmt12(newCourse.meetingStart)}–${fmt12(newCourse.meetingEnd)}` : ''}{(newCourse.location || newCourse.room) ? ` · ${(newCourse.location || newCourse.room)}` : ''}</div>
            </div>
            )}
            {/* Meeting blocks editor (advanced) */}
            {timeMode === 'advanced' && (
            <div className="md:col-span-3 border border-[#1b2344] rounded p-2">
              <div className="text-xs text-slate-300/70 mb-1">Meeting blocks (optional, for different times per day)</div>
              <div className="space-y-2">
                {(newCourse.meetingBlocks as any[] || []).map((b: any, bi: number) => (
                  <div key={bi} className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1">
                      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, idx) => (
                        <label key={idx} className="inline-flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={(b.days || []).includes(idx)} onChange={e => {
                            const list = [...(newCourse.meetingBlocks as any[] || [])];
                            const set: Set<number> = new Set<number>(((list[bi] as any).days || []) as number[]);
                            if (e.target.checked) set.add(idx); else set.delete(idx);
                            (list[bi] as any).days = (Array.from(set as Set<number>) as number[]).sort((a, b) => a - b);
                            setNewCourse(n => ({ ...n, meetingBlocks: list }));
                          }} />{d}
                        </label>
                      ))}
                    </div>
                    <input type="time" step={60} list="time-options" onFocus={e => (e.currentTarget as any).showPicker?.()} value={(b as any).start || ''} onChange={e => {
                      const list = [...(newCourse.meetingBlocks as any[] || [])];
                      (list[bi] as any).start = e.target.value; setNewCourse(n => ({ ...n, meetingBlocks: list }));
                    }} className="bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5" />
                    <span className="text-xs">–</span>
                    <input type="time" step={60} list="time-options" onFocus={e => (e.currentTarget as any).showPicker?.()} value={(b as any).end || ''} onChange={e => {
                      const list = [...(newCourse.meetingBlocks as any[] || [])];
                      (list[bi] as any).end = e.target.value; setNewCourse(n => ({ ...n, meetingBlocks: list }));
                    }} className="bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5" />
                    <input placeholder="Location" value={(b as any).location || ''} onChange={e => {
                      const list = [...(newCourse.meetingBlocks as any[] || [])];
                      (list[bi] as any).location = e.target.value; setNewCourse(n => ({ ...n, meetingBlocks: list }));
                    }} className="bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5" />
                    <button type="button" onClick={() => {
                      const list = [...(newCourse.meetingBlocks as any[] || [])];
                      list.splice(bi,1); setNewCourse(n => ({ ...n, meetingBlocks: list }));
                    }} className="text-xs px-2 py-0.5 rounded border border-[#1b2344]">Remove</button>
                    <button type="button" onClick={() => {
                      const list = [...(newCourse.meetingBlocks as any[] || [])];
                      const dup = { ...(list[bi] as any) };
                      list.splice(bi+1, 0, dup);
                      setNewCourse(n => ({ ...n, meetingBlocks: list }));
                    }} className="text-xs px-2 py-0.5 rounded border border-[#1b2344]">Duplicate</button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => {
                  const list = [...(newCourse.meetingBlocks as any[] || [])];
                  list.push({ days: [], start: '', end: '', location: '' });
                  setNewCourse(n => ({ ...n, meetingBlocks: list }));
                }} className="text-xs px-2 py-1 rounded border border-[#1b2344]">Add block</button>
                <span className="text-[11px] text-slate-300/60">Tip: Use Simple mode for a single schedule, Advanced for multiple times.</span>
              </div>
            </div>
            )}

            <div className="flex items-center gap-1">
              <input type="date" onFocus={e => (e.currentTarget as any).showPicker?.()} value={(newCourse.startDate ? String(newCourse.startDate).slice(0,10) : '')} onChange={e => setNewCourse(n => ({ ...n, startDate: e.target.value }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
              <span className="text-xs">–</span>
              <input type="date" onFocus={e => (e.currentTarget as any).showPicker?.()} value={(newCourse.endDate ? String(newCourse.endDate).slice(0,10) : '')} onChange={e => setNewCourse(n => ({ ...n, endDate: e.target.value }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
            </div>
            <div className="flex items-center gap-2">
              <select value={(newCourse.semester as any) ?? ''} onChange={e => setNewCourse(n => ({ ...n, semester: (e.target.value || null) as any }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1">
                <option value="">Semester</option>
                {SEMS.map(s => (<option key={s} value={s}>{s}</option>))}
              </select>
              <input type="number" placeholder="Year" value={(newCourse.year as any) ?? ''} onChange={e => setNewCourse(n => ({ ...n, year: e.target.value ? parseInt(e.target.value, 10) : undefined }))} className="w-28 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
            </div>
            <div className="md:col-span-3">
              <div className="flex items-center gap-3 flex-wrap">
              <button type="submit" onClick={() => setAddDebug({ status: undefined, message: 'Clicked submit', payload: { title_state: newCourse.title ?? null } })} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50" disabled={adding}>{adding ? 'Creating…' : 'Create'}</button>
              {addErr && <div className="text-xs text-rose-400">{addErr}</div>}
              {addDebug && (
                <div className="text-[11px] text-slate-300/70">
                  <span className="mr-2">Status: {addDebug.status ?? '-'}</span>
                  <span className="mr-2">Message: {addDebug.message ?? '-'}</span>
                  {addDebug.payload ? (
                    <details className="inline-block ml-2">
                      <summary>Payload</summary>
                      <pre className="whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(addDebug.payload, null, 2)}</pre>
                    </details>
                  ) : null}
                </div>
              )}
              </div>
            </div>
            </div>
          </form>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-slate-300/70 mb-1">Year</label>
          <select value={yearFilter} onChange={e => setYearFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
            <option value="all">All</option>
            {years.map(y => (<option key={y} value={y}>{y}</option>))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-300/70 mb-1">Semester</label>
          <select value={semFilter} onChange={e => setSemFilter(e.target.value as any)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
            <option value="all">All</option>
            {SEMS.map(s => (<option key={s} value={s}>{s}</option>))}
          </select>
        </div>
      </div>
      {loading ? (
        <div className="text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-slate-300/80">
          No courses yet. Use the <span className="underline">Syllabus Import</span> on the Settings page, or add a course above.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Title</th>
                <th className="py-2 pr-4">Instructor</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Room</th>
                <th className="py-2 pr-4">Meeting</th>
                <th className="py-2 pr-4">Dates</th>
                <th className="py-2 pr-4">Term</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className={`border-t border-[#1b2344] ${conflictIds.has(c.id) ? 'bg-[#151a2d]' : ''}`}>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {editingId === c.id ? (
                      <div className="flex items-center gap-2">
                        <input value={form.code ?? ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="w-28 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                        <input type="color" value={(form.color as any) ?? (c.color || '#7c3aed')} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} className="h-6 w-10 bg-transparent" />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${c.color ? '' : courseColorClass(c.title || c.code || '', 'bg')}`} style={c.color ? { backgroundColor: c.color as any } : undefined}></span>
                        <span>{c.code || '-'}</span>
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {editingId === c.id ? (
                      <input value={form.title ?? ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : c.title}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {editingId === c.id ? (
                      <input value={form.instructor ?? ''} onChange={e => setForm(f => ({ ...f, instructor: e.target.value }))} className="w-40 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (c.instructor || '-')}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {editingId === c.id ? (
                      <input value={form.instructorEmail ?? ''} onChange={e => setForm(f => ({ ...f, instructorEmail: e.target.value }))} className="w-44 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (c.instructorEmail ? (<a className="underline" href={`mailto:${c.instructorEmail}`}>{c.instructorEmail}</a>) : '-')}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {editingId === c.id ? (
                      <input value={form.room ?? form.location ?? ''} onChange={e => setForm(f => ({ ...f, room: e.target.value, location: e.target.value }))} className="w-36 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                    ) : (c.room || c.location || '-')}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap align-top">
                    {editingId === c.id ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1">
                            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, idx) => (
                              <label key={idx} className="inline-flex items-center gap-1 text-xs">
                                <input type="checkbox" checked={(form.meetingDays || []).includes(idx)} onChange={e => {
                                  const set: Set<number> = new Set<number>((form.meetingDays || []) as number[]);
                                  if (e.target.checked) set.add(idx as number); else set.delete(idx as number);
                                  setForm(f => ({ ...f, meetingDays: (Array.from(set as Set<number>) as number[]).sort((a, b) => a - b) }));
                                }} />{d}
                              </label>
                            ))}
                          </div>
                          <div className="flex items-center gap-1">
                            <input type="time" step={60} list="time-options" onFocus={e => (e.currentTarget as any).showPicker?.()} value={form.meetingStart ?? ''} onChange={e => setForm(f => ({ ...f, meetingStart: e.target.value }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5" />
                            <span className="text-xs">–</span>
                            <input type="time" step={60} list="time-options" onFocus={e => (e.currentTarget as any).showPicker?.()} value={form.meetingEnd ?? ''} onChange={e => setForm(f => ({ ...f, meetingEnd: e.target.value }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5" />
                          </div>
                        </div>
                        {/* Meeting blocks editor */}
                        <div className="border border-[#1b2344] rounded p-2">
                          <div className="text-xs text-slate-300/70 mb-1">Meeting blocks</div>
                          <div className="space-y-2">
                            {(form.meetingBlocks as any as CourseMeetingBlock[] | undefined)?.map((b, bi) => (
                              <div key={bi} className="flex items-center gap-2 flex-wrap">
                                <div className="flex items-center gap-1">
                                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, idx) => (
                                    <label key={idx} className="inline-flex items-center gap-1 text-xs">
                                      <input type="checkbox" checked={(b.days || []).includes(idx)} onChange={e => {
                                        const list = [...(form.meetingBlocks as any as CourseMeetingBlock[] || [])];
                                        const set: Set<number> = new Set<number>(((list[bi] as any).days || []) as number[]);
                                        if (e.target.checked) set.add(idx); else set.delete(idx);
                                        (list[bi] as any).days = (Array.from(set as Set<number>) as number[]).sort((a, b) => a - b);
                                        setForm(f => ({ ...f, meetingBlocks: list }));
                                      }} />{d}
                                    </label>
                                  ))}
                                </div>
                                <input type="time" step={60} list="time-options" onFocus={e => (e.currentTarget as any).showPicker?.()} value={(b as any).start || ''} onChange={e => {
                                  const list = [...(form.meetingBlocks as any as CourseMeetingBlock[] || [])];
                                  (list[bi] as any).start = e.target.value; setForm(f => ({ ...f, meetingBlocks: list }));
                                }} className="bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5" />
                                <span className="text-xs">–</span>
                                <input type="time" step={60} list="time-options" onFocus={e => (e.currentTarget as any).showPicker?.()} value={(b as any).end || ''} onChange={e => {
                                  const list = [...(form.meetingBlocks as any as CourseMeetingBlock[] || [])];
                                  (list[bi] as any).end = e.target.value; setForm(f => ({ ...f, meetingBlocks: list }));
                                }} className="bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5" />
                                <input placeholder="Location" value={(b as any).location || ''} onChange={e => {
                                  const list = [...(form.meetingBlocks as any as CourseMeetingBlock[] || [])];
                                  (list[bi] as any).location = e.target.value; setForm(f => ({ ...f, meetingBlocks: list }));
                                }} className="bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5" />
                                <button type="button" onClick={() => {
                                  const list = [...(form.meetingBlocks as any as CourseMeetingBlock[] || [])];
                                  list.splice(bi,1); setForm(f => ({ ...f, meetingBlocks: list }));
                                }} className="text-xs px-2 py-0.5 rounded border border-[#1b2344]">Remove</button>
                              </div>
                            ))}
                          </div>
                          <button type="button" onClick={() => {
                            const list = [...(form.meetingBlocks as any as CourseMeetingBlock[] || [])];
                            list.push({ days: [], start: '', end: '', location: '' });
                            setForm(f => ({ ...f, meetingBlocks: list }));
                          }} className="mt-2 text-xs px-2 py-1 rounded border border-[#1b2344]">Add block</button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        {/* Prefer blocks if present */}
                        {Array.isArray(c.meetingBlocks) && c.meetingBlocks.length ? (
                          <div className="space-y-0.5">
                            {c.meetingBlocks.map((b, i) => (
                              <div key={i} className="whitespace-nowrap">{prettyDays(b.days)} {(b as any).start && (b as any).end ? ` ${fmt12((b as any).start)}–${fmt12((b as any).end)}` : ''} {(b as any).location ? ` · ${(b as any).location}` : ''}</div>
                            ))}
                          </div>
                        ) : (
                          <>
                            {prettyDays(c.meetingDays)} {c.meetingStart && c.meetingEnd ? ` ${fmt12(c.meetingStart)}–${fmt12(c.meetingEnd)}` : ''}
                          </>
                        )}
                        {conflictIds.has(c.id) ? <div className="mt-1 text-[10px] px-1 rounded border border-rose-500 text-rose-400 inline-block">conflict</div> : null}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {editingId === c.id ? (
                      <div className="flex items-center gap-1">
                        <input type="date" value={(form.startDate ? form.startDate.slice(0,10) : '')} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5" />
                        <span className="text-xs">–</span>
                        <input type="date" value={(form.endDate ? form.endDate.slice(0,10) : '')} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5" />
                      </div>
                    ) : (<>
                      {(c.startDate ? new Date(c.startDate).toLocaleDateString() : '-')}
                      {' – '}
                      {(c.endDate ? new Date(c.endDate).toLocaleDateString() : '-')}
                    </>)}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {editingId === c.id ? (
                      <div className="flex items-center gap-2">
                        <select value={(form.semester as any) ?? ''} onChange={e => setForm(f => ({ ...f, semester: (e.target.value || null) as any }))} className="bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5">
                          <option value="">-</option>
                          {SEMS.map(s => (<option key={s} value={s}>{s}</option>))}
                        </select>
                        <input type="number" value={(form.year as any) ?? ''} onChange={e => setForm(f => ({ ...f, year: e.target.value ? parseInt(e.target.value, 10) : null }))} className="w-24 bg-[#0b1020] border border-[#1b2344] rounded px-1 py-0.5" />
                      </div>
                    ) : (<>
                      {c.semester || '-'} {c.year || ''}
                    </>)}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {editingId === c.id ? (
                      <div className="space-x-1">
                        <button onClick={saveEdit} className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500">Save</button>
                        <button onClick={cancelEdit} className="px-2 py-1 rounded border border-[#1b2344]">Cancel</button>
                      </div>
                    ) : (
                      <div className="space-x-1">
                        <button onClick={() => startEdit(c)} className="px-2 py-1 rounded border border-[#1b2344]">Edit</button>
                        <button onClick={() => removeCourse(c.id)} className="px-2 py-1 rounded border border-[#1b2344]">Delete</button>
                        <a href={`/calendar?course=${encodeURIComponent(c.title)}`} className="px-2 py-1 rounded border border-[#1b2344]">Calendar</a>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
