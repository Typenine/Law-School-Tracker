"use client";

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  examDaysRemaining,
  nextClassOccurrence,
  safeUrl,
  type CourseWorkspace,
} from '@/lib/courseWorkspace';
import { isActiveTask, taskMatchesCourse } from '@/lib/taskMetadata';
import { useCourses } from '@/lib/useCourses';
import { useCourseWorkspaces } from '@/lib/useCourseWorkspaces';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';
import WorkspaceAcademic from './WorkspaceAcademic';
import WorkspaceResources from './WorkspaceResources';
import WorkspaceTasks from './WorkspaceTasks';

const EMPTY: CourseWorkspace = {
  courseFolderUrl: '',
  syllabusUrl: '',
  notesUrl: '',
  outlineUrl: '',
  assignmentsUrl: '',
  examDate: '',
  examFormat: '',
  outlineProgress: 0,
  preparedDates: [],
};

function formatClass(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(value);
}

function resourceLink(label: string, href?: string) {
  const url = safeUrl(href);
  return url
    ? <a href={url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Open {label}</a>
    : <span className="rounded-lg border border-dashed border-slate-700 px-3 py-2 text-sm text-slate-500">{label} not linked</span>;
}

export default function CourseWorkspaceClient() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id || '';
  const { courses, loading: coursesLoading } = useCourses();
  const { tasks, loading: tasksLoading, refresh } = useTasks();
  const { workspaces, loading: workspaceLoading, updateWorkspace } = useCourseWorkspaces();
  const { currentTerm, activeSemester } = useSemester();
  const course = courses.find(item => item.id === id) || null;
  const stored = workspaces[id] || EMPTY;
  const [workspace, setWorkspace] = useState<CourseWorkspace>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => setWorkspace({ ...EMPTY, ...stored }), [stored]);

  const matching = useMemo(() => course ? tasks.filter(task =>
    isActiveTask(task) &&
    taskMatchesCourse(task, course) &&
    (!currentTerm || !task.term || task.term === currentTerm)
  ) : [], [tasks, course, currentTerm]);
  const openTasks = useMemo(() => matching.filter(task => task.status !== 'done').sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [matching]);
  const overdue = openTasks.filter(task => new Date(task.dueDate).getTime() < Date.now()).length;
  const nextClass = course ? nextClassOccurrence(course) : null;
  const examDays = examDaysRemaining(workspace.examDate);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    setSaving(true);
    setMessage('');
    try {
      const next: CourseWorkspace = {
        ...stored,
        ...workspace,
        courseFolderUrl: safeUrl(workspace.courseFolderUrl),
        syllabusUrl: safeUrl(workspace.syllabusUrl),
        notesUrl: safeUrl(workspace.notesUrl),
        outlineUrl: safeUrl(workspace.outlineUrl),
        assignmentsUrl: safeUrl(workspace.assignmentsUrl),
        outlineProgress: Math.max(0, Math.min(100, Number(workspace.outlineProgress) || 0)),
      };
      const saved = await updateWorkspace(id, next);
      setWorkspace({ ...EMPTY, ...saved });
      setMessage('Course workspace saved.');
    } catch (cause: any) {
      setMessage(cause?.message || 'Course workspace could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (coursesLoading || tasksLoading || workspaceLoading) return <main className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading course workspace…</main>;
  if (!course) return <main className="space-y-3"><p className="text-slate-300">Course not found.</p><Link href="/courses" className="text-emerald-300">Back to courses</Link></main>;

  return <main className="space-y-6">
    <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><Link href="/courses" className="text-sm text-slate-400">Courses</Link><h2 className="mt-2 text-2xl font-semibold text-slate-100">{course.title}</h2><p className="mt-1 text-sm text-slate-400">{[course.code, course.instructor, activeSemester?.name].filter(Boolean).join(' · ')}</p></div><div className="flex flex-wrap gap-2">{resourceLink('notes', workspace.notesUrl)}{resourceLink('outline', workspace.outlineUrl)}</div></div>
    </section>
    {message ? <div className={`rounded-xl border p-4 text-sm ${message.includes('could not') ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>{message}</div> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Next class</p><p className="mt-2 font-medium text-slate-100">{nextClass ? formatClass(nextClass.start) : 'Schedule not set'}</p>{nextClass?.location ? <p className="mt-1 text-xs text-slate-400">{nextClass.location}</p> : null}</div>
      <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Next task</p><p className="mt-2 font-medium text-slate-100">{openTasks[0]?.title || 'No open work'}</p>{openTasks[0] ? <p className="mt-1 text-xs text-slate-400">Due {new Date(openTasks[0].dueDate).toLocaleDateString()}</p> : null}</div>
      <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Status</p><p className={`mt-2 font-medium ${overdue ? 'text-rose-300' : 'text-emerald-300'}`}>{overdue ? `${overdue} overdue` : `${openTasks.length} open tasks`}</p><p className="mt-1 text-xs text-slate-400">Outline {workspace.outlineProgress || 0}% complete</p></div>
      <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Exam</p><p className="mt-2 font-medium text-slate-100">{examDays === null ? 'Date not set' : examDays < 0 ? 'Exam passed' : `${examDays} days remaining`}</p>{workspace.examFormat ? <p className="mt-1 text-xs text-slate-400">{workspace.examFormat}</p> : null}</div>
    </section>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <div className="space-y-6"><WorkspaceAcademic course={course} workspace={stored} /><WorkspaceTasks course={course} currentTerm={currentTerm} openTasks={openTasks} onChanged={refresh} /></div>
      <aside className="space-y-6"><WorkspaceResources workspace={workspace} setWorkspace={setWorkspace} saving={saving} onSave={save} /><section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5"><h2 className="font-semibold text-slate-100">Course materials</h2><div className="mt-3 flex flex-wrap gap-2">{resourceLink('course folder', workspace.courseFolderUrl)}{resourceLink('syllabus', workspace.syllabusUrl)}{resourceLink('notes', workspace.notesUrl)}{resourceLink('assignments', workspace.assignmentsUrl)}</div></section></aside>
    </div>
  </main>;
}
