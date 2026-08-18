"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NewTaskInput, Task } from "@/lib/types";
import type { AcademicCourse } from "@/lib/academic";
import SemesterCoursePicker from '@/components/SemesterCoursePicker';
import { notifyTasksChanged } from '@/lib/taskBus';
import { notifyScheduleChanged } from '@/lib/scheduleBus';
import { apiFetch } from '@/lib/apiClient';
import { notifyToast } from '@/lib/toastBus';

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
  let pages = 0;
  const labels: string[] = [];
  for (const p of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p);
    if (!m) return { pages: 0, normLabel: '', valid: false, tooMany: false };
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    if (isNaN(a) || isNaN(b) || b < a) return { pages: 0, normLabel: '', valid: false, tooMany: false };
    pages += b - a + 1;
    labels.push(`${a}–${b}`);
  }
  return { pages, normLabel: labels.join(', '), valid: true, tooMany: pages > 150 };
}

export default function AddTaskPanel({ onCreated }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [semesterId, setSemesterId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [selectedCourse, setSelectedCourse] = useState<AcademicCourse | null>(null);
  const [activity, setActivity] = useState('reading');
  const [range, setRange] = useState('');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const dueRef = useRef<HTMLInputElement>(null);
  const [estimateOrigin, setEstimateOrigin] = useState<'learned'|'default'|'manual'|null>(null);
  const [manualEst, setManualEst] = useState('');
  const [saving, setSaving] = useState(false);
  const [setDefaultForCourse, setSetDefaultForCourse] = useState(false);
  const [dupWarn, setDupWarn] = useState('');

  const course = selectedCourse?.title || '';

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<{ tasks: Task[] }>('/api/tasks');
        setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const def = selectedCourse?.defaultActivity;
    if (def) setActivity(def);
  }, [selectedCourse?.id, selectedCourse?.defaultActivity]);

  const parsed = useMemo(() => parseRanges(range), [range]);
  const pages = activity === 'reading' && parsed.valid ? parsed.pages : 0;

  const est = useMemo(() => {
    if (estimateOrigin === 'manual') {
      const n = parseInt(manualEst || '0', 10);
      return isNaN(n) ? 0 : Math.max(0, n);
    }
    if (activity === 'reading') {
      const minutes = pages > 0 ? pages * minutesPerPageFor(course) + 10 : 0;
      return round5(minutes);
    }
    const defaults: Record<string, number> = {
      review: 30, outline: 45, practice: 60, clinic: 60,
      admin: 15, assignment: 60, other: 30,
    };
    return round5(defaults[activity] ?? 30);
  }, [activity, course, pages, estimateOrigin, manualEst]);

  useEffect(() => {
    if (estimateOrigin === 'manual') return;
    if (activity !== 'reading') { setEstimateOrigin('default'); return; }
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('courseMppMap') : null;
      const obj = raw ? JSON.parse(raw) : null;
      const key = course.trim().toLowerCase();
      setEstimateOrigin(obj && obj[key] && typeof obj[key].mpp === 'number' ? 'learned' : 'default');
    } catch {
      setEstimateOrigin('default');
    }
  }, [activity, course, pages, estimateOrigin]);

  useEffect(() => {
    if (!course || !title || !due) { setDupWarn(''); return; }
    let dueKey = due;
    try { dueKey = new Date(due).toISOString().slice(0, 16); } catch {}
    const exists = tasks.some(task => {
      let taskDue = task.dueDate;
      try { taskDue = new Date(task.dueDate).toISOString().slice(0, 16); } catch {}
      return String(task.courseId || '') === String(courseId)
        && (task.title || '').trim().toLowerCase() === title.trim().toLowerCase()
        && taskDue === dueKey;
    });
    setDupWarn(exists ? 'A task with the same course, title, and due already exists.' : '');
  }, [course, courseId, title, due, tasks]);

  useEffect(() => {
    if (activity === 'reading' && parsed.normLabel) setTitle(`Read pp. ${parsed.normLabel}`);
  }, [activity, parsed.normLabel]);

  function quickPickTonight() {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0, 0);
    setDue(d.toISOString().slice(0, 16));
  }

  function quickPickFri5p() {
    const d = new Date();
    const delta = (5 - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + delta);
    d.setHours(17, 0, 0, 0);
    setDue(d.toISOString().slice(0, 16));
  }

  function quickPickNextClass() {
    const c = selectedCourse;
    if (!c) return;
    const blocks = Array.isArray(c.meetingBlocks) && c.meetingBlocks.length
      ? c.meetingBlocks
      : c.meetingDays?.length
        ? [{ days: c.meetingDays, start: c.meetingStart || '17:00' }]
        : [];
    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      for (const block of blocks) {
        if (!block.days.includes(d.getDay())) continue;
        const [hh, mm] = (block.start || '17:00').split(':').map(v => parseInt(v, 10));
        d.setHours(hh || 17, mm || 0, 0, 0);
        if (d > now) {
          setDue(d.toISOString().slice(0, 16));
          return;
        }
      }
    }
  }

  async function saveDefaultActivity() {
    if (!setDefaultForCourse || !courseId) return;
    try {
      await apiFetch(`/api/courses/${courseId}`, { method: 'PATCH', body: { defaultActivity: activity } });
      notifyToast({ kind: 'success', message: 'Default activity saved.' });
    } catch {}
  }

  async function addTask(plan: boolean) {
    if (!activity || !due) return;
    try {
      if (new Date(due).getTime() < Date.now() && !window.confirm('This due date/time is in the past. Add anyway?')) return;
    } catch {}

    setSaving(true);
    try {
      if (setDefaultForCourse) await saveDefaultActivity();

      const payload: NewTaskInput = {
        title: title || (activity === 'reading' ? 'Read' : 'Task'),
        courseId: courseId || null,
        course: course || null,
        term: semesterId || null,
        dueDate: new Date(due).toISOString(),
        status: 'todo',
        estimatedMinutes: est || null,
        estimateOrigin: estimateOrigin || null,
        pagesRead: activity === 'reading' ? (pages || null) : null,
        activity: activity || null,
        originalPageRanges: activity === 'reading' && parsed.valid && parsed.normLabel ? parsed.normLabel : null,
        remainingPageRanges: activity === 'reading' && parsed.valid && parsed.normLabel ? parsed.normLabel : null,
      };

      const created = await apiFetch<{ task: Task }>('/api/tasks', { method: 'POST', body: payload });
      notifyToast({ kind: 'success', message: 'Task added.' });

      if (plan && created?.task?.id) {
        try {
          const [schedule, settings] = await Promise.all([
            apiFetch<{ blocks: any[] }>('/api/schedule'),
            apiFetch<{ settings: Record<string, any> }>('/api/settings?keys=availabilityTemplateV1'),
          ]);
          const arr = Array.isArray(schedule?.blocks) ? [...schedule.blocks] : [];
          const avail = settings?.settings?.availabilityTemplateV1 || {};
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const dueDt = new Date(due); dueDt.setHours(23, 59, 59, 999);
          const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const plannedFor = (day: string) => arr.filter(block => block?.day === day).reduce((sum, block) => sum + Math.max(0, Number(block.plannedMinutes) || 0), 0);

          let placeYmd: string | null = null;
          for (let i = 0; i < 7; i++) {
            const d = new Date(today); d.setDate(today.getDate() + i);
            if (d > dueDt) break;
            const cap = Math.max(0, Number(avail[d.getDay()] || 0));
            const day = ymd(d);
            if (cap - plannedFor(day) >= (est || 0)) { placeYmd = day; break; }
          }
          placeYmd ||= ymd(new Date(due));
          arr.push({
            id: crypto.randomUUID(),
            taskId: created.task.id,
            day: placeYmd,
            plannedMinutes: est || 0,
            title: payload.title,
            course,
          });
          await apiFetch('/api/schedule', { method: 'PUT', body: { blocks: arr } });
          notifyScheduleChanged();
          notifyToast({ kind: 'success', message: 'Added and planned.' });
        } catch {}
      }

      setTitle('');
      setRange('');
      setManualEst('');
      setEstimateOrigin(null);
      setDupWarn('');
      notifyTasksChanged();
      onCreated?.();
    } catch (error: any) {
      notifyToast({ kind: 'error', message: error?.message || 'Unable to add task.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="mb-3 border border-[#1b2344] rounded p-3 bg-[#0b1020] space-y-2"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          setTitle(''); setRange(''); setDue(''); setManualEst(''); setEstimateOrigin(null);
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (event.shiftKey) void addTask(true);
          else void addTask(false);
        }
      }}
    >
      <div className="flex flex-wrap gap-2 items-end">
        <SemesterCoursePicker
          semesterId={semesterId}
          courseId={courseId}
          onSemesterChange={setSemesterId}
          onCourseChange={(id, selected) => { setCourseId(id); setSelectedCourse(selected); }}
          storageKeyPrefix="lastTaskCourse"
        />

        <div>
          <div className="text-xs text-slate-300/70 mb-1">Activity</div>
          <select value={activity} onChange={event => setActivity(event.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
            <option value="reading">Reading</option>
            <option value="review">Review</option>
            <option value="outline">Outline</option>
            <option value="practice">Practice</option>
            <option value="assignment">Assignment</option>
            <option value="clinic">Clinic/Internship</option>
            <option value="admin">Admin</option>
            <option value="other">Other</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={setDefaultForCourse} onChange={event => setSetDefaultForCourse(event.target.checked)} />
          Set as default for this course
        </label>
      </div>

      {activity === 'reading' && (
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <div className="text-xs text-slate-300/70 mb-1">Reading range</div>
            <input value={range} onChange={event => setRange(event.target.value)} placeholder="111-123, 130-142" className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 min-w-[260px]" />
          </div>
          <div className="text-xs text-slate-300/70">
            {parsed.valid
              ? <div>Pages: <span className="text-slate-100 font-medium">{pages}</span>{parsed.tooMany ? <span className="ml-2 text-amber-400">Split with Reading Split Wizard?</span> : null}</div>
              : <div className="text-rose-400">Invalid range</div>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[260px]">
          <div className="text-xs text-slate-300/70 mb-1">Title</div>
          <input value={title} onChange={event => setTitle(event.target.value)} placeholder={activity === 'reading' ? 'Read pp. 111–123' : 'Title'} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
        </div>
        <div>
          <div className="text-xs text-slate-300/70 mb-1">Due (date & time)</div>
          <input
            ref={dueRef}
            type="datetime-local"
            value={due}
            onChange={event => setDue(event.target.value)}
            onDoubleClick={() => { try { (dueRef.current as any)?.showPicker?.(); dueRef.current?.focus(); } catch {} }}
            className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2"
          />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={quickPickTonight} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Tonight 9p</button>
          <button type="button" onClick={quickPickFri5p} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Fri 5p</button>
          <button type="button" onClick={quickPickNextClass} disabled={!selectedCourse} className="px-2 py-1 rounded border border-[#1b2344] text-xs disabled:opacity-40">Next class</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="text-xs text-slate-300/70">Estimate</div>
        {estimateOrigin === 'manual'
          ? <input type="number" min={0} step={5} value={manualEst} onChange={event => setManualEst(event.target.value)} className="w-24 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
          : <div className="text-sm px-2 py-1 rounded border border-[#1b2344]">≈ {fmtHM(est || 0)} ({estimateOrigin || 'auto'})</div>}
        <button type="button" onClick={() => setEstimateOrigin(estimateOrigin === 'manual' ? null : 'manual')} className="px-2 py-1 rounded border border-[#1b2344] text-xs">{estimateOrigin === 'manual' ? 'Auto' : 'Edit'}</button>
        {dupWarn && <div className="text-xs text-amber-400">{dupWarn} <span className="text-slate-300/60">(Add anyway allowed)</span></div>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button disabled={!activity || !due || saving} onClick={() => void addTask(false)} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">Add</button>
        <button disabled={!activity || !due || saving} onClick={() => void addTask(true)} className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">Add & Plan</button>
      </div>
    </div>
  );
}
