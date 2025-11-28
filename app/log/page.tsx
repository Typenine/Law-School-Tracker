"use client";
import { useEffect, useMemo, useState, useCallback } from "react";

// Simple helpers
function chicagoYmd(d: Date): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = f.formatToParts(d);
  const y = parts.find(p=>p.type==='year')?.value || '0000';
  const m = parts.find(p=>p.type==='month')?.value || '01';
  const da = parts.find(p=>p.type==='day')?.value || '01';
  return `${y}-${m}-${da}`;
}
function fmtHM(min: number): string {
  const n = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
function extractCourseFromNotes(notes?: string | null): string {
  if (!notes) return '';
  const m = notes.match(/^\s*\[([^\]]+)\]/);
  return m ? m[1].trim() : '';
}
function normCourseKey(name?: string | null): string {
  let x = (name || '').toString().toLowerCase().trim();
  if (!x) return '';
  x = x.replace(/&/g, 'and');
  x = x.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (/\blaw$/.test(x)) x = x.replace(/\s*law$/, '');
  x = x.replace(/\badvanced\b/g, 'advance');
  return x;
}
function activityLabel(a?: string | null): string {
  const x = (a || '').toLowerCase();
  if (x === 'reading') return 'Reading';
  if (x === 'review') return 'Review';
  if (x === 'outline') return 'Outline';
  if (x === 'practice') return 'Practice';
  if (x === 'internship') return 'Other';
  if (!x) return 'Other';
  return x[0].toUpperCase() + x.slice(1);
}

// Focus color helper
function focusColor(f: number | null): string {
  if (f == null) return 'bg-slate-600';
  if (f >= 8) return 'bg-emerald-500';
  if (f >= 6) return 'bg-green-500';
  if (f >= 4) return 'bg-yellow-500';
  if (f >= 2) return 'bg-orange-500';
  return 'bg-red-500';
}

