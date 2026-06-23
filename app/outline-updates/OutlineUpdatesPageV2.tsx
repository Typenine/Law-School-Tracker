"use client";

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildOutlineProposal } from '@/lib/outlineWorkflow';
import type { OutlineProposal } from '@/lib/courseWorkspace';
import { safeUrl } from '@/lib/courseWorkspace';
import { isActiveTask, taskMatchesCourse } from '@/lib/taskMetadata';
import { tasksClient } from '@/lib/tasksClient';
import { useCourses } from '@/lib/useCourses';
import { useCourseWorkspaces } from '@/lib/useCourseWorkspaces';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';

function weekStart() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  date.setHours(12, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

export default function OutlineUpdatesPageV2() {
  const { courses } = useCourses();
  const { tasks, refresh } = useTasks();
  const { activeSemester, currentTerm } = useSemester();
  const { workspaces, updateWorkspace, loading } = useCourseWorkspaces();
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const generated = useRef(false);
  const currentWeek = weekStart();
  const activeCourses = useMemo(() => activeSemester ? courses.filter(course => course.semester === activeSemester.season && course.year === activeSemester.year) : courses, [courses, activeSemester]);

  useEffect(() => {
    if (loading || generated.current || !activeCourses.length) return;
    generated.current = true;
    void (async () => {
      for (const course of activeCourses) {
        const workspace = workspaces[course.id] || {};
        const exists = (workspace.outlineProposals || []).some(proposal => proposal.weekStart === currentWeek);
        if (exists) continue;
        const completed = tasks.filter(task => isActiveTask(task) && task.status === 'done' && (!currentTerm || task.term === currentTerm) && taskMatchesCourse(task, course));
        const proposal = buildOutlineProposal(course.title, workspace.classCaptures || [], workspace.questions || [], completed, workspace.syllabusAnalysis);
        if (proposal) await updateWorkspace(course.id, current => ({ ...current, outlineProposals: [...(current.outlineProposals || []), proposal] }));
      }
    })();
  }, [loading, activeCourses, workspaces, tasks, currentTerm, currentWeek, updateWorkspace]);

  const rows = useMemo(() => activeCourses.map(course => {
    const workspace = workspaces[course.id] || {};
    const proposal = [...(workspace.outlineProposals || [])].filter(item => item.weekStart === currentWeek).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
    return { course, workspace, proposal };
  }), [activeCourses, workspaces, currentWeek]);

  async function updateProposal(courseId: string, proposalId: string, patch: Partial<OutlineProposal>) {
    await updateWorkspace(courseId, workspace => ({ ...workspace, outlineProposals: (workspace.outlineProposals || []).map(proposal => proposal.id === proposalId ? { ...proposal, ...patch } : proposal) }));
  }

  async function approve(courseId: string, courseTitle: string, proposal: OutlineProposal) {
    setWorking(proposal.id);
    try {
      const due = new Date(); due.setDate(due.getDate() + 2); due.setHours(20, 0, 0, 0);
      await tasksClient.create({ title: `Apply approved weekly outline update: ${courseTitle}`, course: courseTitle, courseId, dueDate: due.toISOString(), status: 'todo', term: currentTerm || null, activity: 'outline', notes: proposal.content, tags: ['outline-proposal', proposal.weekStart] }, { silent: true });
      await updateProposal(courseId, proposal.id, { status: 'approved', approvedAt: new Date().toISOString() });
      setMessage(`${courseTitle} outline draft approved and converted into an actionable update.`);
      await refresh();
    } finally { setWorking(''); }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setMessage('Outline draft copied.');
  }

  return <main className="space-y-6">
    <section className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-950/30 to-slate-950 p-6"><p className="text-sm font-medium text-violet-300">Weekly outline drafting</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Turn the week into reviewable outline additions</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Drafts use only this week’s captures, completed work, syllabus topics, and newly raised questions. Nothing changes an external outline until you approve it.</p></section>
    {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}
    <section className="space-y-5">{rows.map(({ course, workspace, proposal }) => <article key={course.id} className="rounded-xl border border-slate-700 bg-slate-900/45 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-lg font-semibold text-slate-100">{course.title}</h2><p className="mt-1 text-sm text-slate-500">Week of {currentWeek} · {(workspace.classCaptures || []).filter(capture => capture.classDate >= currentWeek).length} class captures · {(workspace.questions || []).filter(question => question.status === 'open').length} open questions</p></div>{proposal ? <span className={`rounded-full px-2.5 py-1 text-xs ${proposal.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300' : proposal.status === 'dismissed' ? 'bg-slate-700 text-slate-400' : 'bg-violet-500/15 text-violet-300'}`}>{proposal.status}</span> : null}</div>
      {proposal ? <div className="mt-4"><input value={proposal.title} onChange={event => void updateProposal(course.id, proposal.id, { title: event.target.value })} className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-medium text-slate-100" /><textarea value={proposal.content} onChange={event => void updateProposal(course.id, proposal.id, { content: event.target.value })} rows={14} className="mt-3 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-3 font-mono text-sm text-slate-200" /><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => copy(proposal.content)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Copy draft</button>{safeUrl(workspace.outlineUrl) ? <a href={safeUrl(workspace.outlineUrl)} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Open outline</a> : null}{proposal.status === 'draft' ? <><button disabled={working === proposal.id} onClick={() => approve(course.id, course.title, proposal)} className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve update</button><button onClick={() => updateProposal(course.id, proposal.id, { status: 'dismissed' })} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-400">Dismiss</button></> : null}</div></div> : <div className="mt-4 rounded-xl border border-dashed border-slate-700 p-6 text-center"><p className="text-sm text-slate-400">There is not enough captured information from this week to generate a useful draft yet.</p><Link href={`/class-capture?course=${course.id}`} className="mt-3 inline-flex text-sm text-violet-300">Add after-class capture</Link></div>}
    </article>)}{!rows.length ? <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-500">No active courses are available.</div> : null}</section>
  </main>;
}
