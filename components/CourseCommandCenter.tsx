'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';

type Course = { id: string; title: string; code?: string | null; meetingDays?: number[] | null; meetingStart?: string | null; meetingEnd?: string | null };
type Task = { id: string; title: string; course?: string | null; courseId?: string | null; dueDate: string; workflowState?: string; blocked?: boolean; atRisk?: boolean; percentComplete?: number; activity?: string | null };
type Note = { id: string; title: string; course?: string | null; section?: string | null; sourceType?: string | null; classDate?: string | null; updatedAt?: string };
type Workspace = { tasks: Task[] };

type WeekCoverage = { week: number; classNotes: number; readingNotes: number; caseBriefs: number };

function weekNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/week\s*(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|\d+)/i);
  if (!match) return null;
  const token = match[0].replace(/week\s*/i, '').toLowerCase();
  const words: Record<string, number> = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16 };
  return words[token] || Number(token) || null;
}

export default function CourseCommandCenter({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const courses = await apiFetch<{ courses: Course[] }>('/api/courses');
        const found = (courses.courses || []).find(item => String(item.id) === String(courseId)) || null;
        if (!found) return;
        const [workspace, noteData] = await Promise.all([
          apiFetch<Workspace>('/api/tasks/workspace?allTerms=true'),
          apiFetch<{ notes: Note[] }>(`/api/notes?course=${encodeURIComponent(found.title)}&limit=250`),
        ]);
        if (cancelled) return;
        setCourse(found);
        setTasks((workspace.tasks || []).filter(task => String(task.courseId || '') === String(found.id) || (task.course || '').toLowerCase() === found.title.toLowerCase()));
        setNotes(noteData.notes || []);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [courseId]);

  const stats = useMemo(() => ({
    open: tasks.filter(task => !['done','canceled'].includes(task.workflowState || '')).length,
    atRisk: tasks.filter(task => task.atRisk && !['done','canceled'].includes(task.workflowState || '')).length,
    blocked: tasks.filter(task => task.blocked && !['done','canceled'].includes(task.workflowState || '')).length,
    readings: tasks.filter(task => task.activity === 'reading' && !['done','canceled'].includes(task.workflowState || '')).length,
  }), [tasks]);

  const coverage = useMemo<WeekCoverage[]>(() => {
    const map = new Map<number, WeekCoverage>();
    for (const note of notes) {
      const week = weekNumber(`${note.section || ''} ${note.title || ''}`);
      if (!week) continue;
      const row = map.get(week) || { week, classNotes: 0, readingNotes: 0, caseBriefs: 0 };
      if (note.sourceType === 'class-notes') row.classNotes += 1;
      else if (note.sourceType === 'reading-notes') row.readingNotes += 1;
      else if (note.sourceType === 'case-brief') row.caseBriefs += 1;
      map.set(week, row);
    }
    return Array.from(map.values()).sort((a,b) => a.week - b.week);
  }, [notes]);

  const nextTask = useMemo(() => tasks.filter(task => !['done','canceled'].includes(task.workflowState || '')).sort((a,b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0] || null, [tasks]);

  if (loading) return <section className="card p-4 mb-5 text-sm text-slate-400">Loading course command center…</section>;
  if (!course) return null;

  return (
    <section className="card p-4 mb-5 space-y-4" aria-label={`${course.title} command center`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Course command center</div>
          <div className="mt-1 text-lg font-medium">{course.title}</div>
          {nextTask ? <div className="mt-1 text-xs text-slate-400">Next: <Link href={`/tasks?taskId=${encodeURIComponent(nextTask.id)}`}>{nextTask.title}</Link> · {new Date(nextTask.dueDate).toLocaleDateString()}</div> : <div className="mt-1 text-xs text-slate-400">No open assignments.</div>}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={`/tasks?course=${encodeURIComponent(course.title)}`} className="px-2.5 py-1.5 rounded border border-white/10">Tasks</Link>
          <Link href={`/reading?course=${encodeURIComponent(course.title)}`} className="px-2.5 py-1.5 rounded border border-white/10">Reading</Link>
          <Link href={`/notes?course=${encodeURIComponent(course.title)}`} className="px-2.5 py-1.5 rounded border border-white/10">Notes</Link>
          <Link href={`/calendar?course=${encodeURIComponent(course.title)}`} className="px-2.5 py-1.5 rounded border border-white/10">Calendar</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Open" value={stats.open} />
        <Stat label="At risk" value={stats.atRisk} warn={stats.atRisk > 0} />
        <Stat label="Blocked" value={stats.blocked} warn={stats.blocked > 0} />
        <Stat label="Open readings" value={stats.readings} />
      </div>

      <div>
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">Weekly material coverage</h3><span className="text-[11px] text-slate-500">Class notes · Reading notes · Case briefs</span></div>
        {coverage.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {coverage.map(row => <div key={row.week} className="rounded border border-white/10 p-3">
            <div className="text-xs font-medium">Week {row.week}</div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
              <Coverage label="Class" value={row.classNotes} />
              <Coverage label="Reading" value={row.readingNotes} />
              <Coverage label="Briefs" value={row.caseBriefs} />
            </div>
          </div>)}
        </div> : <div className="mt-2 text-xs text-slate-400">Coverage will populate as weekly class notes, reading notes, and case briefs are filed.</div>}
      </div>
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return <div className={`rounded border p-3 ${warn ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/10'}`}><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className={`mt-1 text-lg ${warn ? 'text-amber-200' : ''}`}>{value}</div></div>;
}
function Coverage({ label, value }: { label: string; value: number }) {
  return <div className="rounded bg-white/5 p-1.5"><div className={value ? 'text-emerald-300' : 'text-slate-600'}>{value ? '✓' : '—'}</div><div className="text-slate-500 mt-0.5">{label}{value > 1 ? ` ${value}` : ''}</div></div>;
}
