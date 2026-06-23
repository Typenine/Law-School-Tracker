"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Course, SemesterInfo, Task } from '@/lib/types';
import { courseTermMatches, nextClassOccurrence, ymd } from '@/lib/courseWorkspace';
import { useCourseWorkspaces } from '@/lib/useCourseWorkspaces';

function estimate(task: Task) {
  if (task.estimatedMinutes) return task.estimatedMinutes;
  return task.activity === 'reading' ? 60 : task.activity === 'practice' ? 75 : 30;
}
function minutes(value: number) {
  if (value < 60) return `${value} min`;
  return `${Math.floor(value / 60)}h${value % 60 ? ` ${value % 60}m` : ''}`;
}

export default function BeforeClassWorkflow({ courses, tasks, currentTerm, activeSemester }: { courses: Course[]; tasks: Task[]; currentTerm?: string | null; activeSemester?: SemesterInfo | null }) {
  const { workspaces, updateWorkspace } = useCourseWorkspaces();
  const [saving, setSaving] = useState('');
  const upcoming = useMemo(() => courses
    .filter(course => courseTermMatches(course, activeSemester?.season, activeSemester?.year))
    .map(course => ({ course, occurrence: nextClassOccurrence(course) }))
    .filter((item): item is { course: Course; occurrence: NonNullable<ReturnType<typeof nextClassOccurrence>> } => Boolean(item.occurrence))
    .sort((a, b) => a.occurrence.start.getTime() - b.occurrence.start.getTime())
    .slice(0, 3), [courses, activeSemester]);

  async function markPrepared(courseId: string, date: string) {
    setSaving(courseId);
    try {
      await updateWorkspace(courseId, workspace => ({ ...workspace, preparedDates: Array.from(new Set([...(workspace.preparedDates || []), date])) }));
    } finally { setSaving(''); }
  }

  return <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4">
    <div className="flex items-end justify-between gap-3"><div><h2 className="font-semibold text-slate-100">Before-class preparation</h2><p className="text-sm text-slate-400">Syllabus topic, assigned work, open questions, and one-click start.</p></div><Link href="/questions" className="text-sm text-sky-300">Question tracker</Link></div>
    <div className="mt-4 grid gap-3 xl:grid-cols-3">{upcoming.map(({ course, occurrence }) => {
      const workspace = workspaces[course.id] || {};
      const classDate = ymd(occurrence.start);
      const prepared = (workspace.preparedDates || []).includes(classDate);
      const session = workspace.syllabusAnalysis?.sessionSummary?.find(item => item.date === classDate);
      const courseTasks = tasks.filter(task => task.status !== 'done' && (!currentTerm || task.term === currentTerm) && (task.course || '').toLowerCase() === course.title.toLowerCase());
      const dated = courseTasks.filter(task => task.dueDate.slice(0, 10) === classDate);
      const prep = dated.length ? dated : courseTasks.slice(0, 2);
      const openQuestions = (workspace.questions || []).filter(question => question.status === 'open');
      const total = prep.reduce((sum, task) => sum + estimate(task), 0);
      return <article key={`${course.id}:${classDate}`} className="rounded-xl border border-slate-700 bg-slate-950/40 p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-100">{course.title}</p><p className="mt-1 text-xs text-slate-400">{occurrence.start.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p></div><span className={`rounded-full px-2 py-1 text-xs ${prepared ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{prepared ? 'Prepared' : 'Needs prep'}</span></div>
        <div className="mt-3 rounded-lg bg-slate-900/70 p-3"><p className="text-xs uppercase text-slate-500">Topic</p><p className="mt-1 text-sm text-slate-200">{session?.topic || 'No syllabus topic matched'}</p>{session ? <p className="mt-1 text-xs text-slate-500">{session.readingCount} readings · {session.assignmentCount} assignments</p> : null}</div>
        <div className="mt-3 space-y-2">{prep.map(task => <div key={task.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/60 p-2.5"><div><p className="text-xs text-slate-200">{task.title}</p><p className="text-[11px] text-slate-500">{minutes(estimate(task))}</p></div><Link href={`/work?task=${task.id}`} className="text-xs text-sky-300">Start</Link></div>)}{!prep.length ? <p className="rounded-lg bg-slate-900/60 p-3 text-sm text-slate-500">No assigned work attached.</p> : null}</div>
        <p className="mt-3 text-xs text-slate-500">{total ? `${minutes(total)} estimated` : 'No estimate'} · {openQuestions.length} open question{openQuestions.length === 1 ? '' : 's'}</p>
        <div className="mt-3 flex gap-2"><button disabled={prepared || saving === course.id} onClick={() => markPrepared(course.id, classDate)} className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">{prepared ? 'Prepared' : 'Mark prepared'}</button><Link href={`/class-capture?course=${course.id}&date=${classDate}`} className="flex-1 rounded-lg border border-slate-600 px-3 py-2 text-center text-xs text-slate-200">After class</Link></div>
      </article>;
    })}{!upcoming.length ? <div className="xl:col-span-3 rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">No upcoming classes. Add meeting times in Courses.</div> : null}</div>
  </section>;
}
