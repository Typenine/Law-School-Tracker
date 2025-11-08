"use client";
import { useEffect, useMemo, useState } from "react";

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

// Course color helpers
function hueFromString(s: string): number { let h = 0; for (let i=0;i<s.length;i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h % 360; }
function fallbackCourseHsl(name?: string | null): string { const key=(name||'').toString().trim().toLowerCase(); if (!key) return 'hsl(215 16% 47%)'; const h=hueFromString(key); return `hsl(${h} 70% 55%)`; }

export default function LogPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [from, setFrom] = useState<string>(""); // YYYY-MM-DD
  const [to, setTo] = useState<string>("");
  const [courseContains, setCourseContains] = useState<string>("");
  const [activity, setActivity] = useState<string>("all");
  const [minFocus, setMinFocus] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("date_desc");

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
      const key = (c?.title || '').toString().trim().toLowerCase();
      const col = (c?.color || '').toString().trim();
      if (key && col) map[key] = col;
    }
    return (name?: string | null) => {
      const k = (name || '').toString().trim().toLowerCase();
      return map[k] || fallbackCourseHsl(name || '');
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
        course = ((s.activity||'').toLowerCase()==='internship') ? 'Internship' : extractCourseFromNotes(s.notes);
      }
      out.push({ id: s.id, when, ymd, minutes: Number(s.minutes)||0, course: course||'', activity: activityLabel(s.activity), focus: (typeof s.focus==='number'? s.focus : null), notes: s.notes ?? null });
    }
    out.sort((a,b) => b.when.localeCompare(a.when));
    return out;
  }, [sessions, tasksById]);

  const filtered = useMemo(() => {
    const minF = minFocus ? Math.max(1, Math.min(10, parseInt(minFocus, 10)||0)) : null;
    const arr = rows.filter(r => {
      if (from && r.ymd < from) return false;
      if (to && r.ymd > to) return false;
      if (courseContains && !(r.course||'').toLowerCase().includes(courseContains.toLowerCase())) return false;
      if (activity !== 'all' && r.activity.toLowerCase() !== activity.toLowerCase()) return false;
      if (minF && (r.focus ?? 0) < minF) return false;
      return true;
    });
    const s = sortBy;
    arr.sort((a, b) => {
      if (s === 'date_asc') return a.when.localeCompare(b.when);
      if (s === 'course_asc') return (a.course || '').localeCompare(b.course || '') || b.when.localeCompare(a.when);
      if (s === 'course_desc') return (b.course || '').localeCompare(a.course || '') || b.when.localeCompare(a.when);
      // default date_desc
      return b.when.localeCompare(a.when);
    });
    return arr;
  }, [rows, from, to, courseContains, activity, minFocus, sortBy]);

  const totalMinutes = useMemo(() => filtered.reduce((s,r)=>s+(r.minutes||0), 0), [filtered]);

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
      <section className="card p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">Log</h2>
            <div className="text-xs text-slate-300/70">View your study sessions as completed work. Central time.</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => quickRange(7)} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Last 7d</button>
            <button onClick={() => quickRange(30)} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Last 30d</button>
            <button onClick={() => { setFrom(''); setTo(''); }} className="px-2 py-1 rounded border border-[#1b2344] text-xs">All time</button>
            <button onClick={refresh} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Refresh</button>
            <button onClick={exportCsv} className="px-2 py-1 rounded bg-teal-600 hover:bg-teal-500 text-xs">Export CSV</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
          <div>
            <label className="block text-xs text-slate-300/70" htmlFor="f-from">From</label>
            <input id="f-from" type="date" value={from} onChange={e=>setFrom(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70" htmlFor="f-to">To</label>
            <input id="f-to" type="date" value={to} onChange={e=>setTo(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70" htmlFor="f-course">Course contains</label>
            <input id="f-course" value={courseContains} onChange={e=>setCourseContains(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70" htmlFor="f-activity">Activity</label>
            <select id="f-activity" value={activity} onChange={e=>setActivity(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 text-sm">
              <option value="all">All</option>
              <option value="reading">Reading</option>
              <option value="review">Review</option>
              <option value="outline">Outline</option>
              <option value="practice">Practice</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-300/70" htmlFor="f-minfocus">Min Focus</label>
            <input id="f-minfocus" type="number" min={1} max={10} value={minFocus} onChange={e=>setMinFocus(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70" htmlFor="f-sort">Sort by</label>
            <select id="f-sort" value={sortBy} onChange={e=>setSortBy(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 text-sm">
              <option value="date_desc">Date (newest)</option>
              <option value="date_asc">Date (oldest)</option>
              <option value="course_asc">Course (A→Z)</option>
              <option value="course_desc">Course (Z→A)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-300/70">{filtered.length} sessions · {fmtHM(totalMinutes)}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-1 pr-2">When</th>
                <th className="py-1 pr-2">Course</th>
                <th className="py-1 pr-2">Activity</th>
                <th className="py-1 pr-2">Duration</th>
                <th className="py-1 pr-2">Focus</th>
                <th className="py-1 pr-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-[#1b2344]"><td className="py-2" colSpan={6}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr className="border-t border-[#1b2344]"><td className="py-2" colSpan={6}>No sessions match. Adjust filters or import data in Settings → Import.</td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-t border-[#1b2344]">
                    <td className="py-1 pr-2 whitespace-nowrap">{new Date(r.when).toLocaleString()}</td>
                    <td className="py-1 pr-2">
                      <div className="flex items-center gap-2">
                        {r.course ? <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorForCourse(r.course) }} /> : null}
                        <span>{r.course || '—'}</span>
                      </div>
                    </td>
                    <td className="py-1 pr-2">{r.activity}</td>
                    <td className="py-1 pr-2">{fmtHM(r.minutes)}</td>
                    <td className="py-1 pr-2">{r.focus ?? '—'}</td>
                    <td className="py-1 pr-2 max-w-[360px]"><span className="truncate inline-block max-w-[340px] align-bottom">{r.notes || '—'}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
