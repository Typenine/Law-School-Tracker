"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { tasksClient } from '@/lib/tasksClient';
import { useCourses } from '@/lib/useCourses';
import { useTasks } from '@/lib/useTasks';
import { useSemester } from '@/lib/useSemester';
import type { Course } from '@/lib/types';
import {
  COURSE_WORKSPACES_KEY,
  CourseWorkspaceMap,
  courseTermMatches,
  courseTasks,
  examDaysRemaining,
  safeUrl,
  taskKind,
} from '@/lib/courseWorkspace';

export default function ExamPage() {
  const { courses } = useCourses();
  const { tasks, refresh } = useTasks();
  const { activeSemester, currentTerm } = useSemester();
  const [workspaceMap, setWorkspaceMap] = useState<CourseWorkspaceMap>({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${COURSE_WORKSPACES_KEY}`);
        setWorkspaceMap((data.settings?.[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap);
      } catch {}
    })();
  }, []);

  const activeCourses = useMemo(() => courses.filter((course) => courseTermMatches(course, activeSemester?.season, activeSemester?.year)), [courses, activeSemester]);

  const examCourses = useMemo(() => activeCourses.map((course) => {
    const workspace = workspaceMap[course.id] || {};
    const matching = courseTasks(tasks, course.title, currentTerm);
    const outline = matching.filter((task) => taskKind(task) === 'outline');
    const practice = matching.filter((task) => taskKind(task) === 'practice');
    const review = matching.filter((task) => (task.activity || '').toLowerCase() === 'review');
    return {
      course,
      workspace,
      days: examDaysRemaining(workspace.examDate),
      outlineDone: outline.filter((task) => task.status === 'done').length,
      outlineTotal: outline.length,
      practiceDone: practice.filter((task) => task.status === 'done').length,
      practiceTotal: practice.length,
      reviewDone: review.filter((task) => task.status === 'done').length,
      reviewTotal: review.length,
    };
  }).sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999)), [activeCourses, workspaceMap, tasks, currentTerm]);

  async function addTask(course: Course, kind: 'outline' | 'practice' | 'review', examDate?: string) {
    const exam = examDate ? new Date(`${examDate}T20:00:00`) : new Date(Date.now() + 14 * 86400000);
    if (examDate) exam.setDate(exam.getDate() - (kind === 'outline' ? 14 : kind === 'practice' ? 7 : 3));
    const title = kind === 'outline'
      ? `Complete ${course.title} attack outline and issue checklist`
      : kind === 'practice'
        ? `Complete timed ${course.title} practice essay`
        : `Review weak rules and case analogies for ${course.title}`;
    await tasksClient.create({
      title,
      course: course.title,
      dueDate: exam.toISOString(),
      status: 'todo',
      term: currentTerm || null,
      activity: kind,
    }, { silent: true });
    setMessage(`${course.title} exam-prep task added.`);
    await refresh();
  }

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/30 to-slate-950 p-6">
        <p className="text-sm font-medium text-amber-300">Exam mode</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-100">Turn course material into issue-spotting tools</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Track attack outlines, rule checklists, case analogies, and timed practice instead of raw study hours.</p>
      </section>

      {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}

      <div className="grid gap-5 xl:grid-cols-2">
        {examCourses.map(({ course, workspace, days, outlineDone, outlineTotal, practiceDone, practiceTotal, reviewDone, reviewTotal }) => {
          const outlineUrl = safeUrl(workspace.outlineUrl);
          const urgent = days !== null && days <= 21 && days >= 0;
          return (
            <article key={course.id} className={`rounded-xl border p-5 ${urgent ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-700 bg-slate-900/45'}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">{course.title}</h3>
                  <p className="mt-1 text-sm text-slate-400">{workspace.examFormat || 'Exam format not recorded'}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${days === null ? 'bg-slate-700 text-slate-300' : urgent ? 'bg-amber-500/15 text-amber-300' : 'bg-sky-500/15 text-sky-300'}`}>{days === null ? 'Set exam date' : days < 0 ? 'Completed' : `${days} days`}</span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-950/45 p-3"><p className="text-xl font-semibold text-slate-100">{outlineDone}/{outlineTotal}</p><p className="text-xs text-slate-500">Outline</p></div>
                <div className="rounded-lg bg-slate-950/45 p-3"><p className="text-xl font-semibold text-slate-100">{practiceDone}/{practiceTotal}</p><p className="text-xs text-slate-500">Practice</p></div>
                <div className="rounded-lg bg-slate-950/45 p-3"><p className="text-xl font-semibold text-slate-100">{reviewDone}/{reviewTotal}</p><p className="text-xs text-slate-500">Weak issues</p></div>
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(workspace.outlineProgress || 0, outlineTotal ? Math.round((outlineDone / outlineTotal) * 100) : 0)}%` }} /></div>
              <p className="mt-1 text-xs text-slate-500">Attack outline: {workspace.outlineProgress || 0}%</p>

              <div className="mt-4 flex flex-wrap gap-2">
                {outlineUrl ? <a href={outlineUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Open outline</a> : null}
                <Link href={`/courses/${course.id}`} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Course workspace</Link>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <button onClick={() => addTask(course, 'outline', workspace.examDate)} className="rounded-lg border border-slate-600 px-2 py-2 text-xs text-slate-200 hover:bg-slate-800">Attack outline</button>
                <button onClick={() => addTask(course, 'practice', workspace.examDate)} className="rounded-lg border border-slate-600 px-2 py-2 text-xs text-slate-200 hover:bg-slate-800">Timed essay</button>
                <button onClick={() => addTask(course, 'review', workspace.examDate)} className="rounded-lg border border-slate-600 px-2 py-2 text-xs text-slate-200 hover:bg-slate-800">Weak issues</button>
              </div>
            </article>
          );
        })}

        {!examCourses.length ? <div className="xl:col-span-2 rounded-xl border border-dashed border-slate-700 p-8 text-center"><p className="font-medium text-slate-200">No active courses are available.</p><Link href="/courses" className="mt-3 inline-flex text-sm text-emerald-300">Set up courses</Link></div> : null}
      </div>
    </main>
  );
}
