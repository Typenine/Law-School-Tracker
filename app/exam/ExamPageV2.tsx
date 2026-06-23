"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { examPlanTasks } from '@/lib/examPlanning';
import { courseTermMatches, examDaysRemaining, taskKind } from '@/lib/courseWorkspace';
import { isActiveTask, taskMatchesCourse } from '@/lib/taskMetadata';
import { tasksClient } from '@/lib/tasksClient';
import { useCourses } from '@/lib/useCourses';
import { useCourseWorkspaces } from '@/lib/useCourseWorkspaces';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';
import type { Course } from '@/lib/types';

export default function ExamPageV2() {
  const { courses } = useCourses();
  const { tasks, refresh } = useTasks();
  const { activeSemester, currentTerm } = useSemester();
  const { workspaces, updateWorkspace } = useCourseWorkspaces();
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState('');

  const activeCourses = useMemo(() => courses.filter(course => courseTermMatches(course, activeSemester?.season, activeSemester?.year)), [courses, activeSemester]);
  const examCourses = useMemo(() => activeCourses.map(course => {
    const workspace = workspaces[course.id] || {};
    const matching = tasks.filter(task => isActiveTask(task) && taskMatchesCourse(task, course) && (!currentTerm || !task.term || task.term === currentTerm));
    const outline = matching.filter(task => taskKind(task) === 'outline');
    const practice = matching.filter(task => taskKind(task) === 'practice');
    const review = matching.filter(task => (task.activity || '').toLowerCase() === 'review');
    return { course, workspace, outline, practice, review, prep: workspace.examPrep || {}, days: examDaysRemaining(workspace.examDate) };
  }).sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999)), [activeCourses, workspaces, tasks, currentTerm]);

  async function addTask(course: Course, title: string, activity: string, dueDate?: string, notes?: string) {
    const due = dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 86400000);
    await tasksClient.create({ title, course: course.title, courseId: course.id, dueDate: due.toISOString(), status: 'todo', term: currentTerm || null, activity, notes: notes || null }, { silent: true });
  }

  async function generatePlan(course: Course, examDate: string | undefined, weakAreas: string[]) {
    if (!examDate) { setMessage(`Set an exam date for ${course.title} first.`); return; }
    setWorking(course.id);
    try {
      const existing = new Set(tasks.filter(task => isActiveTask(task) && taskMatchesCourse(task, course)).map(task => task.title.toLowerCase()));
      let created = 0;
      for (const item of examPlanTasks(course.title, examDate, weakAreas)) {
        if (existing.has(item.title.toLowerCase())) continue;
        await tasksClient.create({ title: item.title, course: course.title, courseId: course.id, dueDate: item.dueDate, status: 'todo', term: currentTerm || null, activity: item.activity, estimatedMinutes: item.minutes, tags: ['exam-plan'] }, { silent: true });
        created++;
      }
      await updateWorkspace(course.id, workspace => ({ ...workspace, examPrep: { ...(workspace.examPrep || {}), generatedPlanAt: new Date().toISOString() } }));
      setMessage(`${created} exam-prep task${created === 1 ? '' : 's'} created for ${course.title}.`);
      await refresh();
    } finally { setWorking(''); }
  }

  async function addListItem(courseId: string, field: 'weakAreas' | 'ruleStatements' | 'caseAnalogies' | 'flowchartCandidates' | 'printedOutlineAdditions', label: string) {
    const value = window.prompt(label)?.trim();
    if (!value) return;
    await updateWorkspace(courseId, workspace => ({ ...workspace, examPrep: { ...(workspace.examPrep || {}), [field]: Array.from(new Set([...(workspace.examPrep?.[field] || []), value])) } }));
  }

  async function removeListItem(courseId: string, field: 'weakAreas' | 'ruleStatements' | 'caseAnalogies' | 'flowchartCandidates' | 'printedOutlineAdditions', value: string) {
    await updateWorkspace(courseId, workspace => ({ ...workspace, examPrep: { ...(workspace.examPrep || {}), [field]: (workspace.examPrep?.[field] || []).filter(item => item !== value) } }));
  }

  async function addPracticeResult(courseId: string) {
    const type = (window.prompt('Practice type: essay, multiple-choice, issue-spotter, or other', 'essay') || 'essay') as any;
    const scoreText = window.prompt('Score or percentage, if available:') || '';
    const notes = window.prompt('What did the practice reveal?') || '';
    await updateWorkspace(courseId, workspace => ({ ...workspace, examPrep: { ...(workspace.examPrep || {}), practiceResults: [...(workspace.examPrep?.practiceResults || []), { id: `practice:${courseId}:${Date.now()}`, date: new Date().toISOString().slice(0, 10), type, score: scoreText ? Number(scoreText) : undefined, notes: notes || undefined }] } }));
  }

  async function createIssueDrill(course: Course, weakArea: string) {
    const due = new Date(); due.setDate(due.getDate() + 2); due.setHours(20, 0, 0, 0);
    await addTask(course, `Issue drill: ${weakArea}`, 'practice', due.toISOString(), `Write the rule, exceptions, key cases, and a short application for ${weakArea}.`);
    setMessage(`Issue drill added for ${course.title}.`);
    await refresh();
  }

  return <main className="space-y-6">
    <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/30 to-slate-950 p-6"><p className="text-sm font-medium text-amber-300">Exam mode</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Build issue-spotting tools, not just study hours</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Countdown plans compress around the time actually remaining, so starting late does not immediately create overdue work.</p></section>
    {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}
    <div className="space-y-6">{examCourses.map(({ course, workspace, outline, practice, review, prep, days }) => {
      const outlineDone = outline.filter(task => task.status === 'done').length;
      const practiceDone = practice.filter(task => task.status === 'done').length;
      const reviewDone = review.filter(task => task.status === 'done').length;
      const weakAreas = prep.weakAreas || [];
      const total = Math.max(1, outline.length + practice.length + review.length);
      const completed = outlineDone + practiceDone + reviewDone;
      const planProgress = Math.round(((workspace.outlineProgress || 0) + Math.min(100, completed / total * 100)) / 2);
      return <article key={course.id} className={`rounded-xl border p-5 ${days !== null && days <= 21 && days >= 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-700 bg-slate-900/45'}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><h2 className="text-lg font-semibold text-slate-100">{course.title}</h2><p className="mt-1 text-sm text-slate-400">{workspace.examFormat || 'Exam format not recorded'}</p></div><div className="flex gap-2"><span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs text-amber-300">{days === null ? 'Set exam date' : days < 0 ? 'Completed' : `${days} days`}</span><span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300">{planProgress}% plan progress</span></div></div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-lg bg-slate-950/45 p-3 text-center"><p className="text-xl font-semibold text-slate-100">{outlineDone}/{outline.length}</p><p className="text-xs text-slate-500">Outline</p></div><div className="rounded-lg bg-slate-950/45 p-3 text-center"><p className="text-xl font-semibold text-slate-100">{practiceDone}/{practice.length}</p><p className="text-xs text-slate-500">Practice</p></div><div className="rounded-lg bg-slate-950/45 p-3 text-center"><p className="text-xl font-semibold text-slate-100">{weakAreas.length}</p><p className="text-xs text-slate-500">Weak areas</p></div><div className="rounded-lg bg-slate-950/45 p-3 text-center"><p className="text-xl font-semibold text-slate-100">{prep.practiceResults?.length || 0}</p><p className="text-xs text-slate-500">Results logged</p></div></div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2"><section className="rounded-lg bg-slate-950/35 p-4"><div className="flex items-center justify-between"><h3 className="font-medium text-slate-100">Weak areas and issue drills</h3><button onClick={() => addListItem(course.id, 'weakAreas', 'Weak rule, issue, or topic:')} className="text-xs text-amber-300">Add weak area</button></div><div className="mt-3 space-y-2">{weakAreas.map(area => <div key={area} className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/70 p-2.5"><span className="text-sm text-slate-200">{area}</span><div className="flex gap-2"><button onClick={() => createIssueDrill(course, area)} className="text-xs text-sky-300">Create drill</button><button onClick={() => removeListItem(course.id, 'weakAreas', area)} className="text-xs text-rose-300">Remove</button></div></div>)}{!weakAreas.length ? <p className="text-sm text-slate-500">No weak areas recorded.</p> : null}</div></section><section className="rounded-lg bg-slate-950/35 p-4"><div className="flex items-center justify-between"><h3 className="font-medium text-slate-100">Practice results</h3><button onClick={() => addPracticeResult(course.id)} className="text-xs text-amber-300">Log result</button></div><div className="mt-3 space-y-2">{(prep.practiceResults || []).slice(-5).reverse().map(result => <div key={result.id} className="rounded-lg bg-slate-900/70 p-2.5"><p className="text-sm text-slate-200">{result.type}{result.score !== undefined ? ` · ${result.score}` : ''}</p><p className="text-xs text-slate-500">{result.date}{result.notes ? ` · ${result.notes}` : ''}</p></div>)}{!prep.practiceResults?.length ? <p className="text-sm text-slate-500">No practice results logged.</p> : null}</div></section></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{([['ruleStatements','Rule statements'],['caseAnalogies','Case analogies'],['flowchartCandidates','Flowchart candidates'],['printedOutlineAdditions','Printed outline additions']] as const).map(([field, label]) => <section key={field} className="rounded-lg border border-slate-700 p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium text-slate-200">{label}</h3><button onClick={() => addListItem(course.id, field, `Add ${label.toLowerCase()}:`)} className="text-xs text-amber-300">Add</button></div><div className="mt-2 space-y-1">{(prep[field] || []).slice(0, 6).map(item => <button key={item} onClick={() => removeListItem(course.id, field, item)} className="block w-full rounded bg-slate-950/40 p-2 text-left text-xs text-slate-300 hover:text-rose-300">{item}</button>)}{!(prep[field] || []).length ? <p className="text-xs text-slate-600">None yet.</p> : null}</div></section>)}</div>
        <div className="mt-5 flex flex-wrap gap-2"><button disabled={working === course.id || !workspace.examDate} onClick={() => generatePlan(course, workspace.examDate, weakAreas)} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Generate exam countdown plan</button><Link href={`/courses/${course.id}`} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Course workspace</Link><Link href="/outline-updates" className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Outline drafts</Link></div>
      </article>;
    })}{!examCourses.length ? <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-500">No active courses are available.</div> : null}</div>
  </main>;
}
