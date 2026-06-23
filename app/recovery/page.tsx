"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { recoveryReason } from '@/lib/academicWorkflow';
import { examDaysRemaining, taskKind } from '@/lib/courseWorkspace';
import { tasksClient } from '@/lib/tasksClient';
import type { CourseQuestion } from '@/lib/courseWorkspace';
import type { Task } from '@/lib/types';
import { useCourses } from '@/lib/useCourses';
import { useCourseWorkspaces } from '@/lib/useCourseWorkspaces';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';

type Category = 'must' | 'skim' | 'ask' | 'defer' | 'drop';

function daysUntil(value: string) {
  const due = new Date(value); const today = new Date();
  today.setHours(12, 0, 0, 0); due.setHours(12, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / 86400000);
}
function estimate(task: Task) {
  if (task.estimatedMinutes) return task.estimatedMinutes;
  const kind = taskKind(task);
  return kind === 'reading' ? 75 : kind === 'outline' ? 45 : kind === 'practice' ? 75 : kind === 'assignment' ? 120 : 30;
}
function classify(task: Task, examDays?: number | null): Category {
  const title = `${task.title} ${(task.tags || []).join(' ')} ${task.notes || ''}`.toLowerCase();
  const days = daysUntil(task.dueDate);
  const kind = taskKind(task);
  if (/(optional|recommended only|extra credit)/.test(title)) return 'drop';
  if (/(unclear|question|ask professor|blocked|need help)/.test(title)) return 'ask';
  if (examDays !== null && examDays !== undefined && examDays <= 14 && ['outline','practice'].includes(kind)) return 'must';
  if (/(memo|brief|paper|presentation|project|exam)/.test(title) && days <= 7) return 'must';
  if (days <= 0 || (days <= 2 && kind !== 'reading')) return 'must';
  if (kind === 'reading' && days <= 3 && estimate(task) > 75) return 'skim';
  if (days <= 3) return 'must';
  return 'defer';
}

