"use client";
import { useEffect, useMemo, useState } from 'react';
import type { Course, Semester } from '@/lib/types';
import type { WizardPreview, WizardCourse } from '@/lib/wizard_types';

const SEMESTERS: Semester[] = ['Spring', 'Summer', 'Fall'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ACTIVITY_DEFAULT_MINUTES: Record<string, number> = {
  review: 30, outline: 45, practice: 60, clinic: 60, admin: 15, assignment: 60, other: 30,
};
const DEFAULT_MPP = 3.0;

function round5(n: number) { return Math.round(n / 5) * 5; }

/** Best-effort page count from a raw citation like "pp. 45–67" or "ch. 3". Chapter/section refs have no countable pages, so this returns null rather than guess. */
function parsePageCount(raw: string | null): number | null {
  if (!raw) return null;
  const m = /(\d+)\s*[-–—]\s*(\d+)/.exec(raw);
  if (!m) return null;
  const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
  if (isNaN(a) || isNaN(b) || b < a) return null;
  return b - a + 1;
}

function wizardTaskActivity(type: string): string {
  switch (type) {
    case 'reading': return 'reading';
    case 'brief': case 'memo': case 'quiz': case 'exam': return 'assignment';
    case 'admin': return 'admin';
    default: return 'other';
  }
}

type Draft = {
  id: string;
  date: string; // YYYY-MM-DD
  dueLocal: string; // "YYYY-MM-DDTHH:mm", browser-local wall clock — never round-tripped through toISOString before submit
  title: string;
  activity: string;
  pagesRead: number | null;
  estimatedMinutes: number | null;
  confidence: number;
  fromCanceledSession: boolean;
};

function buildDrafts(mapped: WizardPreview, meetingTime: string): Draft[] {
  const time = /^\d{2}:\d{2}$/.test(meetingTime) ? meetingTime : '08:00';
  const drafts: Draft[] = [];
  for (const session of mapped.sessions) {
    session.readings.forEach((r, i) => {
      // short_title and pages are frequently the exact same extracted
      // substring (e.g. both "pp. 1-15") — only append pages when it adds
      // information short_title doesn't already contain.
      const title_ = (r.short_title || '').trim();
      const pages_ = (r.pages || '').trim();
      const label = pages_ && !title_.toLowerCase().includes(pages_.toLowerCase())
        ? [title_, pages_].filter(Boolean).join(' ').trim()
        : title_;
      const title = label ? (label.toLowerCase().startsWith('read') ? label : `Read ${label}`) : 'Read';
      const pages = parsePageCount(r.pages);
      const minutes = pages ? round5(pages * DEFAULT_MPP + 10) : round5(20);
      drafts.push({
        id: `${session.date}:reading:${i}`,
        date: session.date,
        dueLocal: `${session.date}T${time}`,
        title: title.slice(0, 160),
        activity: 'reading',
        pagesRead: pages,
        estimatedMinutes: minutes,
        confidence: r.confidence ?? 0.8,
        fromCanceledSession: session.canceled,
      });
    });
    session.assignments_due.forEach((t, i) => {
      const activity = wizardTaskActivity(t.type);
      drafts.push({
        id: `${session.date}:task:${i}`,
        date: session.date,
        dueLocal: t.due_datetime.slice(0, 16),
        title: t.title,
        activity,
        pagesRead: null,
        estimatedMinutes: t.estimated_minutes ?? round5(ACTIVITY_DEFAULT_MINUTES[activity] ?? 30),
        confidence: t.confidence ?? 0.75,
        fromCanceledSession: session.canceled,
      });
    });
  }
  return drafts.sort((a, b) => a.dueLocal.localeCompare(b.dueLocal));
}

export default function WizardCreateStep({
  mapped,
  previewCourse,
  courseHint,
  initialSemester,
  initialYear,
}: {
  mapped: WizardPreview;
  previewCourse: WizardCourse | null;
  courseHint: string;
  initialSemester?: string;
  initialYear?: string;
}) {
  const [existingCourses, setExistingCourses] = useState<Course[]>([]);
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new');
  const [existingCourseId, setExistingCourseId] = useState('');

  const [title, setTitle] = useState(previewCourse?.title || courseHint || '');
  const [code, setCode] = useState(previewCourse?.code || '');
  const [instructor, setInstructor] = useState(previewCourse?.professor || '');
  const [semester, setSemester] = useState<Semester | ''>((initialSemester as Semester) || '');
  const [year, setYear] = useState<number>(initialYear ? parseInt(initialYear, 10) : new Date().getFullYear());
  const [meetingTime, setMeetingTime] = useState(previewCourse?.meeting_time || '08:00');

  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<{ courseTitle: string; created: number; total: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/courses', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        setExistingCourses(Array.isArray(data?.courses) ? data.courses : []);
      } catch {}
    })();
  }, []);

  // Sessions explicitly marked "no class / cancelled" default to excluded —
  // everything else defaults to included.
  const drafts = useMemo(() => buildDrafts(mapped, meetingTime), [mapped, meetingTime]);
  useEffect(() => {
    setExcludedIds(prev => {
      const next = new Set(prev);
      for (const d of drafts) if (d.fromCanceledSession) next.add(d.id);
      return next;
    });
    // Only seed defaults once per drafts identity change, not on every excludedIds change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts]);

  const byDate = useMemo(() => {
    const map = new Map<string, Draft[]>();
    for (const d of drafts) {
      const arr = map.get(d.date) || [];
      arr.push(d);
      map.set(d.date, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [drafts]);

  const included = drafts.filter(d => !excludedIds.has(d.id));
  const totalMinutes = included.reduce((s, d) => s + (d.estimatedMinutes || 0), 0);

  function toggle(id: string) {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleDate(date: string, on: boolean) {
    setExcludedIds(prev => {
      const next = new Set(prev);
      for (const d of (byDate.find(([k]) => k === date)?.[1] || [])) {
        if (on) next.delete(d.id); else next.add(d.id);
      }
      return next;
    });
  }
  function selectAll(on: boolean) {
    setExcludedIds(on ? new Set() : new Set(drafts.map(d => d.id)));
  }

  const canCreate = targetMode === 'existing'
    ? !!existingCourseId
    : title.trim().length > 0;

  async function handleCreate() {
    setSaving(true);
    setSaveError(null);
    try {
      let courseTitleOut = title.trim();
      let term: string | null = null;

      if (targetMode === 'existing') {
        const existing = existingCourses.find(c => c.id === existingCourseId);
        if (!existing) throw new Error('Pick a course to add these tasks to.');
        courseTitleOut = existing.title;
        term = existing.semester && existing.year ? `${String(existing.semester).toLowerCase()}-${existing.year}` : null;
      } else {
        const res = await fetch('/api/courses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: courseTitleOut,
            code: code.trim() || null,
            instructor: instructor.trim() || null,
            meetingDays: previewCourse?.meeting_days || null,
            meetingStart: /^\d{2}:\d{2}$/.test(meetingTime) ? meetingTime : null,
            meetingEnd: null,
            semester: semester || null,
            year: year || null,
          }),
        });
        if (!res.ok) throw new Error(await res.text() || 'Could not create the course.');
        const data = await res.json();
        courseTitleOut = data.course?.title || courseTitleOut;
        term = semester && year ? `${semester.toLowerCase()}-${year}` : null;
      }

      let created = 0;
      for (const d of included) {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: d.title,
            course: courseTitleOut,
            dueDate: new Date(d.dueLocal).toISOString(),
            status: 'todo',
            estimatedMinutes: d.estimatedMinutes,
            estimateOrigin: 'default',
            pagesRead: d.pagesRead,
            activity: d.activity,
            term,
            tags: ['syllabus-import'],
          }),
        });
        if (res.ok) created += 1;
      }
      setResult({ courseTitle: courseTitleOut, created, total: included.length });
    } catch (e: any) {
      setSaveError(e?.message || 'Something went wrong creating the course/tasks.');
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <div className="card p-4 space-y-3">
        <h2 className="text-lg font-medium">Done</h2>
        <p className="text-sm text-slate-300/80">
          Created <b>{result.courseTitle}</b> with {result.created} of {result.total} task{result.total === 1 ? '' : 's'}
          {result.created < result.total ? ' (some rows failed — check Tasks and add those manually)' : ''}.
        </p>
        <div className="flex gap-2">
          <a href="/courses" className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm">View Courses</a>
          <a href="/tasks" className="px-3 py-2 rounded border border-[#1b2344] text-sm">View Tasks</a>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-4">
      <h2 className="text-lg font-medium">Review &amp; create</h2>

      <div className="flex items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="radio" checked={targetMode === 'new'} onChange={() => setTargetMode('new')} /> New course
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" checked={targetMode === 'existing'} onChange={() => setTargetMode('existing')} /> Add to an existing course
        </label>
      </div>

      {targetMode === 'existing' ? (
        <select value={existingCourseId} onChange={e => setExistingCourseId(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 min-w-[260px]">
          <option value="">Select a course…</option>
          {existingCourses.map(c => (<option key={c.id} value={c.id}>{c.title}{c.semester && c.year ? ` (${c.semester} ${c.year})` : ''}</option>))}
        </select>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">Course title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Constitutional Law" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">Course code</label>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g., LAW 101" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">Instructor</label>
            <input value={instructor} onChange={e => setInstructor(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-slate-300/70 mb-1">Semester</label>
              <select value={semester} onChange={e => setSemester(e.target.value as Semester)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
                <option value="">Select…</option>
                {SEMESTERS.map(s => (<option key={s} value={s}>{s}</option>))}
              </select>
            </div>
            <div className="w-28">
              <label className="block text-xs text-slate-300/70 mb-1">Year</label>
              <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value, 10) || year)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            </div>
          </div>
          {previewCourse?.meeting_days?.length ? (
            <div className="md:col-span-2 text-xs text-slate-300/70">
              Detected meeting days: {previewCourse.meeting_days.map(d => DAYS[d]).join(', ')}
            </div>
          ) : null}
          <div>
            <label className="block text-xs text-slate-300/70 mb-1">Reading due time</label>
            <input
              type="time"
              value={/^\d{2}:\d{2}$/.test(meetingTime) ? meetingTime : '08:00'}
              onChange={e => setMeetingTime(e.target.value)}
              className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2"
            />
            <div className="text-xs text-slate-300/60 mt-1">Applied to every generated reading below — usually your class start time.</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[#1b2344] pt-3">
        <div className="text-sm text-slate-300/80">
          {included.length} of {drafts.length} item{drafts.length === 1 ? '' : 's'} selected · ≈{Math.round(totalMinutes / 60 * 10) / 10}h total
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={() => selectAll(true)} className="px-2 py-1 rounded border border-[#1b2344]">Select all</button>
          <button onClick={() => selectAll(false)} className="px-2 py-1 rounded border border-[#1b2344]">Select none</button>
        </div>
      </div>

      <div className="max-h-[420px] overflow-y-auto space-y-3">
        {byDate.length === 0 && (
          <div className="text-sm text-slate-300/70">No readings or assignments were detected. You can still create the course and add tasks manually.</div>
        )}
        {byDate.map(([date, items]) => {
          const allOn = items.every(d => !excludedIds.has(d.id));
          const someOn = items.some(d => !excludedIds.has(d.id));
          return (
            <div key={date} className="border border-[#1b2344] rounded p-2">
              <label className="flex items-center gap-2 text-xs text-slate-300/80 mb-1">
                <input type="checkbox" checked={allOn} ref={el => { if (el) el.indeterminate = !allOn && someOn; }} onChange={e => toggleDate(date, e.target.checked)} />
                <span className="font-medium text-slate-200">{new Date(`${date}T00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              </label>
              <div className="space-y-1">
                {items.map(d => (
                  <label key={d.id} className={`flex items-center gap-2 text-sm px-2 py-1 rounded ${excludedIds.has(d.id) ? 'opacity-50' : ''} ${d.confidence < 0.75 ? 'bg-amber-500/5' : ''}`}>
                    <input type="checkbox" checked={!excludedIds.has(d.id)} onChange={() => toggle(d.id)} />
                    <span className="flex-1">{d.title}</span>
                    <span className="text-xs text-slate-400">{d.activity}</span>
                    {d.pagesRead ? <span className="text-xs text-slate-400">{d.pagesRead}p</span> : null}
                    {d.confidence < 0.75 && <span className="text-xs text-amber-400" title="Low-confidence parse — double-check this row">low-confidence</span>}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {saveError && <div className="text-sm text-rose-400">{saveError}</div>}

      <button
        onClick={handleCreate}
        disabled={!canCreate || saving}
        className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
      >
        {saving ? 'Creating…' : `Create course & ${included.length} task${included.length === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}
