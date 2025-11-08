"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Course, NewTaskInput, Task } from "@/lib/types";

type Props = { onCreated?: () => void };

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function round5(n: number) { return Math.round(n / 5) * 5; }
function fmtHM(min: number | null | undefined): string {
  const n = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function minutesPerPageFor(course: string): number {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem('courseMppMap') : null;
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, { mpp: number }>;
      const key = (course || '').trim().toLowerCase();
      const v = obj[key]?.mpp;
      if (typeof v === 'number' && v > 0) return clamp(v, 0.5, 6.0);
    }
  } catch {}
  return 3.0;
}

function parseRanges(input: string): { pages: number; normLabel: string; valid: boolean; tooMany: boolean } {
  const s = (input || '').trim();
  if (!s) return { pages: 0, normLabel: '', valid: true, tooMany: false };
  const cleaned = s.replace(/pp\.?\s*/gi, '').replace(/–/g, '-').replace(/\s+/g, '');
  const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
  let pages = 0; const labels: string[] = [];
  for (const p of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p);
    if (!m) return { pages: 0, normLabel: '', valid: false, tooMany: false };
    const a = parseInt(m[1], 10); const b = m[2] ? parseInt(m[2], 10) : a;
    if (isNaN(a) || isNaN(b) || b < a) return { pages: 0, normLabel: '', valid: false, tooMany: false };
    pages += (b - a + 1);
    labels.push(`${a}–${b}`);
  }
  const tooMany = pages > 150;
  return { pages, normLabel: labels.join(', '), valid: true, tooMany };
}

