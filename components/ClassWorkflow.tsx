"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Course, SemesterInfo, Task } from '@/lib/types';
import { apiFetch } from '@/lib/apiClient';
import {
  COURSE_WORKSPACES_KEY,
  CourseWorkspaceMap,
  courseTermMatches,
  nextClassOccurrence,
  nextOpenTask,
  safeUrl,
  ymd,
} from '@/lib/courseWorkspace';

function formatClassTime(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDue(value: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value));
}

export default function ClassWorkflow({
  courses,
  tasks,
  currentTerm,
  activeSemester,
}: {
  courses: Course[];
  tasks: Task[];
  currentTerm?: string | null;
  activeSemester?: SemesterInfo | null;
}) {
  const [workspaceMap, setWorkspaceMap] = useState<CourseWorkspaceMap>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${COURSE_WORKSPACES_KEY}`);
        setWorkspaceMap((data.settings?.[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap);
      } catch {}
    })();
  }, []);

  const upcoming = useMemo(() => {
    return courses
      .filter((course) => courseTermMatches(course, activeSemester?.season, activeSemester?.year))
      .map((course) => ({ course, occurrence: nextClassOccurrence(course) }))
      .filter((item): item is { course: Course; occurrence: NonNullable<ReturnType<typeof nextClassOccurrence>> } => Boolean(item.occurrence))
      .sort((a, b) => a.occurrence.start.getTime() - b.occurrence.start.getTime())
      .slice(0, 3);
  }, [courses, activeSemester]);

  async function markPrepared(courseId: string, date: string) {
    setSavingId(courseId);
    try {
      const workspace = workspaceMap[courseId] || {};
      const dates = Array.from(new Set([...(workspace.preparedDates || []), date]));
      const nextMap = { ...workspaceMap, [courseId]: { ...workspace, preparedDates: dates } };
      await apiFetch('/api/settings', { method: 'PATCH', body: { [COURSE_WORKSPACES_KEY]: nextMap } });
      setWorkspaceMap(nextMap);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-semibold text-slate-100">Class workflow</h2>
          <p className="text-sm text-slate-400">The next classes, their preparation, and the documents needed to work.</p>
        </div>
        <Link href="/wizard" className="text-sm text-emerald-300 hover:text-emerald-200">Import a syllabus</Link>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {upcoming.map(({ course, occurrence }) => {
          const workspace = workspaceMap[course.id] || {};
          const prepTask = nextOpenTask(tasks, course.title, currentTerm);
          const classDate = ymd(occurrence.start);
          const prepared = (workspace.preparedDates || []).includes(classDate);
          const notesUrl = safeUrl(workspace.notesUrl);
          const syllabusUrl = safeUrl(workspace.syllabusUrl);
          return (
            <article key={`${course.id}:${occurrence.start.toISOString()}`} className="rounded-xl border border-slate-700 bg-slate-950/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{course.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatClassTime(occurrence.start)}</p>
                  {occurrence.location ? <p className="mt-1 text-xs text-slate-500">{occurrence.location}</p> : null}
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${prepared ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{prepared ? 'Prepared' : 'Needs prep'}</span>
              </div>

              <div className="mt-3 min-h-16 rounded-lg bg-slate-900/70 p-3">
                {prepTask ? <><p className="text-sm text-slate-200">{prepTask.title}</p><p className="mt-1 text-xs text-slate-500">Due {formatDue(prepTask.dueDate)}</p></> : <p className="text-sm text-slate-500">No reading or assignment is attached to this class yet.</p>}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {notesUrl ? <a href={notesUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800">Open notes</a> : null}
                {syllabusUrl ? <a href={syllabusUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800">Open syllabus</a> : null}
                <Link href={`/courses/${course.id}`} className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800">Course workspace</Link>
              </div>

              <div className="mt-3 flex gap-2">
                <button disabled={prepared || savingId === course.id} onClick={() => markPrepared(course.id, classDate)} className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">{prepared ? 'Prepared' : 'Mark prepared'}</button>
                <Link href={`/courses/${course.id}#after-class`} className="flex-1 rounded-lg border border-slate-600 px-3 py-2 text-center text-xs text-slate-200 hover:bg-slate-800">After class</Link>
              </div>
            </article>
          );
        })}

        {!upcoming.length ? (
          <div className="xl:col-span-3 rounded-xl border border-dashed border-slate-600 p-6 text-center">
            <p className="font-medium text-slate-200">No current class schedule is available.</p>
            <p className="mt-1 text-sm text-slate-400">Add Fall 2026 courses and meeting times, then link their Drive materials.</p>
            <Link href="/courses" className="mt-3 inline-flex rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Set up courses</Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
