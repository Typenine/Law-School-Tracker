"use client";

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';
import { tasksClient } from '@/lib/tasksClient';
import type { Course, Task } from '@/lib/types';
import { useSemester } from '@/lib/useSemester';
import {
  COURSE_WORKSPACES_KEY,
  CourseWorkspace,
  CourseWorkspaceMap,
  courseTasks,
  examDaysRemaining,
  nextClassOccurrence,
  nextOpenTask,
  safeUrl,
  taskKind,
} from '@/lib/courseWorkspace';

const EMPTY_WORKSPACE: CourseWorkspace = {
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

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

function dueLabel(task: Task) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(task.dueDate));
}

function ResourceLink({ label, href }: { label: string; href?: string }) {
  const url = safeUrl(href);
  if (!url) return <span className="rounded-lg border border-dashed border-slate-700 px-3 py-2 text-sm text-slate-500">{label} not linked</span>;
  return <a href={url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Open {label}</a>;
}

export default function CourseWorkspacePage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { currentTerm, activeSemester } = useSemester();
  const [course, setCourse] = useState<Course | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workspaceMap, setWorkspaceMap] = useState<CourseWorkspaceMap>({});
  const [workspace, setWorkspace] = useState<CourseWorkspace>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [captureTopic, setCaptureTopic] = useState('');
  const [captureQuestion, setCaptureQuestion] = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickType, setQuickType] = useState<'reading' | 'assignment' | 'outline' | 'practice'>('reading');
  const [quickDue, setQuickDue] = useState('');

  async function refresh() {
    if (!id) return;
    setLoading(true);
    try {
      const [courseData, taskData, settingsData] = await Promise.all([
        apiFetch<{ courses: Course[] }>('/api/courses'),
        apiFetch<{ tasks: Task[] }>('/api/tasks'),
        apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${COURSE_WORKSPACES_KEY}`),
      ]);
      const found = (courseData.courses || []).find((item) => item.id === id) || null;
      const map = (settingsData.settings?.[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap;
      setCourse(found);
      setTasks(taskData.tasks || []);
      setWorkspaceMap(map);
      setWorkspace({ ...EMPTY_WORKSPACE, ...(map[id] || {}) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [id]);

  const matchingTasks = useMemo(() => course ? courseTasks(tasks, course.title, currentTerm) : [], [tasks, course, currentTerm]);
  const openTasks = useMemo(() => matchingTasks.filter((task) => task.status !== 'done').sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()), [matchingTasks]);
  const nextTask = useMemo(() => course ? nextOpenTask(tasks, course.title, currentTerm) : null, [tasks, course, currentTerm]);
  const nextClass = useMemo(() => course ? nextClassOccurrence(course) : null, [course]);
  const examDays = examDaysRemaining(workspace.examDate);
  const overdue = openTasks.filter((task) => new Date(task.dueDate).getTime() < Date.now()).length;
  const outlineTasks = matchingTasks.filter((task) => taskKind(task) === 'outline');
  const practiceTasks = matchingTasks.filter((task) => taskKind(task) === 'practice');
  const completedOutline = outlineTasks.filter((task) => task.status === 'done').length;
  const completedPractice = practiceTasks.filter((task) => task.status === 'done').length;

  async function saveWorkspace(event?: FormEvent) {
    event?.preventDefault();
    if (!id) return;
    setSaving(true);
    setMessage('');
    try {
      const clean: CourseWorkspace = {
        ...workspace,
        courseFolderUrl: safeUrl(workspace.courseFolderUrl),
        syllabusUrl: safeUrl(workspace.syllabusUrl),
        notesUrl: safeUrl(workspace.notesUrl),
        outlineUrl: safeUrl(workspace.outlineUrl),
        assignmentsUrl: safeUrl(workspace.assignmentsUrl),
        outlineProgress: Math.max(0, Math.min(100, Number(workspace.outlineProgress) || 0)),
      };
      const nextMap = { ...workspaceMap, [id]: clean };
      await apiFetch('/api/settings', { method: 'PATCH', body: { [COURSE_WORKSPACES_KEY]: nextMap } });
      setWorkspaceMap(nextMap);
      setWorkspace(clean);
      setMessage('Course workspace saved.');
    } catch {
      setMessage('Course workspace could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function captureClass() {
    if (!course || !id || (!captureTopic.trim() && !captureQuestion.trim())) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const updated: CourseWorkspace = {
        ...workspace,
        lastClassCaptureAt: now,
        lastClassTopic: captureTopic.trim() || workspace.lastClassTopic,
        lastClassQuestion: captureQuestion.trim() || workspace.lastClassQuestion,
      };
      const nextMap = { ...workspaceMap, [id]: updated };
      await apiFetch('/api/settings', { method: 'PATCH', body: { [COURSE_WORKSPACES_KEY]: nextMap } });

      if (captureTopic.trim()) {
        const due = new Date();
        due.setDate(due.getDate() + 6);
        due.setHours(20, 0, 0, 0);
        await tasksClient.create({
          title: `Add to ${course.title} outline: ${captureTopic.trim()}`,
          course: course.title,
          dueDate: due.toISOString(),
          status: 'todo',
          term: currentTerm || null,
          activity: 'outline',
          notes: captureQuestion.trim() ? `Question from class: ${captureQuestion.trim()}` : null,
        }, { silent: true });
      }

      setWorkspaceMap(nextMap);
      setWorkspace(updated);
      setCaptureTopic('');
      setCaptureQuestion('');
      setMessage('Class captured and outline follow-up created.');
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function addQuickTask(event: FormEvent) {
    event.preventDefault();
    if (!course || !quickTitle.trim() || !quickDue) return;
    const due = new Date(`${quickDue}T23:59:59`);
    await tasksClient.create({
      title: quickTitle.trim(),
      course: course.title,
      dueDate: due.toISOString(),
      status: 'todo',
      term: currentTerm || null,
      activity: quickType === 'assignment' ? 'other' : quickType,
    }, { silent: true });
    setQuickTitle('');
    setMessage('Task added.');
    await refresh();
  }

  async function createExamTask(kind: 'outline' | 'practice' | 'review') {
    if (!course) return;
    const due = workspace.examDate ? new Date(`${workspace.examDate}T20:00:00`) : new Date(Date.now() + 7 * 86400000);
    if (workspace.examDate) due.setDate(due.getDate() - (kind === 'outline' ? 14 : kind === 'practice' ? 7 : 3));
    const titles = {
      outline: `Complete ${course.title} attack outline`,
      practice: `Complete a timed ${course.title} practice essay`,
      review: `Review weak issues for ${course.title}`,
    };
    await tasksClient.create({
      title: titles[kind],
      course: course.title,
      dueDate: due.toISOString(),
      status: 'todo',
      term: currentTerm || null,
      activity: kind === 'practice' ? 'practice' : kind === 'outline' ? 'outline' : 'review',
    }, { silent: true });
    setMessage('Exam-prep task added.');
    await refresh();
  }

  if (loading) return <main className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading course workspace…</main>;
  if (!course) return <main className="space-y-3"><p className="text-slate-300">Course not found.</p><Link href="/courses" className="text-emerald-300">Back to courses</Link></main>;

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/courses" className="text-sm text-slate-400 hover:text-white">Courses</Link>
            <h2 className="mt-2 text-2xl font-semibold text-slate-100">{course.title}</h2>
            <p className="mt-1 text-sm text-slate-400">{[course.code, course.instructor, activeSemester?.name].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ResourceLink label="notes" href={workspace.notesUrl} />
            <ResourceLink label="outline" href={workspace.outlineUrl} />
          </div>
        </div>
      </section>

      {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Next class</p><p className="mt-2 font-medium text-slate-100">{nextClass ? formatDateTime(nextClass.start) : 'Schedule not set'}</p>{nextClass?.location ? <p className="mt-1 text-xs text-slate-400">{nextClass.location}</p> : null}</div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Next task</p><p className="mt-2 font-medium text-slate-100">{nextTask?.title || 'No open work'}</p>{nextTask ? <p className="mt-1 text-xs text-slate-400">Due {dueLabel(nextTask)}</p> : null}</div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Course status</p><p className={`mt-2 font-medium ${overdue ? 'text-rose-300' : 'text-emerald-300'}`}>{overdue ? `${overdue} overdue` : `${openTasks.length} open tasks`}</p><p className="mt-1 text-xs text-slate-400">Outline {workspace.outlineProgress || 0}% complete</p></div>
        <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">Exam</p><p className="mt-2 font-medium text-slate-100">{examDays === null ? 'Date not set' : examDays < 0 ? 'Exam passed' : `${examDays} days remaining`}</p>{workspace.examFormat ? <p className="mt-1 text-xs text-slate-400">{workspace.examFormat}</p> : null}</div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="font-semibold text-slate-100">Prepare for class</h2><p className="text-sm text-slate-400">Open the material without searching Drive.</p></div>
              {nextTask ? <Link href={`/tasks?course=${encodeURIComponent(course.title)}`} className="text-sm text-emerald-300">All course tasks</Link> : null}
            </div>
            {nextTask ? <div className="mt-4 rounded-lg bg-slate-950/45 p-4"><p className="text-sm font-medium text-slate-200">{nextTask.title}</p><p className="mt-1 text-xs text-slate-500">Due {dueLabel(nextTask)}</p></div> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <ResourceLink label="course folder" href={workspace.courseFolderUrl} />
              <ResourceLink label="syllabus" href={workspace.syllabusUrl} />
              <ResourceLink label="class notes" href={workspace.notesUrl} />
              <ResourceLink label="assignments" href={workspace.assignmentsUrl} />
            </div>
          </section>

          <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
            <div><h2 className="font-semibold text-slate-100">Thirty-second after-class capture</h2><p className="mt-1 text-sm text-slate-400">Record only what needs follow-up. Your full notes stay in Google Drive.</p></div>
            <div className="mt-4 grid gap-3">
              <input value={captureTopic} onChange={(event) => setCaptureTopic(event.target.value)} placeholder="Doctrine, case, or issue to add to the outline" className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100 placeholder:text-slate-500" />
              <textarea value={captureQuestion} onChange={(event) => setCaptureQuestion(event.target.value)} placeholder="Question or point that was unclear" rows={3} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100 placeholder:text-slate-500" />
              <div><button disabled={saving || (!captureTopic.trim() && !captureQuestion.trim())} onClick={captureClass} className="rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">Save class follow-up</button></div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
            <h2 className="font-semibold text-slate-100">Open work</h2>
            <div className="mt-3 space-y-2">
              {openTasks.slice(0, 8).map((task) => <div key={task.id} className="flex items-start justify-between gap-4 rounded-lg bg-slate-950/40 p-3"><div><p className="text-sm font-medium text-slate-200">{task.title}</p><p className="mt-1 text-xs capitalize text-slate-500">{taskKind(task)} · due {dueLabel(task)}</p></div><Link href={`/tasks?course=${encodeURIComponent(course.title)}&text=${encodeURIComponent(task.title)}`} className="text-xs text-emerald-300">Open</Link></div>)}
              {!openTasks.length ? <p className="py-4 text-sm text-slate-500">No open tasks for this course.</p> : null}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <form onSubmit={saveWorkspace} className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
            <h2 className="font-semibold text-slate-100">Course links and exam setup</h2>
            <p className="mt-1 text-sm text-slate-400">Paste share links from the Google Drive folders and documents you already created.</p>
            <div className="mt-4 space-y-3">
              {([
                ['courseFolderUrl', 'Course folder URL'],
                ['syllabusUrl', 'Syllabus URL'],
                ['notesUrl', 'Class notes URL'],
                ['outlineUrl', 'Master outline URL'],
                ['assignmentsUrl', 'Assignments folder URL'],
              ] as const).map(([field, label]) => <label key={field} className="block text-sm text-slate-300"><span>{label}</span><input type="url" value={workspace[field] || ''} onChange={(event) => setWorkspace((previous) => ({ ...previous, [field]: event.target.value }))} placeholder="https://docs.google.com/…" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100 placeholder:text-slate-600" /></label>)}
              <label className="block text-sm text-slate-300"><span>Exam date</span><input type="date" value={workspace.examDate || ''} onChange={(event) => setWorkspace((previous) => ({ ...previous, examDate: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100" /></label>
              <label className="block text-sm text-slate-300"><span>Exam format</span><input value={workspace.examFormat || ''} onChange={(event) => setWorkspace((previous) => ({ ...previous, examFormat: event.target.value }))} placeholder="4 essays, open book" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100" /></label>
              <label className="block text-sm text-slate-300"><span>Outline completion: {workspace.outlineProgress || 0}%</span><input type="range" min={0} max={100} step={5} value={workspace.outlineProgress || 0} onChange={(event) => setWorkspace((previous) => ({ ...previous, outlineProgress: Number(event.target.value) }))} className="mt-2 w-full" /></label>
              <button disabled={saving} className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">{saving ? 'Saving…' : 'Save course workspace'}</button>
            </div>
          </form>

          <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
            <h2 className="font-semibold text-slate-100">Quick add for this course</h2>
            <form onSubmit={addQuickTask} className="mt-3 space-y-3">
              <input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder="Reading or assignment" className="w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100 placeholder:text-slate-500" />
              <div className="grid grid-cols-2 gap-2"><select value={quickType} onChange={(event) => setQuickType(event.target.value as any)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100"><option value="reading">Reading</option><option value="assignment">Assignment</option><option value="outline">Outline</option><option value="practice">Practice</option></select><input type="date" value={quickDue} onChange={(event) => setQuickDue(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100" /></div>
              <button disabled={!quickTitle.trim() || !quickDue} className="w-full rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">Add task</button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
            <div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-100">Exam mode</h2><p className="text-sm text-slate-400">Build the issue-spotting workflow before the exam.</p></div>{examDays !== null && examDays >= 0 ? <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs text-amber-300">{examDays} days</span> : null}</div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-center text-sm"><div className="rounded-lg bg-slate-950/45 p-3"><p className="text-xl font-semibold text-slate-100">{completedOutline}/{outlineTasks.length}</p><p className="text-xs text-slate-500">Outline tasks</p></div><div className="rounded-lg bg-slate-950/45 p-3"><p className="text-xl font-semibold text-slate-100">{completedPractice}/{practiceTasks.length}</p><p className="text-xs text-slate-500">Practice tasks</p></div></div>
            <div className="mt-3 space-y-2"><button onClick={() => createExamTask('outline')} className="w-full rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Add attack-outline task</button><button onClick={() => createExamTask('practice')} className="w-full rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Add timed essay task</button><button onClick={() => createExamTask('review')} className="w-full rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Add weak-issues review</button></div>
          </section>
        </aside>
      </div>
    </main>
  );
}
