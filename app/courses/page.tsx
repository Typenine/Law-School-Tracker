"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import AddCourseWizard from '@/components/AddCourseWizard';
import EditCourseModal from '@/components/EditCourseModal';
import { apiFetch } from '@/lib/apiClient';
import {
  COURSE_WORKSPACES_KEY,
  CourseWorkspaceMap,
  courseTasks,
  examDaysRemaining,
  nextClassOccurrence,
  nextOpenTask,
  safeUrl,
} from '@/lib/courseWorkspace';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';
import type { Course } from '@/lib/types';

function formatClass(date: Date) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatDue(value: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value));
}

function CourseCard({ course, workspaceMap, tasks, currentTerm, onEdit }: {
  course: Course;
  workspaceMap: CourseWorkspaceMap;
  tasks: any[];
  currentTerm?: string | null;
  onEdit: (course: Course) => void;
}) {
  const workspace = workspaceMap[course.id] || {};
  const matching = courseTasks(tasks, course.title, currentTerm);
  const open = matching.filter((task) => task.status !== 'done');
  const overdue = open.filter((task) => new Date(task.dueDate).getTime() < Date.now());
  const nextTask = nextOpenTask(tasks, course.title, currentTerm);
  const nextClass = nextClassOccurrence(course);
  const examDays = examDaysRemaining(workspace.examDate);
  const linked = [workspace.courseFolderUrl, workspace.syllabusUrl, workspace.notesUrl, workspace.outlineUrl, workspace.assignmentsUrl].filter((value) => safeUrl(value)).length;
  const status = overdue.length ? 'Behind' : open.some((task) => new Date(task.dueDate).getTime() <= Date.now() + 3 * 86400000) ? 'Work due soon' : linked < 3 ? 'Setup incomplete' : 'On track';
  const tone = status === 'Behind' ? 'bg-rose-500/10 text-rose-300' : status === 'Work due soon' ? 'bg-amber-500/10 text-amber-300' : status === 'Setup incomplete' ? 'bg-sky-500/10 text-sky-300' : 'bg-emerald-500/10 text-emerald-300';

  return (
    <article className="rounded-xl border border-slate-700 bg-slate-900/45 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: course.color || '#64748b' }} /><h3 className="truncate text-lg font-semibold text-slate-100">{course.title}</h3></div>
          <p className="mt-1 text-sm text-slate-500">{[course.code, course.instructor].filter(Boolean).join(' · ') || 'Course details not set'}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{status}</span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-950/45 p-3"><p className="text-[11px] uppercase tracking-wide text-slate-600">Next class</p><p className="mt-1 text-sm font-medium text-slate-200">{nextClass ? formatClass(nextClass.start) : 'Schedule not set'}</p>{nextClass?.location ? <p className="mt-1 text-xs text-slate-500">{nextClass.location}</p> : null}</div>
        <div className="rounded-lg bg-slate-950/45 p-3"><p className="text-[11px] uppercase tracking-wide text-slate-600">Next task</p><p className="mt-1 line-clamp-2 text-sm font-medium text-slate-200">{nextTask?.title || 'No open work'}</p>{nextTask ? <p className="mt-1 text-xs text-slate-500">Due {formatDue(nextTask.dueDate)}</p> : null}</div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-slate-800 p-2"><p className={`text-lg font-semibold ${overdue.length ? 'text-rose-300' : 'text-slate-100'}`}>{open.length}</p><p className="text-[11px] text-slate-500">Open</p></div>
        <div className="rounded-lg border border-slate-800 p-2"><p className="text-lg font-semibold text-slate-100">{workspace.outlineProgress || 0}%</p><p className="text-[11px] text-slate-500">Outline</p></div>
        <div className="rounded-lg border border-slate-800 p-2"><p className="text-lg font-semibold text-slate-100">{examDays === null ? '—' : Math.max(0, examDays)}</p><p className="text-[11px] text-slate-500">Exam days</p></div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/courses/${course.id}`} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950">Open workspace</Link>
        <Link href={`/tasks?course=${encodeURIComponent(course.title)}`} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Tasks</Link>
        <button onClick={() => onEdit(course)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Edit course</button>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-xs"><span className={linked >= 4 ? 'text-emerald-300' : 'text-slate-500'}>{linked}/5 Drive resources linked</span>{!safeUrl(workspace.syllabusUrl) ? <Link href={`/courses/${course.id}`} className="text-sky-300">Finish setup</Link> : <Link href="/wizard" className="text-sky-300">Import syllabus</Link>}</div>
    </article>
  );
}

export default function CoursesPage() {
  const { courses, loading, error, refresh } = useCourses();
  const { tasks } = useTasks();
  const { activeSemester, currentTerm } = useSemester();
  const [workspaceMap, setWorkspaceMap] = useState<CourseWorkspaceMap>({});
  const [showAdd, setShowAdd] = useState(false);
  const [editCourse, setEditCourse] = useState<Course | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${COURSE_WORKSPACES_KEY}`);
        setWorkspaceMap((data.settings?.[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap);
      } catch {}
    })();
  }, []);

  const activeCourses = useMemo(() => activeSemester ? courses.filter((course) => course.semester === activeSemester.season && course.year === activeSemester.year) : courses, [courses, activeSemester]);
  const historical = useMemo(() => activeSemester ? courses.filter((course) => !(course.semester === activeSemester.season && course.year === activeSemester.year)) : [], [courses, activeSemester]);
  const linkedCount = activeCourses.filter((course) => {
    const workspace = workspaceMap[course.id] || {};
    return safeUrl(workspace.notesUrl) && safeUrl(workspace.outlineUrl);
  }).length;
  const overdueCourses = activeCourses.filter((course) => courseTasks(tasks, course.title, currentTerm).some((task) => task.status !== 'done' && new Date(task.dueDate).getTime() < Date.now())).length;

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="text-sm font-medium text-emerald-300">Course workspaces</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Each course should open the work, not report statistics</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Courses now center class preparation, Drive documents, open assignments, outline maintenance, and exam readiness.</p></div><button onClick={() => setShowAdd(true)} className="rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950">Add course</button></div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Active semester</p><p className="mt-2 text-xl font-semibold text-slate-100">{activeSemester?.name || 'Not set'}</p></div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Drive ready</p><p className="mt-2 text-xl font-semibold text-emerald-300">{linkedCount}/{activeCourses.length}</p><p className="text-xs text-slate-500">notes and outline linked</p></div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Need attention</p><p className="mt-2 text-xl font-semibold text-rose-300">{overdueCourses}</p><p className="text-xs text-slate-500">courses with overdue work</p></div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-100">{activeSemester?.name || 'Current courses'}</h2><p className="text-sm text-slate-500">Open a course to work from its documents and assignments.</p></div><div className="flex gap-2"><Link href="/wizard" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Import syllabus</Link><Link href="/semester" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Term setup</Link></div></div>

      {error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}
      {loading ? <div className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading courses…</div> : null}

      {!loading && activeCourses.length ? <section className="grid gap-5 xl:grid-cols-2">{activeCourses.map((course) => <CourseCard key={course.id} course={course} workspaceMap={workspaceMap} tasks={tasks} currentTerm={currentTerm} onEdit={setEditCourse} />)}</section> : null}

      {!loading && !activeCourses.length ? <section className="rounded-xl border border-dashed border-slate-700 p-8 text-center"><p className="font-medium text-slate-200">No courses are set up for {activeSemester?.name || 'the active semester'}.</p><p className="mt-1 text-sm text-slate-500">Add the course schedule first, then connect its Drive folder and syllabus.</p><button onClick={() => setShowAdd(true)} className="mt-3 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">Add first course</button></section> : null}

      {historical.length ? <details open={showHistory} onToggle={(event) => setShowHistory((event.currentTarget as HTMLDetailsElement).open)} className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5"><summary className="cursor-pointer font-semibold text-slate-200">Previous courses ({historical.length})</summary><div className="mt-4 grid gap-3 md:grid-cols-2">{historical.map((course) => <div key={course.id} className="flex items-center justify-between rounded-lg bg-slate-950/40 p-3"><div><p className="text-sm font-medium text-slate-200">{course.title}</p><p className="text-xs text-slate-500">{course.semester} {course.year}</p></div><Link href={`/courses/${course.id}`} className="text-sm text-slate-300">Open</Link></div>)}</div></details> : null}

      {showAdd ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5"><AddCourseWizard onCourseAdded={async () => { setShowAdd(false); await refresh(); }} onClose={() => setShowAdd(false)} /></div></div> : null}
      {editCourse ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5"><EditCourseModal course={editCourse} onSaved={async () => { setEditCourse(null); await refresh(); }} onClose={() => setEditCourse(null)} /></div></div> : null}
    </main>
  );
}