export default function AddTaskPanel({ onCreated }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [course, setCourse] = useState<string>('');
  const [courseId, setCourseId] = useState<string>('');
  const [activity, setActivity] = useState<string>('reading');
  const [range, setRange] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [due, setDue] = useState<string>('');
  const dueRef = useRef<HTMLInputElement>(null);
  const [estimateOrigin, setEstimateOrigin] = useState<'learned'|'default'|'manual'|null>(null);
  const [manualEst, setManualEst] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [setDefaultForCourse, setSetDefaultForCourse] = useState(false);
  const [dupWarn, setDupWarn] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const [cRes, tRes] = await Promise.all([
          fetch('/api/courses', { cache: 'no-store' }),
          fetch('/api/tasks', { cache: 'no-store' })
        ]);
        const cj = await cRes.json().catch(() => ({ courses: [] }));
        const tj = await tRes.json().catch(() => ({ tasks: [] }));
        setCourses(Array.isArray(cj?.courses) ? cj.courses : []);
        setTasks(Array.isArray(tj?.tasks) ? tj.tasks : []);
      } catch {}
      try { const last = window.localStorage.getItem('lastTaskCourse') || ''; if (last) setCourse(last); } catch {}
    })();
  }, []);

  useEffect(() => {
    const found = courses.find(c => (c.title || '') === course || (c.code || '') === course);
    setCourseId(found?.id || '');
    const def = (found as any)?.defaultActivity as string | null | undefined;
    if (def) setActivity(def);
  }, [course, courses]);

  const pages = useMemo(() => {
    if (activity !== 'reading') return 0;
    const res = parseRanges(range);
    return res.valid ? res.pages : 0;
  }, [activity, range]);

  const est = useMemo(() => {
    if (estimateOrigin === 'manual') {
      const n = parseInt(manualEst || '0', 10);
      return isNaN(n) ? 0 : Math.max(0, n);
    }
    if (activity === 'reading') {
      const mpp = minutesPerPageFor(course);
      const minutes = pages > 0 ? pages * mpp + 10 : 0;
      return round5(minutes);
    }
    const defaults: Record<string, number> = { review: 30, outline: 45, practice: 60, clinic: 60, admin: 15, other: 30 };
    return round5(defaults[activity] ?? 30);
  }, [activity, course, pages, estimateOrigin, manualEst]);

  useEffect(() => {
    if (estimateOrigin === 'manual') return;
    if (activity === 'reading') {
      try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem('courseMppMap') : null;
        const obj = raw ? JSON.parse(raw) : null;
        const key = (course || '').trim().toLowerCase();
        const origin = (obj && obj[key] && typeof obj[key].mpp === 'number') ? 'learned' : 'default';
        setEstimateOrigin(origin as any);
      } catch { setEstimateOrigin('default'); }
    } else {
      setEstimateOrigin('default');
    }
  }, [activity, course, pages]);

  useEffect(() => {
    if (!course || !title || !due) { setDupWarn(''); return; }
    const exists = tasks.some(t => ((t.course||'') === (course||'')) && ((t.title||'').trim().toLowerCase() === title.trim().toLowerCase()) && (new Date(t.dueDate).toISOString().slice(0,16) === new Date(due).toISOString().slice(0,16)));
    setDupWarn(exists ? 'A task with the same course, title, and due already exists.' : '');
  }, [course, title, due, tasks]);

  useEffect(() => {
    if (activity === 'reading') {
      const res = parseRanges(range);
      const label = res.normLabel;
      if (label) setTitle(`Read pp. ${label}`);
    }
  }, [activity, range]);

  function quickPickTonight() {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0, 0);
    setDue(d.toISOString().slice(0,16));
  }
  function quickPickFri5p() {
    const now = new Date();
    const d = new Date(now);
    const dow = d.getDay();
    const delta = (5 - dow + 7) % 7; // Fri=5
    d.setDate(d.getDate() + delta);
    d.setHours(17,0,0,0);
    setDue(d.toISOString().slice(0,16));
  }
  function quickPickNextClass() {
    const c = courses.find(x => x.id === courseId);
    if (!c || !(c.meetingDays && c.meetingDays.length)) return;
    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const dow = d.getDay();
      if (c.meetingDays.includes(dow)) {
        const [hh, mm] = (c.meetingStart || '17:00').split(':').map(v => parseInt(v,10));
        d.setHours(hh||17, mm||0, 0, 0);
        setDue(d.toISOString().slice(0,16));
        break;
      }
    }
  }

  async function saveDefaultActivity() {
    if (!setDefaultForCourse || !courseId) return;
    try {
      await fetch(`/api/courses/${courseId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultActivity: activity }) });
    } catch {}
  }

  async function addTask(plan: boolean) {
    if (!course || !activity || !due) return;
    try {
      const dueDt = new Date(due);
      if (dueDt.getTime() < Date.now()) {
        const ok = window.confirm('This due date/time is in the past. Add anyway?');
        if (!ok) return;
      }
    } catch {}
    setSaving(true);
    try {
      try { window.localStorage.setItem('lastTaskCourse', course); } catch {}
      if (setDefaultForCourse) await saveDefaultActivity();
      const payload: NewTaskInput = {
        title: title || (activity==='reading' ? 'Read' : 'Task'),
        course: course || null,
        dueDate: new Date(due).toISOString(),
        status: 'todo',
        estimatedMinutes: est || null,
        estimateOrigin: estimateOrigin || null,
        pagesRead: activity==='reading' ? (pages||null) : null,
        activity: activity || null,
      } as any;
      const r = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error('create failed');
      if (plan) {
        try {
          const tj = await r.json().catch(()=>null);
          const newId = tj?.task?.id || null;
          const schRaw = window.localStorage.getItem('weekScheduleV1') || '[]';
          let arr: any[] = []; try { arr = JSON.parse(schRaw); } catch { arr = []; }
          // availability by day-of-week
          let avail: Record<number, number> = {};
          try { avail = JSON.parse(window.localStorage.getItem('availabilityTemplateV1') || '{}'); } catch {}
          const today = new Date(); today.setHours(0,0,0,0);
          const dueDt = new Date(due);
          dueDt.setHours(23,59,59,999);
          function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
          function plannedFor(dayYmd: string) { return arr.filter(x => x?.day === dayYmd).reduce((s,x)=>s+Math.max(0, Number(x.plannedMinutes)||0),0); }
          let placeYmd: string | null = null;
          for (let i = 0; i < 7; i++) {
            const d = new Date(today); d.setDate(d.getDate() + i);
            if (d > dueDt) break;
            const dow = d.getDay();
            const cap = Math.max(0, Number((avail as any)[dow] || 0));
            const dayY = ymd(d);
            const used = plannedFor(dayY);
            if ((cap - used) >= (est || 0)) { placeYmd = dayY; break; }
          }
          if (!placeYmd) {
            // fallback to due date day
            placeYmd = ymd(new Date(due));
            try { window.alert('Could not auto-plan within capacity this week. Placed on due date.'); } catch {}
          }
          arr.push({ id: crypto.randomUUID(), taskId: newId, day: placeYmd, plannedMinutes: est || 0, title, course });
          window.localStorage.setItem('weekScheduleV1', JSON.stringify(arr));
        } catch {}
      }
      setTitle(''); setRange(''); setManualEst(''); setEstimateOrigin(null); setDupWarn('');
      onCreated?.();
    } catch {
    } finally { setSaving(false); }
  }

  const parsed = parseRanges(range);

  return (
    <div className="mb-3 border border-[#1b2344] rounded p-3 bg-[#0b1020] space-y-2" onKeyDown={(e)=>{
      if (e.key === 'Escape') { setTitle(''); setRange(''); setDue(''); setManualEst(''); setEstimateOrigin(null); }
      if (e.key === 'Enter') {
        e.preventDefault();
        if ((e as any).shiftKey) addTask(true); else addTask(false);
      }
    }}>
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Course</div>
          <select value={course} onChange={e=>setCourse(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 min-w-[220px]">
            <option value="">Select…</option>
            {courses.map(c => (<option key={c.id} value={c.title || c.code || ''}>{c.title || c.code}</option>))}
          </select>
        </div>
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Activity</div>
          <select value={activity} onChange={e=>setActivity(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
            <option value="reading">Reading</option>
            <option value="review">Review</option>
            <option value="outline">Outline</option>
            <option value="practice">Practice</option>
            <option value="clinic">Clinic/Internship</option>
            <option value="admin">Admin</option>
            <option value="other">Other</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={setDefaultForCourse} onChange={e=>setSetDefaultForCourse(e.target.checked)} /> Set as default for this course
        </label>
      </div>

      {activity === 'reading' && (
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <div className="text-xs text-slate-300/70 mb-1">Reading range</div>
            <input value={range} onChange={e=>setRange(e.target.value)} placeholder="111-123, 130-142" className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 min-w-[260px]" />
          </div>
          <div className="text-xs text-slate-300/70">
            {parsed.valid ? (
              <div>Pages: <span className="text-slate-100 font-medium">{pages}</span>{parsed.tooMany ? <span className="ml-2 text-amber-400">Split with Reading Split Wizard?</span> : null}</div>
            ) : (
              <div className="text-rose-400">Invalid range</div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[260px]">
          <div className="text-xs text-slate-300/70 mb-1">Title</div>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder={activity==='reading' ? 'Read pp. 111–123' : 'Title'} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Due (date & time)</div>
          <input
            ref={dueRef}
            type="datetime-local"
            value={due}
            onChange={e=>setDue(e.target.value)}
            onDoubleClick={() => { try { (dueRef.current as any)?.showPicker?.(); dueRef.current?.focus(); } catch {} }}
            className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2"
          />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={quickPickTonight} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Tonight 9p</button>
          <button type="button" onClick={quickPickFri5p} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Fri 5p</button>
          <button type="button" onClick={quickPickNextClass} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Next class</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="text-xs text-slate-300/70">Estimate</div>
        {estimateOrigin === 'manual' ? (
          <input type="number" min={0} step={5} value={manualEst} onChange={e=>setManualEst(e.target.value)} className="w-24 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
        ) : (
          <div className="text-sm px-2 py-1 rounded border border-[#1b2344]">≈ {fmtHM(est || 0)} ({estimateOrigin || 'auto'})</div>
        )}
        <button type="button" onClick={() => setEstimateOrigin(estimateOrigin==='manual'? null : 'manual')} className="px-2 py-1 rounded border border-[#1b2344] text-xs">{estimateOrigin==='manual' ? 'Auto' : 'Edit'}</button>
        {dupWarn && <div className="text-xs text-amber-400">{dupWarn} <span className="text-slate-300/60">(Add anyway allowed)</span></div>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button disabled={!course || !activity || !due || saving} onClick={() => addTask(false)} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">Add</button>
        <button disabled={!course || !activity || !due || saving} onClick={() => addTask(true)} className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">Add & Plan</button>
      </div>
    </div>
  );
}
