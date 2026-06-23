"use client";

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { tasksClient } from '@/lib/tasksClient';
import type { ClassCapture, CourseQuestion } from '@/lib/courseWorkspace';
import { useCourses } from '@/lib/useCourses';
import { useCourseWorkspaces } from '@/lib/useCourseWorkspaces';
import { useSemester } from '@/lib/useSemester';

export default function ClassCaptureForm() {
  const params = useSearchParams();
  const courseId = params.get('course') || '';
  const { courses } = useCourses();
  const { currentTerm } = useSemester();
  const { workspaces, updateWorkspace } = useCourseWorkspaces();
  const course = courses.find(item => item.id === courseId) || null;
  const [date, setDate] = useState(params.get('date') || new Date().toISOString().slice(0, 10));
  const [topic, setTopic] = useState('');
  const [cases, setCases] = useState('');
  const [emphasis, setEmphasis] = useState('');
  const [question, setQuestion] = useState('');
  const [outline, setOutline] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!course || topic) return;
    const session = workspaces[course.id]?.syllabusAnalysis?.sessionSummary?.find(item => item.date === date);
    if (session?.topic) setTopic(session.topic);
  }, [course, workspaces, date, topic]);

  async function save() {
    if (!course || (!topic.trim() && !cases.trim() && !emphasis.trim() && !question.trim())) return;
    const now = new Date().toISOString();
    const capture: ClassCapture = { id: `capture:${course.id}:${Date.now()}`, classDate: date, topic: topic.trim() || undefined, cases: cases.trim() || undefined, professorEmphasis: emphasis.trim() || undefined, question: question.trim() || undefined, outlineFlag: outline, createdAt: now };
    const newQuestion: CourseQuestion | null = question.trim() ? { id: `question:${course.id}:${Date.now()}`, text: question.trim(), source: 'class', status: 'open', officeHours: true, createdAt: now } : null;
    await updateWorkspace(course.id, workspace => ({ ...workspace, lastClassCaptureAt: now, lastClassTopic: capture.topic || workspace.lastClassTopic, lastClassQuestion: capture.question || workspace.lastClassQuestion, classCaptures: [...(workspace.classCaptures || []), capture], questions: newQuestion ? [...(workspace.questions || []), newQuestion] : workspace.questions || [] }));
    if (outline && (topic.trim() || cases.trim() || emphasis.trim())) {
      const due = new Date(); due.setDate(due.getDate() + 5); due.setHours(20, 0, 0, 0);
      await tasksClient.create({ title: `Outline follow-up: ${topic.trim() || course.title}`, course: course.title, dueDate: due.toISOString(), status: 'todo', term: currentTerm || null, activity: 'outline', notes: [cases && `Cases: ${cases}`, emphasis && `Professor emphasis: ${emphasis}`, question && `Question: ${question}`].filter(Boolean).join('\n'), tags: ['after-class-capture'] }, { silent: true });
    }
    setTopic(''); setCases(''); setEmphasis(''); setQuestion('');
    setMessage('Class captured and routed to the outline and question workflows.');
  }

  if (!course) return <Link href="/courses" className="text-emerald-300">Select a course from Courses.</Link>;

  return <div className="space-y-6">
    <section className="rounded-2xl border border-emerald-500/30 bg-slate-950 p-6"><Link href={`/courses/${course.id}`} className="text-sm text-slate-400">Back to {course.title}</Link><p className="mt-4 text-sm text-emerald-300">After-class capture</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Record only what should affect the outline or next conversation</h2></section>
    {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}
    <section className="rounded-xl border border-slate-700 bg-slate-900/45 p-5"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-slate-300">Class date<input type="date" value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100" /></label><label className="text-sm text-slate-300">Doctrine or issue<input value={topic} onChange={event => setTopic(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100" /></label><label className="text-sm text-slate-300">Cases and analogies<input value={cases} onChange={event => setCases(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100" /></label><label className="text-sm text-slate-300">Professor emphasis<input value={emphasis} onChange={event => setEmphasis(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100" /></label><label className="sm:col-span-2 text-sm text-slate-300">Unresolved question<textarea rows={3} value={question} onChange={event => setQuestion(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100" /></label></div><label className="mt-4 flex items-center gap-3 rounded-lg bg-slate-950/40 p-3 text-sm text-slate-300"><input type="checkbox" checked={outline} onChange={event => setOutline(event.target.checked)} />Include this in the weekly outline draft</label><button onClick={save} className="mt-4 rounded-lg bg-emerald-500 px-5 py-2.5 font-semibold text-slate-950">Save class capture</button></section>
  </div>;
}
