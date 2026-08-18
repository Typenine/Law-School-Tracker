"use client";

import { useEffect, useMemo, useState } from "react";
import type { NewTaskInput } from "@/lib/types";
import type { AcademicCourse } from '@/lib/academic';
import SemesterCoursePicker from '@/components/SemesterCoursePicker';
import { notifyTasksChanged } from '@/lib/taskBus';
import { notifyToast } from '@/lib/toastBus';
import { apiFetch } from '@/lib/apiClient';

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
  let pages = 0;
  const labels: string[] = [];
  for (const p of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p);
    if (!m) return { pages: 0, normLabel: '', valid: false };
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    if (isNaN(a) || isNaN(b) || b < a) return { pages: 0, normLabel: '', valid: false };
    pages += b - a + 1;
    labels.push(`${a}–${b}`);
  }
  return { pages, normLabel: labels.join(', '), valid: true };
}

type Draft = {
  semesterId: string;
  courseId: string;
  course: string;
  activity: string;
  title: string;
  pages: number;
  due: string;
  estimate: number;
  estimateOrigin: 'learned'|'default';
};

export default function MultiAddDrawer({ onCreated }: Props) {
  const [mode, setMode] = useState<'paste'|'grid'>('paste');
  const [semesterId, setSemesterId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [selectedCourse, setSelectedCourse] = useState<AcademicCourse | null>(null);
  const [activity, setActivity] = useState<'reading'|'review'|'outline'|'practice'|'clinic'|'admin'|'assignment'|'other'>('reading');
  const [baseDue, setBaseDue] = useState('');
  const [stepDays, setStepDays] = useState('1');
  const [paste, setPaste] = useState('');
  const [rows, setRows] = useState(5);
  const [grid, setGrid] = useState<Array<{ text: string; due: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [lastBatchToken, setLastBatchToken] = useState('');

  const course = selectedCourse?.title || '';

  useEffect(() => {
    setGrid(Array.from({ length: rows }, () => ({ text: '', due: '' })));
  }, [rows]);

  useEffect(() => {
    try { setLastBatchToken(window.localStorage.getItem('lastMultiAddBatchToken') || ''); } catch {}
  }, []);

  function computeEstimate(courseName: string, act: string, pages: number): { minutes: number; origin: 'learned'|'default' } {
    if (act === 'reading') {
      const mpp = minutesPerPageFor(courseName);
      let learned = false;
      try {
        const raw = window.localStorage.getItem('courseMppMap');
        const obj = raw ? JSON.parse(raw) : null;
        const key = (courseName || '').trim().toLowerCase();
        learned = Boolean(obj && obj[key] && typeof obj[key].mpp === 'number');
      } catch {}
      return { minutes: pages > 0 ? round5(pages * mpp + 10) : 0, origin: learned ? 'learned' : 'default' };
    }
    const defaults: Record<string, number> = {
      review: 30, outline: 45, practice: 60, clinic: 60,
      admin: 15, assignment: 60, other: 30,
    };
    return { minutes: round5(defaults[act] ?? 30), origin: 'default' };
  }

  const preview: Draft[] = useMemo(() => {
    const out: Draft[] = [];
    const step = Math.max(0, parseInt(stepDays || '0', 10) || 0);
    const base = baseDue ? new Date(baseDue) : null;
    const makeDue = (index: number, explicit?: string) => {
      if (explicit) return explicit;
      if (!base) return '';
      const d = new Date(base);
      d.setDate(d.getDate() + index * step);
      return d.toISOString().slice(0, 16);
    };
    const add = (text: string, index: number, explicitDue?: string) => {
      let taskTitle = text.trim();
      if (!taskTitle) return;
      let pages = 0;
      if (activity === 'reading') {
        const parsed = parseRanges(taskTitle);
        if (!parsed.valid) return;
        pages = parsed.pages;
        taskTitle = parsed.normLabel ? `Read pp. ${parsed.normLabel}` : 'Read';
      }
      const estimate = computeEstimate(course, activity, pages);
      out.push({
        semesterId,
        courseId,
        course,
        activity,
        title: taskTitle,
        pages,
        due: makeDue(index, explicitDue),
        estimate: estimate.minutes,
        estimateOrigin: estimate.origin,
      });
    };

    if (mode === 'paste') {
      paste.split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach((line, index) => add(line, index));
    } else {
      grid.forEach((row, index) => add(row.text, index, row.due));
    }
    return out;
  }, [mode, paste, grid, semesterId, courseId, course, activity, baseDue, stepDays]);

  const totals = useMemo(() => {
    const totalPages = preview.reduce((sum, row) => sum + (row.pages || 0), 0);
    const totalMinutes = preview.reduce((sum, row) => sum + (row.estimate || 0), 0);
    return { totalPages, totalMinutes, label: fmtHM(totalMinutes) };
  }, [preview]);

  async function addAll() {
    if (!preview.length) return;
    setSaving(true);
    try {
      const payloads: NewTaskInput[] = preview.map(row => ({
        title: row.title,
        courseId: row.courseId || null,
        course: row.course || null,
        term: row.semesterId || null,
        dueDate: row.due ? new Date(row.due).toISOString() : new Date().toISOString(),
        status: 'todo',
        estimatedMinutes: row.estimate || null,
        estimateOrigin: row.estimateOrigin,
        pagesRead: row.activity === 'reading' ? (row.pages || null) : null,
        activity: row.activity || null,
        originalPageRanges: row.activity === 'reading' ? parseRanges(row.title.replace(/^Read pp\.\s*/i, '')).normLabel || null : null,
        remainingPageRanges: row.activity === 'reading' ? parseRanges(row.title.replace(/^Read pp\.\s*/i, '')).normLabel || null : null,
      }));
      const response = await apiFetch<{ tasks: Array<{ id: string }> }>('/api/tasks/bulk', {
        method: 'POST',
        body: { tasks: payloads },
      });
      const ids = Array.isArray(response?.tasks) ? response.tasks.map(task => task.id).filter(Boolean) : [];
      const token = crypto.randomUUID();
      try {
        window.localStorage.setItem('lastMultiAddBatchToken', token);
        window.localStorage.setItem(`multiBatch:${token}`, JSON.stringify(ids));
      } catch {}
      setLastBatchToken(token);
      notifyTasksChanged();
      notifyToast({ kind: 'success', message: `Added ${ids.length || preview.length} tasks.` });
      onCreated?.();
      setPaste('');
      setGrid(rows => rows.map(() => ({ text: '', due: '' })));
    } catch (error: any) {
      notifyToast({ kind: 'error', message: error?.message || 'Unable to add tasks.' });
    } finally {
      setSaving(false);
    }
  }

  async function undo() {
    try {
      const token = lastBatchToken || window.localStorage.getItem('lastMultiAddBatchToken') || '';
      if (!token) return;
      const raw = window.localStorage.getItem(`multiBatch:${token}`) || '[]';
      const ids: string[] = JSON.parse(raw);
      for (const id of ids) await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
      window.localStorage.removeItem(`multiBatch:${token}`);
      window.localStorage.removeItem('lastMultiAddBatchToken');
      setLastBatchToken('');
      notifyTasksChanged();
      notifyToast({ kind: 'success', message: 'Last batch moved to Trash.' });
      onCreated?.();
    } catch (error: any) {
      notifyToast({ kind: 'error', message: error?.message || 'Unable to undo the last batch.' });
    }
  }

  return (
    <div className="mb-4 border border-[#1b2344] rounded p-3 bg-[#0b1020] space-y-3">
      <div className="flex items-center gap-2">
        <button className={`px-2 py-1 rounded border border-[#1b2344] text-xs ${mode === 'paste' ? 'bg-[#141a33]' : ''}`} onClick={() => setMode('paste')}>Paste lines</button>
        <button className={`px-2 py-1 rounded border border-[#1b2344] text-xs ${mode === 'grid' ? 'bg-[#141a33]' : ''}`} onClick={() => setMode('grid')}>Grid mode</button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => void addAll()} disabled={saving || preview.length === 0} className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs disabled:opacity-50">Add all</button>
          <button onClick={() => void undo()} disabled={!lastBatchToken} className="px-3 py-1 rounded border border-[#1b2344] text-xs disabled:opacity-40">Undo last</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
        <div className="md:col-span-2">
          <SemesterCoursePicker
            semesterId={semesterId}
            courseId={courseId}
            onSemesterChange={setSemesterId}
            onCourseChange={(id, selected) => { setCourseId(id); setSelectedCourse(selected); }}
            storageKeyPrefix="lastMultiAddCourse"
            compact
          />
        </div>
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Activity</div>
          <select value={activity} onChange={event => setActivity(event.target.value as any)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
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
          <input type="datetime-local" value={baseDue} onChange={event => setBaseDue(event.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Step (days)</div>
          <input type="number" min={0} value={stepDays} onChange={event => setStepDays(event.target.value)} className="w-24 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div className="text-xs text-slate-300/80">
          Preview: <span className="text-slate-100 font-medium">{totals.totalPages} pages</span> · <span className="text-slate-100 font-medium">{totals.label}</span>
        </div>
      </div>

      {mode === 'paste' ? (
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Paste lines {activity === 'reading' ? '(ranges like 111-123)' : ''}</div>
          <textarea value={paste} onChange={event => setPaste(event.target.value)} rows={6} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-300/70">Rows</div>
            <input type="number" min={2} max={10} value={rows} onChange={event => setRows(Math.max(2, Math.min(10, parseInt(event.target.value || '0', 10) || 2)))} className="w-24 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          </div>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
            {grid.map((row, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="flex-1">
                  <div className="text-xs text-slate-300/70 mb-1">{activity === 'reading' ? 'Range' : 'Title'}</div>
                  <input value={row.text} onChange={event => setGrid(items => items.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
                </div>
                <div>
                  <div className="text-xs text-slate-300/70 mb-1">Due</div>
                  <input type="datetime-local" value={row.due} onChange={event => setGrid(items => items.map((item, i) => i === index ? { ...item, due: event.target.value } : item))} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
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
            {preview.map((row, index) => (
              <tr key={`${row.title}-${index}`} className="border-t border-white/5">
                <td className="py-1 pr-2">{row.course || '—'}</td>
                <td className="py-1 pr-2">{row.activity}</td>
                <td className="py-1 pr-2">{row.title}</td>
                <td className="py-1 pr-2">{row.pages || '—'}</td>
                <td className="py-1 pr-2">{row.due || '—'}</td>
                <td className="py-1 pr-2">{fmtHM(row.estimate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
