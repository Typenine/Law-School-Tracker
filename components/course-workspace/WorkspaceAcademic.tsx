"use client";

import Link from 'next/link';
import type { CourseWorkspace } from '@/lib/courseWorkspace';
import type { Course } from '@/lib/types';

export default function WorkspaceAcademic({ course, workspace }: { course: Course; workspace: CourseWorkspace }) {
  const captures = workspace.classCaptures || [];
  const questions = (workspace.questions || []).filter(question => question.status === 'open');
  const drafts = (workspace.outlineProposals || []).filter(proposal => proposal.status === 'draft');
  const weakAreas = workspace.examPrep?.weakAreas || [];

  return <div className="space-y-6">
    <section className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-semibold text-slate-100">After-class workflow</h2><p className="mt-1 text-sm text-slate-400">Capture doctrine, cases, professor emphasis, questions, and outline follow-up through the same structured form used across the site.</p></div><Link href={`/class-capture?course=${course.id}`} className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white">Capture class</Link></div><div className="mt-4 grid grid-cols-3 gap-3"><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xl font-semibold text-violet-300">{captures.length}</p><p className="text-xs text-slate-500">Captures</p></div><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xl font-semibold text-sky-300">{questions.length}</p><p className="text-xs text-slate-500">Open questions</p></div><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xl font-semibold text-amber-300">{drafts.length}</p><p className="text-xs text-slate-500">Outline drafts</p></div></div><div className="mt-4 flex flex-wrap gap-2"><Link href="/questions" className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-300">Questions and office hours</Link><Link href="/outline-updates" className="rounded-lg border border-violet-500/40 px-3 py-2 text-sm text-violet-300">Outline updates</Link></div></section>
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"><div className="flex items-end justify-between gap-3"><div><h2 className="font-semibold text-slate-100">Exam preparation</h2><p className="mt-1 text-sm text-slate-400">Use the consolidated exam countdown, issue-drill, rule, analogy, and practice-result workflow.</p></div><Link href="/exam" className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950">Open Exam Mode</Link></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xl font-semibold text-amber-300">{weakAreas.length}</p><p className="text-xs text-slate-500">Weak areas</p></div><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xl font-semibold text-slate-200">{workspace.examPrep?.practiceResults?.length || 0}</p><p className="text-xs text-slate-500">Practice results</p></div></div></section>
    <Link href={`/wizard?course=${course.id}`} className="block rounded-xl border border-sky-500/30 bg-sky-500/5 p-5"><p className="font-medium text-sky-200">Import or replace syllabus</p><p className="mt-1 text-sm text-slate-400">Review extracted work, compare revisions, and approve an idempotent reconciliation.</p></Link>
  </div>;
}