// Course color helpers
function hueFromString(s: string): number { let h = 0; for (let i=0;i<s.length;i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h % 360; }
function fallbackCourseHsl(name?: string | null): string { const key=(name||'').toString().trim().toLowerCase(); if (!key) return 'hsl(215 16% 47%)'; const h=hueFromString(key); return `hsl(${h} 70% 55%)`; }

export default function LogPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editMinutes, setEditMinutes] = useState<string>('');
  const [editFocus, setEditFocus] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editActivity, setEditActivity] = useState<string>('');
  const [editPagesRead, setEditPagesRead] = useState<string>('');
  
  // Undo state
  const [undoStack, setUndoStack] = useState<Array<{ type: 'delete'; session: any }>>([]);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);

  // Filters
  const [from, setFrom] = useState<string>(""); // YYYY-MM-DD
  const [to, setTo] = useState<string>("");
  const [courseContains, setCourseContains] = useState<string>("");
  const [activity, setActivity] = useState<string>("all");
  const [minFocus, setMinFocus] = useState<string>("");
  const [maxFocus, setMaxFocus] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("date_desc");
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  async function refresh() {
    setLoading(true);
    try {
      const [sRes, tRes, cRes] = await Promise.all([
        fetch('/api/sessions', { cache: 'no-store' }),
        fetch('/api/tasks', { cache: 'no-store' }),
        fetch('/api/courses', { cache: 'no-store' }),
      ]);
      const sj = await sRes.json().catch(()=>({ sessions: [] }));
      const tj = await tRes.json().catch(()=>({ tasks: [] }));
      const cj = await cRes.json().catch(()=>({ courses: [] }));
      setSessions(Array.isArray(sj?.sessions) ? sj.sessions : []);
      setTasks(Array.isArray(tj?.tasks) ? tj.tasks : []);
      setCourses(Array.isArray(cj?.courses) ? cj.courses : []);
    } finally {
      setLoading(false);
    }
  }
  function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

  async function openEditSession(id: string) {
    const s = (sessions||[]).find((x:any) => x.id === id); if (!s) return;
    setEditId(id);
    setEditMinutes(String(s.minutes || ''));
    setEditFocus(s.focus == null ? '' : String(s.focus));
    setEditNotes(s.notes || '');
    setEditActivity(s.activity || '');
    setEditPagesRead(s.pagesRead != null ? String(s.pagesRead) : '');
  }
  
  async function saveEditSession() {
    if (!editId) return;
    const patch: any = {};
    const m = parseInt(editMinutes || '0', 10); if (!isNaN(m) && m > 0) patch.minutes = m;
    const f = parseFloat(editFocus || ''); if (!isNaN(f)) patch.focus = Math.max(1, Math.min(10, f));
    patch.notes = editNotes || null;
    patch.activity = editActivity || null;
    const pr = parseInt(editPagesRead || '', 10);
    if (!isNaN(pr) && pr >= 0) patch.pagesRead = pr;
    try { await fetch(`/api/sessions/${editId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) }); } catch {}
    setEditId(null); setEditMinutes(''); setEditFocus(''); setEditNotes(''); setEditActivity(''); setEditPagesRead('');
    await refresh();
  }

  async function deleteSession(id: string) {
    const s = (sessions||[]).find((x:any) => x.id === id); if (!s) return;
    // Save to undo stack
    setUndoStack(prev => [...prev.slice(-9), { type: 'delete', session: s }]);
    setUndoMessage(`Deleted session (${fmtHM(s.minutes || 0)}). Click Undo to restore.`);
    setTimeout(() => setUndoMessage(null), 8000);
    try { await fetch(`/api/sessions/${id}`, { method:'DELETE' }); } catch {}
    await refresh();
  }

  async function undoLastDelete() {
    const last = undoStack[undoStack.length - 1];
    if (!last || last.type !== 'delete') return;
    const s = last.session;
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: s.taskId || null,
          when: s.when,
          minutes: s.minutes,
          focus: s.focus,
          notes: s.notes,
          activity: s.activity,
          pagesRead: s.pagesRead,
        }),
      });
    } catch {}
    setUndoStack(prev => prev.slice(0, -1));
    setUndoMessage('Session restored!');
    setTimeout(() => setUndoMessage(null), 3000);
    await refresh();
  }

  async function restoreToSchedule(id: string) {
    const s = (sessions||[]).find((x:any) => x.id === id); if (!s) return;
    try {
      const r = await fetch('/api/schedule', { cache:'no-store' }); const j = await r.json(); const blocks = Array.isArray(j.blocks) ? j.blocks : [];
      const whenKey = chicagoYmd(new Date(s.when));
      const task = s.taskId ? tasks.find((t:any)=>t.id===s.taskId) : null;
      const title = task?.title || 'Restored from log';
      const course = task?.course || extractCourseFromNotes(s.notes) || '';
      blocks.push({ id: uid(), taskId: s.taskId || uid(), day: whenKey, plannedMinutes: Math.max(1, Number(s.minutes)||0), guessed: true, title, course, pages: null, priority: null, catchup: false });
      await fetch('/api/schedule', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ blocks }) });
      setUndoMessage('Added back to schedule!');
      setTimeout(() => setUndoMessage(null), 3000);
    } catch {}
  }

  useEffect(() => {
    refresh();
    // Default range: last 30 days
    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - 30);
    setFrom(chicagoYmd(start));
    setTo(chicagoYmd(today));
  }, []);

  const tasksById = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of tasks) if (t && t.id) m.set(t.id, t);
    return m;
  }, [tasks]);

  const colorForCourse = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of (courses||[])) {
      const key = normCourseKey(c?.title || '');
      const col = (c?.color || '').toString().trim();
      if (key && col) map[key] = col;
    }
    return (name?: string | null) => {
      const raw = (name || '').toString();
      const k = normCourseKey(raw);
      try { if (typeof window !== 'undefined' && k === 'internship') { const ls = window.localStorage.getItem('internshipColor'); if (ls) return ls; } } catch {}
      try { if (typeof window !== 'undefined' && k === 'sports law review') { const ls = window.localStorage.getItem('sportsLawReviewColor'); if (ls) return ls; } } catch {}
      return map[k] || fallbackCourseHsl(raw || '');
    };
  }, [courses]);

  type Row = { id: string; when: string; ymd: string; minutes: number; course: string; activity: string; focus: number | null; notes: string | null };
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const s of (sessions||[])) {
      const when = String(s.when);
      const ymd = chicagoYmd(new Date(when));
      let course = '';
      if (s.taskId && tasksById.has(s.taskId)) course = tasksById.get(s.taskId)?.course || '';
      if (!course) {
        const act = (s.activity||'').toLowerCase();
        if (act === 'internship') course = 'Internship'; else course = extractCourseFromNotes(s.notes);
      }
      const notesL = (s.notes || '').toLowerCase();
      const courseL = (course || '').toLowerCase();
      if (courseL.includes('sports law review') || /\bslr\b/i.test(s.notes || '')) course = 'Sports Law Review';
      out.push({ id: s.id, when, ymd, minutes: Number(s.minutes)||0, course: course||'', activity: activityLabel(s.activity), focus: (typeof s.focus==='number'? s.focus : null), notes: s.notes ?? null });
    }
    out.sort((a,b) => b.when.localeCompare(a.when));
    return out;
  }, [sessions, tasksById]);

  const filtered = useMemo(() => {
    const minF = minFocus ? Math.max(1, Math.min(10, parseInt(minFocus, 10)||0)) : null;
    const maxF = maxFocus ? Math.max(1, Math.min(10, parseInt(maxFocus, 10)||10)) : null;
    const arr = rows.filter(r => {
      if (from && r.ymd < from) return false;
      if (to && r.ymd > to) return false;
      if (courseContains && !(r.course||'').toLowerCase().includes(courseContains.toLowerCase())) return false;
      if (activity !== 'all' && r.activity.toLowerCase() !== activity.toLowerCase()) return false;
      if (minF && (r.focus ?? 0) < minF) return false;
      if (maxF && (r.focus ?? 10) > maxF) return false;
      return true;
    });
    const s = sortBy;
    arr.sort((a, b) => {
      if (s === 'date_asc') return a.when.localeCompare(b.when);
      if (s === 'course_asc') return (a.course || '').localeCompare(b.course || '') || b.when.localeCompare(a.when);
      if (s === 'course_desc') return (b.course || '').localeCompare(a.course || '') || b.when.localeCompare(a.when);
      if (s === 'focus_desc') return ((b.focus ?? 0) - (a.focus ?? 0)) || b.when.localeCompare(a.when);
      if (s === 'focus_asc') return ((a.focus ?? 0) - (b.focus ?? 0)) || b.when.localeCompare(a.when);
      if (s === 'duration_desc') return (b.minutes - a.minutes) || b.when.localeCompare(a.when);
      // default date_desc
      return b.when.localeCompare(a.when);
    });
    return arr;
  }, [rows, from, to, courseContains, activity, minFocus, maxFocus, sortBy]);

  const totalMinutes = useMemo(() => filtered.reduce((s,r)=>s+(r.minutes||0), 0), [filtered]);
  
  // Stats
  const stats = useMemo(() => {
    const avgFocus = filtered.length > 0
      ? filtered.filter(r => r.focus != null).reduce((s,r) => s + (r.focus || 0), 0) / Math.max(1, filtered.filter(r => r.focus != null).length)
      : 0;
    const byActivity: Record<string, number> = {};
    const byCourse: Record<string, number> = {};
    for (const r of filtered) {
      byActivity[r.activity] = (byActivity[r.activity] || 0) + r.minutes;
      if (r.course) byCourse[r.course] = (byCourse[r.course] || 0) + r.minutes;
    }
    const topCourses = Object.entries(byCourse).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const topActivities = Object.entries(byActivity).sort((a,b) => b[1] - a[1]);
    return { avgFocus, byActivity, byCourse, topCourses, topActivities };
  }, [filtered]);

  function quickRange(days: number) {
    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - (days-1));
    setFrom(chicagoYmd(start));
    setTo(chicagoYmd(today));
  }

  async function exportCsv() {
    try {
      const headers = ['Date','Course','Task Type','Hours','Focus','Notes','Pages Read','Outline Pages','Practice Qs','Internship Time'];
      const lines: string[] = [];
      lines.push(headers.join(','));
      for (const s of filtered) {
        const hours = (Math.max(0, Number(s.minutes)||0) / 60).toFixed(3);
        const csvEscape = (x: any) => {
          const str = String(x ?? '');
          return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g,'""') + '"' : str;
        };
        const fields = [
          new Date(s.when).toLocaleDateString('en-US'),
          s.course || '',
          s.activity,
          hours,
          (s.focus == null ? '' : String(s.focus)),
          (s.notes ?? ''),
          '', '', '', ''
        ].map(csvEscape);
        lines.push(fields.join(','));
      }
      const csv = lines.join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const today = new Date().toISOString().slice(0,10);
      a.href = url; a.download = `sessions-${today}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  }

  return (
    <main className="space-y-6">
      {/* Undo Toast */}
      {undoMessage && (
        <div className="fixed top-4 right-4 z-50 bg-[#1b2344] border border-emerald-500/50 rounded-lg px-4 py-3 shadow-xl flex items-center gap-3">
          <span className="text-sm">{undoMessage}</span>
          {undoStack.length > 0 && (
            <button onClick={undoLastDelete} className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-medium">Undo</button>
          )}
          <button onClick={() => setUndoMessage(null)} className="text-slate-400 hover:text-white">×</button>
        </div>
      )}

      {/* Stats Cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-xs text-slate-300/70">Total Time</div>
          <div className="text-2xl font-semibold text-emerald-400">{fmtHM(totalMinutes)}</div>
          <div className="text-xs text-slate-300/50">{filtered.length} sessions</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-300/70">Avg Focus</div>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${focusColor(stats.avgFocus)}`} />
            <div className="text-2xl font-semibold">{stats.avgFocus > 0 ? stats.avgFocus.toFixed(1) : '—'}</div>
          </div>
          <div className="text-xs text-slate-300/50">/10 scale</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-300/70 mb-1">By Activity</div>
          <div className="space-y-1">
            {stats.topActivities.slice(0, 3).map(([act, mins]) => (
              <div key={act} className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{act}</span>
                <span className="text-slate-400">{fmtHM(mins)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-300/70 mb-1">Top Courses</div>
          <div className="space-y-1">
            {stats.topCourses.slice(0, 3).map(([course, mins]) => (
              <div key={course} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: colorForCourse(course) }} />
                  <span className="truncate text-slate-300">{course}</span>
                </div>
                <span className="text-slate-400 ml-2">{fmtHM(mins)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">Study Log</h2>
            <div className="text-xs text-slate-300/70">Track completed study sessions. Central time.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => quickRange(7)} className={`px-2 py-1 rounded text-xs ${from && to && chicagoYmd(new Date(to)) === chicagoYmd(new Date()) && (new Date(to).getTime() - new Date(from).getTime()) / 86400000 <= 7 ? 'bg-blue-600' : 'border border-[#1b2344]'}`}>7d</button>
            <button onClick={() => quickRange(30)} className={`px-2 py-1 rounded text-xs ${from && to && chicagoYmd(new Date(to)) === chicagoYmd(new Date()) && (new Date(to).getTime() - new Date(from).getTime()) / 86400000 > 7 && (new Date(to).getTime() - new Date(from).getTime()) / 86400000 <= 30 ? 'bg-blue-600' : 'border border-[#1b2344]'}`}>30d</button>
            <button onClick={() => { setFrom(''); setTo(''); }} className="px-2 py-1 rounded border border-[#1b2344] text-xs">All</button>
            <button onClick={refresh} className="px-2 py-1 rounded border border-[#1b2344] text-xs">↻</button>
            <button onClick={exportCsv} className="px-2 py-1 rounded bg-teal-600 hover:bg-teal-500 text-xs">Export</button>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
          <div>
            <label className="block text-xs text-slate-300/70" htmlFor="f-from">From</label>
            <input id="f-from" type="date" value={from} onChange={e=>setFrom(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70" htmlFor="f-to">To</label>
            <input id="f-to" type="date" value={to} onChange={e=>setTo(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70" htmlFor="f-course">Course</label>
            <input id="f-course" placeholder="Filter..." value={courseContains} onChange={e=>setCourseContains(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70" htmlFor="f-activity">Activity</label>
            <select id="f-activity" value={activity} onChange={e=>setActivity(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1.5 text-sm">
              <option value="all">All</option>
              <option value="reading">Reading</option>
              <option value="review">Review</option>
              <option value="outline">Outline</option>
              <option value="practice">Practice</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-300/70">Focus Range</label>
            <div className="flex items-center gap-1">
              <input type="number" min={1} max={10} placeholder="1" value={minFocus} onChange={e=>setMinFocus(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1.5 text-sm" />
              <span className="text-slate-400">–</span>
              <input type="number" min={1} max={10} placeholder="10" value={maxFocus} onChange={e=>setMaxFocus(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-300/70" htmlFor="f-sort">Sort</label>
            <select id="f-sort" value={sortBy} onChange={e=>setSortBy(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1.5 text-sm">
              <option value="date_desc">Newest</option>
              <option value="date_asc">Oldest</option>
              <option value="focus_desc">Focus ↓</option>
              <option value="focus_asc">Focus ↑</option>
              <option value="duration_desc">Duration ↓</option>
              <option value="course_asc">Course A→Z</option>
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={() => { setCourseContains(''); setActivity('all'); setMinFocus(''); setMaxFocus(''); }} className="px-3 py-1.5 rounded border border-[#1b2344] text-xs w-full">Clear Filters</button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60 border-b border-[#1b2344]">
              <tr>
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Course</th>
                <th className="py-2 pr-3 font-medium">Activity</th>
                <th className="py-2 pr-3 font-medium">Duration</th>
                <th className="py-2 pr-3 font-medium">Focus</th>
                <th className="py-2 pr-3 font-medium">Notes</th>
                <th className="py-2 pr-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="py-4 text-center text-slate-400" colSpan={7}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="py-4 text-center text-slate-400" colSpan={7}>No sessions match filters. Try adjusting the date range or filters.</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-t border-[#1b2344] hover:bg-white/5 transition-colors">
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-300">
                      <div className="text-sm">{new Date(r.when).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                      <div className="text-xs text-slate-400">{new Date(r.when).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        {r.course ? <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorForCourse(r.course) }} /> : null}
                        <span className="truncate max-w-[140px]">{r.course || '—'}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="px-2 py-0.5 rounded bg-white/10 text-xs">{r.activity}</span>
                    </td>
                    <td className="py-2 pr-3 font-medium">{fmtHM(r.minutes)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${focusColor(r.focus)}`} />
                        <span className="font-medium">{r.focus ?? '—'}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 max-w-[200px]">
                      <span className="truncate inline-block max-w-[180px] text-slate-400 text-xs">{r.notes || '—'}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1">
                        <button onClick={()=>openEditSession(r.id)} className="px-2 py-1 rounded border border-[#1b2344] text-xs hover:bg-white/5">Edit</button>
                        <button onClick={()=>restoreToSchedule(r.id)} className="px-2 py-1 rounded border border-blue-600/50 text-blue-400 text-xs hover:bg-blue-900/20" title="Add back to schedule">+Sched</button>
                        <button onClick={()=>deleteSession(r.id)} className="px-2 py-1 rounded border border-rose-700/50 text-rose-400 text-xs hover:bg-rose-900/20">Del</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Edit Modal */}
      {editId && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={()=>setEditId(null)} />
          <div className="relative z-10 w-[92vw] max-w-md bg-[#0b1020] border border-[#1b2344] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-lg font-medium">Edit Session</div>
              <button onClick={()=>setEditId(null)} className="text-slate-400 hover:text-white">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300/70 mb-1">Minutes</label>
                <input type="number" min={1} step={1} value={editMinutes} onChange={e=>setEditMinutes(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
              </div>
              <div>
                <label className="block text-xs text-slate-300/70 mb-1">Focus (1–10)</label>
                <input type="number" min={1} max={10} step={0.5} value={editFocus} onChange={e=>setEditFocus(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
              </div>
              <div>
                <label className="block text-xs text-slate-300/70 mb-1">Activity</label>
                <select value={editActivity} onChange={e=>setEditActivity(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
                  <option value="">—</option>
                  <option value="reading">Reading</option>
                  <option value="review">Review</option>
                  <option value="outline">Outline</option>
                  <option value="practice">Practice</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-300/70 mb-1">Pages Read</label>
                <input type="number" min={0} value={editPagesRead} onChange={e=>setEditPagesRead(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-300/70 mb-1">Notes</label>
              <input value={editNotes} onChange={e=>setEditNotes(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" placeholder="Optional notes..." />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button onClick={saveEditSession} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 font-medium">Save Changes</button>
              <button onClick={()=>setEditId(null)} className="px-4 py-2 rounded border border-[#1b2344]">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
