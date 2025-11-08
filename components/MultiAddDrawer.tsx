"use client";
import { useEffect, useMemo, useState } from "react";
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

function parseRanges(input: string): { pages: number; normLabel: string; valid: boolean } {
  const s = (input || '').trim();
  if (!s) return { pages: 0, normLabel: '', valid: true };
  const cleaned = s.replace(/pp\.?\s*/gi, '').replace(/–/g, '-').replace(/\s+/g, '');
  const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
  let pages = 0; const labels: string[] = [];
  for (const p of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p);
    if (!m) return { pages: 0, normLabel: '', valid: false };
    const a = parseInt(m[1], 10); const b = m[2] ? parseInt(m[2], 10) : a;
    if (isNaN(a) || isNaN(b) || b < a) return { pages: 0, normLabel: '', valid: false };
    pages += (b - a + 1);
    labels.push(`${a}–${b}`);
  }
  return { pages, normLabel: labels.join(', '), valid: true };
}

type Draft = { course: string; activity: string; title: string; pages: number; due: string; estimate: number; estimateOrigin: 'learned'|'default' };

export default function MultiAddDrawer({ onCreated }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [mode, setMode] = useState<'paste'|'grid'>('paste');
  const [course, setCourse] = useState('');
  const [activity, setActivity] = useState<'reading'|'review'|'outline'|'practice'|'clinic'|'admin'|'assignment'|'other'>('reading');
  const [baseDue, setBaseDue] = useState('');
  const [stepDays, setStepDays] = useState('1');
  const [paste, setPaste] = useState('');
  const [rows, setRows] = useState<number>(5);
  const [grid, setGrid] = useState<Array<{ text: string; due: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [lastBatchToken, setLastBatchToken] = useState<string>('');

  useEffect(() => {
    (async () => {
      try { const r = await fetch('/api/courses', { cache: 'no-store' }); const j = await r.json(); setCourses(Array.isArray(j?.courses) ? j.courses : []); } catch {}
      try { const t = window.localStorage.getItem('lastMultiAddBatchToken') || ''; setLastBatchToken(t); } catch {}
    })();
  }, []);

  useEffect(() => {
    setGrid(Array.from({ length: rows }, () => ({ text: '', due: '' })));
  }, [rows]);

  function computeEstimate(courseName: string, act: string, pages: number): { minutes: number; origin: 'learned'|'default' } {
    if (act === 'reading') {
      const mpp = minutesPerPageFor(courseName);
      const learned = (() => {
        try {
          const raw = window.localStorage.getItem('courseMppMap');
          const obj = raw ? JSON.parse(raw) : null;
          const key = (courseName || '').trim().toLowerCase();
          return (obj && obj[key] && typeof obj[key].mpp === 'number');
        } catch { return false; }
      })();
      const minutes = pages > 0 ? round5(pages * mpp + 10) : 0;
      return { minutes, origin: learned ? 'learned' : 'default' };
    }
    const defaults: Record<string, number> = { review: 30, outline: 45, practice: 60, clinic: 60, admin: 15, assignment: 60, other: 30 };
    return { minutes: round5(defaults[act] ?? 30), origin: 'default' };
  }

  const preview: Draft[] = useMemo(() => {
    const out: Draft[] = [];
    const step = Math.max(0, parseInt(stepDays || '0', 10) || 0);
    const base = baseDue ? new Date(baseDue) : null;
    if (mode === 'paste') {
      const lines = paste.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      lines.forEach((line, i) => {
        let title = line; let pages = 0;
        if (activity === 'reading') {
          const r = parseRanges(line);
          if (r.valid) {
            pages = r.pages; title = r.normLabel ? `Read pp. ${r.normLabel}` : 'Read';
          } else {
            return; // skip invalid
          }
        }
        const due = base ? (()=>{ const d = new Date(base); d.setDate(d.getDate() + i*step); return d.toISOString().slice(0,16); })() : '';
        const est = computeEstimate(course, activity, pages);
        out.push({ course, activity, title, pages, due, estimate: est.minutes, estimateOrigin: est.origin });
      });
    } else {
      grid.forEach((g, i) => {
        let title = g.text.trim(); let pages = 0;
        if (!title) return;
        if (activity === 'reading') {
          const r = parseRanges(title);
          if (r.valid) { pages = r.pages; title = r.normLabel ? `Read pp. ${r.normLabel}` : 'Read'; }
          else return;
        }
        const due = g.due ? g.due : (base ? (()=>{ const d = new Date(base); d.setDate(d.getDate() + i*step); return d.toISOString().slice(0,16); })() : '');
        const est = computeEstimate(course, activity, pages);
        out.push({ course, activity, title, pages, due, estimate: est.minutes, estimateOrigin: est.origin });
      });
    }
    return out;
  }, [mode, paste, grid, course, activity, baseDue, stepDays]);

  const totals = useMemo(() => {
    const totalPages = preview.reduce((s, r) => s + (r.pages||0), 0);
    const totalMinutes = preview.reduce((s, r) => s + (r.estimate||0), 0);
    const h = Math.floor(totalMinutes/60); const m = totalMinutes%60;
    return { totalPages, totalMinutes, label: `${h>0?`${h}h `:''}${m}m` };
  }, [preview]);

  async function addAll() {
    if (!preview.length) return;
    setSaving(true);
    const created: string[] = [];
    try {
      for (const r of preview) {
        const payload: NewTaskInput = {
          title: r.title,
          course: r.course || null,
          dueDate: r.due ? new Date(r.due).toISOString() : new Date().toISOString(),
          status: 'todo',
          estimatedMinutes: r.estimate || null,
          estimateOrigin: r.estimateOrigin,
          pagesRead: r.activity==='reading' ? (r.pages||null) : null,
          activity: r.activity || null,
        } as any;
        const resp = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!resp.ok) continue;
        const j = await resp.json().catch(()=>null);
        const id = j?.task?.id; if (id) created.push(id);
      }
      const token = crypto.randomUUID();
      try { window.localStorage.setItem('lastMultiAddBatchToken', token); window.localStorage.setItem(`multiBatch:${token}`, JSON.stringify(created)); } catch {}
      onCreated?.();
      setPaste(''); setGrid(g=>g.map(x=>({ text:'', due:'' })));
    } finally { setSaving(false); }
  }

  async function undo() {
    try {
      const token = window.localStorage.getItem('lastMultiAddBatchToken') || '';
      if (!token) return;
      const raw = window.localStorage.getItem(`multiBatch:${token}`) || '[]';
      const ids: string[] = JSON.parse(raw);
      for (const id of ids) {
        await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      }
      window.localStorage.removeItem(`multiBatch:${token}`);
      onCreated?.();
    } catch {}
  }

  return (
    <div className="mb-4 border border-[#1b2344] rounded p-3 bg-[#0b1020] space-y-3">
      <div className="flex items-center gap-2">
        <button className={`px-2 py-1 rounded border border-[#1b2344] text-xs ${mode==='paste'?'bg-[#141a33]':''}`} onClick={()=>setMode('paste')}>Paste lines</button>
        <button className={`px-2 py-1 rounded border border-[#1b2344] text-xs ${mode==='grid'?'bg-[#141a33]':''}`} onClick={()=>setMode('grid')}>Grid mode</button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={addAll} disabled={saving || preview.length===0} className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs disabled:opacity-50">Add all</button>
          <button onClick={undo} className="px-3 py-1 rounded border border-[#1b2344] text-xs">Undo last</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Course</div>
          <select value={course} onChange={e=>setCourse(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 min-w-[200px]">
            <option value="">Select…</option>
            {courses.map(c => (<option key={c.id} value={c.title || c.code || ''}>{c.title || c.code}</option>))}
          </select>
        </div>
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Activity</div>
          <select value={activity} onChange={e=>setActivity(e.target.value as any)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
            <option value="reading">Reading</option>
            <option value="review">Review</option>
            <option value="outline">Outline</option>
            <option value="practice">Practice</option>
            <option value="clinic">Clinic/Internship</option>
            <option value="admin">Admin</option>
            <option value="assignment">Assignment</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Base Due</div>
          <input type="datetime-local" value={baseDue} onChange={e=>setBaseDue(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Step (days)</div>
          <input type="number" min={0} value={stepDays} onChange={e=>setStepDays(e.target.value)} className="w-24 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div className="text-xs text-slate-300/80">Preview totals: Total pages: <span className="text-slate-100 font-medium">{totals.totalPages}</span> | Total estimated: <span className="text-slate-100 font-medium">{totals.label}</span></div>
      </div>

      {mode === 'paste' ? (
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Paste lines ({activity==='reading'?'ranges like 111-123':''})</div>
          <textarea value={paste} onChange={e=>setPaste(e.target.value)} rows={6} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-300/70">Rows</div>
            <input type="number" min={2} max={10} value={rows} onChange={e=>setRows(Math.max(2, Math.min(10, parseInt(e.target.value||'0',10)||0)))} className="w-24 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          </div>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
            {grid.map((g, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <div className="text-xs text-slate-300/70 mb-1">{activity==='reading'?'Range or Title':'Title'}</div>
                  <input value={g.text} onChange={e=>setGrid(arr=>{ const next=[...arr]; next[i]={...next[i], text:e.target.value}; return next; })} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
                </div>
                <div>
                  <div className="text-xs text-slate-300/70 mb-1">Due</div>
                  <input type="datetime-local" value={g.due} onChange={e=>setGrid(arr=>{ const next=[...arr]; next[i]={...next[i], due:e.target.value}; return next; })} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-300/60">
            <tr>
              <th className="py-1 pr-2">Course</th>
              <th className="py-1 pr-2">Activity</th>
              <th className="py-1 pr-2">Title</th>
              <th className="py-1 pr-2">Pages</th>
              <th className="py-1 pr-2">Due</th>
              <th className="py-1 pr-2">Estimate</th>
            </tr>
          </thead>
          <tbody>
            {preview.length === 0 ? (
              <tr className="border-t border-[#1b2344]"><td className="py-2" colSpan={6}>No rows to add.</td></tr>
            ) : (
              preview.map((r, i) => (
                <tr key={i} className="border-t border-[#1b2344]">
                  <td className="py-1 pr-2">{r.course || '—'}</td>
                  <td className="py-1 pr-2">{r.activity}</td>
                  <td className="py-1 pr-2">{r.title}</td>
                  <td className="py-1 pr-2">{r.pages || '-'}</td>
                  <td className="py-1 pr-2">{r.due ? new Date(r.due).toLocaleString() : '—'}</td>
                  <td className="py-1 pr-2">{r.estimate ? `${fmtHM(r.estimate)} (${r.estimateOrigin})` : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
