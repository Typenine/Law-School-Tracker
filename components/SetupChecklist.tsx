"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { COURSE_WORKSPACES_KEY, CourseWorkspaceMap, courseBlocks, safeUrl } from '@/lib/courseWorkspace';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';

export default function SetupChecklist() {
  const { activeSemester, loading: termLoading } = useSemester();
  const { courses, loading: courseLoading } = useCourses();
  const { tasks, loading: taskLoading } = useTasks();
  const [workspaces, setWorkspaces] = useState<CourseWorkspaceMap>({});

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${COURSE_WORKSPACES_KEY}`);
        setWorkspaces((data.settings?.[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap);
      } catch {}
    })();
  }, []);

  const activeCourses = useMemo(() => activeSemester ? courses.filter((course) => course.semester === activeSemester.season && course.year === activeSemester.year) : [], [courses, activeSemester]);
  if (termLoading || courseLoading || taskLoading) return null;

  const steps = [
    { label: 'Active semester selected', done: Boolean(activeSemester), href: '/semester' },
    { label: 'Current courses added', done: activeCourses.length > 0, href: '/courses' },
    { label: 'Class meeting times added', done: activeCourses.length > 0 && activeCourses.every((course) => courseBlocks(course).length > 0), href: '/courses' },
    { label: 'Notes and outlines linked', done: activeCourses.length > 0 && activeCourses.every((course) => safeUrl(workspaces[course.id]?.notesUrl) && safeUrl(workspaces[course.id]?.outlineUrl)), href: '/courses' },
    { label: 'Syllabi imported', done: activeCourses.length > 0 && activeCourses.every((course) => tasks.some((task) => task.course === course.title && (!activeSemester || task.term === activeSemester.id))), href: '/wizard' },
    { label: 'Exam dates recorded', done: activeCourses.length > 0 && activeCourses.every((course) => Boolean(workspaces[course.id]?.examDate)), href: '/exam' },
  ];
  const complete = steps.every((step) => step.done);
  if (complete) return null;
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <section className="mb-6 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-sm font-semibold text-sky-200">Finish {activeSemester?.name || 'semester'} setup</p><p className="mt-1 text-xs text-slate-400">{doneCount} of {steps.length} steps complete. This disappears when the semester is ready.</p></div>
        <Link href="/help" className="text-sm text-sky-300">Setup guide</Link>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{steps.map((step) => <Link key={step.label} href={step.href} className={`rounded-lg border px-3 py-2 text-xs ${step.done ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-950/35 text-slate-400 hover:bg-slate-800'}`}>{step.done ? '✓ ' : '○ '}{step.label}</Link>)}</div>
    </section>
  );
}
