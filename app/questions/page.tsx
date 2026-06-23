"use client";

import { FormEvent, useMemo, useState } from 'react';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useCourseWorkspaces } from '@/lib/useCourseWorkspaces';
import type { CourseQuestion } from '@/lib/courseWorkspace';

export default function QuestionsPage() {
  const { courses } = useCourses();
  const { activeSemester } = useSemester();
  const { workspaces, updateWorkspace } = useCourseWorkspaces();
  const [courseId, setCourseId] = useState('');
  const [text, setText] = useState('');
  const [source, setSource] = useState<CourseQuestion['source']>('class');
  const [filter, setFilter] = useState<'open' | 'answered' | 'all'>('open');
  const [saving, setSaving] = useState(false);

  const activeCourses = useMemo(() => activeSemester ? courses.filter(course => course.semester === activeSemester.season && course.year === activeSemester.year) : courses, [courses, activeSemester]);
  const rows = useMemo(() => activeCourses.flatMap(course => (workspaces[course.id]?.questions || []).map(question => ({ course, question }))).filter(row => filter === 'all' || row.question.status === filter).sort((a, b) => b.question.createdAt.localeCompare(a.question.createdAt)), [activeCourses, workspaces, filter]);
  const officeHours = rows.filter(row => row.question.status === 'open' && row.question.officeHours);

  async function addQuestion(event: FormEvent) {
    event.preventDefault();
    if (!courseId || !text.trim()) return;
    setSaving(true);
    try {
      const question: CourseQuestion = { id: `question:${courseId}:${Date.now()}`, text: text.trim(), source, status: 'open', officeHours: true, createdAt: new Date().toISOString() };
      await updateWorkspace(courseId, workspace => ({ ...workspace, questions: [...(workspace.questions || []), question] }));
      setText('');
    } finally { setSaving(false); }
  }

  async function updateQuestion(courseId: string, questionId: string, patch: Partial<CourseQuestion>) {
    await updateWorkspace(courseId, workspace => ({ ...workspace, questions: (workspace.questions || []).map(question => question.id === questionId ? { ...question, ...patch } : question) }));
  }

  async function removeQuestion(courseId: string, questionId: string) {
    if (!window.confirm('Delete this question?')) return;
    await updateWorkspace(courseId, workspace => ({ ...workspace, questions: (workspace.questions || []).filter(question => question.id !== questionId) }));
  }

  async function copyAgenda() {
    const text = officeHours.map(({ course, question }, index) => `${index + 1}. ${course.title}: ${question.text}`).join('\n');
    await navigator.clipboard.writeText(text || 'No office-hours questions are currently selected.');
  }

  return <main className="space-y-6">
    <section className="rounded-2xl border border-sky-500/30 bg-gradient-to-br from-sky-950/30 to-slate-950 p-6"><p className="text-sm font-medium text-sky-300">Question tracker</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Capture confusion before it disappears</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Questions from readings, class, assignments, and exam practice remain attached to the course until answered. Mark the ones that belong on the next office-hours agenda.</p></section>

    <form onSubmit={addQuestion} className="rounded-xl border border-slate-700 bg-slate-900/45 p-5"><div className="grid gap-3 lg:grid-cols-[220px_170px_minmax(0,1fr)_auto]"><select value={courseId} onChange={event => setCourseId(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100"><option value="">Select course</option>{activeCourses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select><select value={source} onChange={event => setSource(event.target.value as CourseQuestion['source'])} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100"><option value="reading">Reading</option><option value="class">Class</option><option value="assignment">Assignment</option><option value="exam">Exam practice</option><option value="other">Other</option></select><input value={text} onChange={event => setText(event.target.value)} placeholder="What needs an answer?" className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100" /><button disabled={saving || !courseId || !text.trim()} className="rounded-lg bg-sky-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">Add question</button></div></form>

    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-semibold text-amber-200">Office-hours agenda</h2><p className="mt-1 text-sm text-slate-400">Only open questions marked for office hours appear here.</p></div><button onClick={copyAgenda} className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-300">Copy agenda</button></div><div className="mt-4 space-y-2">{officeHours.map(({ course, question }, index) => <div key={question.id} className="rounded-lg bg-slate-950/40 p-3"><p className="text-sm font-medium text-slate-200">{index + 1}. {question.text}</p><p className="mt-1 text-xs text-slate-500">{course.title} · {question.source}</p></div>)}{!officeHours.length ? <p className="text-sm text-slate-500">No questions are currently selected.</p> : null}</div></section>

    <section className="space-y-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold text-slate-100">All course questions</h2><p className="text-sm text-slate-500">Keep the list open until the issue is actually resolved.</p></div><div className="flex rounded-lg border border-slate-700 p-1 text-xs">{(['open','answered','all'] as const).map(value => <button key={value} onClick={() => setFilter(value)} className={`rounded px-3 py-1.5 capitalize ${filter === value ? 'bg-sky-500 text-slate-950' : 'text-slate-400'}`}>{value}</button>)}</div></div>{rows.map(({ course, question }) => <article key={question.id} className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-sky-500/10 px-2 py-1 text-sky-300">{course.title}</span><span className="capitalize text-slate-500">{question.source}</span><span className={question.status === 'answered' ? 'text-emerald-300' : 'text-amber-300'}>{question.status}</span></div><p className="mt-2 font-medium text-slate-100">{question.text}</p>{question.answer ? <p className="mt-2 rounded-lg bg-slate-950/40 p-3 text-sm text-slate-300">{question.answer}</p> : null}</div><div className="flex flex-wrap gap-2">{question.status === 'open' ? <button onClick={() => { const answer = window.prompt('Answer or resolution:') || ''; if (answer.trim()) void updateQuestion(course.id, question.id, { status: 'answered', answer: answer.trim(), answeredAt: new Date().toISOString() }); }} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950">Mark answered</button> : <button onClick={() => updateQuestion(course.id, question.id, { status: 'open', answer: undefined, answeredAt: undefined })} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200">Reopen</button>}<button onClick={() => updateQuestion(course.id, question.id, { officeHours: !question.officeHours })} className={`rounded-lg border px-3 py-2 text-xs ${question.officeHours ? 'border-amber-500/40 text-amber-300' : 'border-slate-600 text-slate-300'}`}>{question.officeHours ? 'On agenda' : 'Add to agenda'}</button><button onClick={() => removeQuestion(course.id, question.id)} className="rounded-lg border border-rose-500/40 px-3 py-2 text-xs text-rose-300">Delete</button></div></div></article>)}{!rows.length ? <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-500">No questions match this view.</div> : null}</section>
  </main>;
}