export default function RecoveryPage() {
  const { tasks, loading, refresh } = useTasks();
  const { courses } = useCourses();
  const { currentTerm, activeSemester } = useSemester();
  const { workspaces, updateWorkspace } = useCourseWorkspaces();
  const [availableMinutes, setAvailableMinutes] = useState(180);
  const [workingId, setWorkingId] = useState('');
  const activeCourses = useMemo(() => activeSemester ? courses.filter(course => course.semester === activeSemester.season && course.year === activeSemester.year) : courses, [courses, activeSemester]);
  const courseByName = new Map(activeCourses.map(course => [course.title.toLowerCase(), course]));
  const examByCourse = new Map(activeCourses.map(course => [course.title.toLowerCase(), examDaysRemaining(workspaces[course.id]?.examDate)]));
  const open = useMemo(() => tasks.filter(task => task.status !== 'done' && (!currentTerm || task.term === currentTerm)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [tasks, currentTerm]);
  const grouped = useMemo(() => {
    const result: Record<Category, Task[]> = { must: [], skim: [], ask: [], defer: [], drop: [] };
    for (const task of open) result[classify(task, examByCourse.get((task.course || '').toLowerCase()))].push(task);
    return result;
  }, [open, workspaces, activeCourses]);
  const plan = useMemo(() => {
    const candidates = [...grouped.must, ...grouped.skim];
    const selected: Array<{ task: Task; mode: 'complete' | 'skim'; minutes: number }> = [];
    let remaining = availableMinutes;
    for (const task of candidates) {
      if (remaining < 15) break;
      const mode = classify(task, examByCourse.get((task.course || '').toLowerCase())) === 'skim' ? 'skim' : 'complete';
      const needed = mode === 'skim' ? Math.max(20, Math.round(estimate(task) * 0.45)) : estimate(task);
      const minutes = Math.min(remaining, needed);
      selected.push({ task, mode, minutes });
      remaining -= minutes;
    }
    return { selected, remaining };
  }, [grouped, availableMinutes, workspaces]);

  async function move(task: Task, days: number) {
    setWorkingId(task.id); const due = new Date(task.dueDate); due.setDate(due.getDate() + days);
    try { await tasksClient.update(task.id, { dueDate: due.toISOString() }, { silent: true }); await refresh(); } finally { setWorkingId(''); }
  }
  async function complete(task: Task, skim = false) {
    setWorkingId(task.id);
    try { await tasksClient.update(task.id, { status: 'done', completedAt: new Date().toISOString(), tags: skim ? Array.from(new Set([...(task.tags || []), 'skimmed'])) : task.tags }, { silent: true }); await refresh(); } finally { setWorkingId(''); }
  }
  async function ask(task: Task) {
    const course = courseByName.get((task.course || '').toLowerCase());
    if (!course) return;
    const question: CourseQuestion = { id: `question:${course.id}:${Date.now()}`, text: `How should I handle: ${task.title}?`, source: 'other', status: 'open', officeHours: true, createdAt: new Date().toISOString() };
    await updateWorkspace(course.id, workspace => ({ ...workspace, questions: [...(workspace.questions || []), question] }));
    await tasksClient.update(task.id, { tags: Array.from(new Set([...(task.tags || []), 'needs-answer'])) }, { silent: true });
    await refresh();
  }

  const labels: Record<Category, string> = { must: 'Must complete', skim: 'Skim strategically', ask: 'Ask professor or classmate', defer: 'Can defer', drop: 'Can drop' };
  const tones: Record<Category, string> = { must: 'text-rose-300 bg-rose-500/10', skim: 'text-amber-300 bg-amber-500/10', ask: 'text-violet-300 bg-violet-500/10', defer: 'text-sky-300 bg-sky-500/10', drop: 'text-slate-300 bg-slate-700/40' };

  return <main className="space-y-6">
    <section className="rounded-2xl border border-rose-500/30 bg-gradient-to-br from-rose-950/40 to-slate-950 p-6"><p className="text-sm font-medium text-rose-300">Recovery mode</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Get back under control using deadlines, exams, and actual workload</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Major graded work and near-term exam preparation are protected. Long readings can be reduced, unclear work can become an office-hours question, and genuinely optional work can be dropped.</p><div className="mt-4 flex items-center gap-3"><label className="text-sm text-slate-300">Time available today</label><select value={availableMinutes} onChange={event => setAvailableMinutes(Number(event.target.value))} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100">{[60,90,120,180,240,360].map(value => <option key={value} value={value}>{value / 60} hour{value === 60 ? '' : 's'}</option>)}</select></div></section>
    {loading ? <div className="rounded-xl border border-slate-700 p-6 text-slate-400">Building recovery plan…</div> : null}
    {!loading ? <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5"><div className="flex items-end justify-between"><div><h2 className="font-semibold text-slate-100">Today’s realistic plan</h2><p className="text-sm text-slate-400">Complete these in order. Skim items are intentionally reduced.</p></div><span className="text-sm text-emerald-300">{availableMinutes - plan.remaining} of {availableMinutes} minutes planned</span></div><div className="mt-4 space-y-2">{plan.selected.map(({ task, mode, minutes }, index) => <div key={task.id} className="flex items-start gap-3 rounded-lg bg-slate-950/45 p-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-sm font-semibold text-slate-950">{index + 1}</span><div className="flex-1"><p className="text-sm font-medium text-slate-200">{task.title}</p><p className="mt-1 text-xs text-slate-500">{mode === 'skim' ? 'Rules, holdings, and professor emphasis only' : 'Complete'} · {minutes} minutes</p></div><Link href={`/work?task=${task.id}`} className="text-xs text-emerald-300">Start</Link></div>)}{!plan.selected.length ? <p className="text-sm text-slate-500">Nothing urgent is currently assigned.</p> : null}</div></section> : null}
    <div className="grid gap-6 xl:grid-cols-2">{(Object.keys(grouped) as Category[]).map(category => <section key={category} className="space-y-3"><div><h2 className="font-semibold text-slate-100">{labels[category]}</h2><p className="text-sm text-slate-500">{grouped[category].length} task{grouped[category].length === 1 ? '' : 's'}</p></div>{grouped[category].map(task => { const examDays = examByCourse.get((task.course || '').toLowerCase()); return <article key={task.id} className="rounded-xl border border-slate-700 bg-slate-950/40 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex gap-2"><span className={`rounded-full px-2 py-1 text-xs ${tones[category]}`}>{labels[category]}</span>{task.course ? <span className="text-xs text-slate-500">{task.course}</span> : null}</div><h3 className="mt-2 text-sm font-semibold text-slate-100">{task.title}</h3><p className="mt-1 text-xs text-slate-500">{recoveryReason(task, examDays)} · about {estimate(task)} minutes</p></div><div className="flex gap-2">{category === 'ask' ? <button onClick={() => ask(task)} className="rounded-lg border border-violet-500/40 px-2.5 py-1.5 text-xs text-violet-300">Add question</button> : <button disabled={workingId === task.id} onClick={() => move(task, category === 'defer' ? 3 : 1)} className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200">Move</button>}<button disabled={workingId === task.id} onClick={() => complete(task, category === 'skim')} className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950">{category === 'skim' ? 'Skimmed' : 'Done'}</button></div></div></article>; })}{!grouped[category].length ? <div className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">Nothing in this category.</div> : null}</section>)}</div>
  </main>;
}
