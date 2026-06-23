"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { courseBlocks, ymd } from '@/lib/courseWorkspace';
import { useCourses } from '@/lib/useCourses';
import { useCourseWorkspaces } from '@/lib/useCourseWorkspaces';
import { useSemester } from '@/lib/useSemester';

function currentWeekStart() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  date.setHours(12, 0, 0, 0);
  return ymd(date);
}

export default function ReviewWorkflowPanel() {
  const pathname = usePathname();
  const { courses } = useCourses();
  const { activeSemester } = useSemester();
  const { workspaces, loading } = useCourseWorkspaces();
  const weekStart = currentWeekStart();

  const summary = useMemo(() => {
    const active = activeSemester ? courses.filter(course => course.semester === activeSemester.season && course.year === activeSemester.year) : courses;
    let openQuestions = 0;
    let officeHours = 0;
    let draftOutlines = 0;
    let missingCaptures = 0;
    for (const course of active) {
      const workspace = workspaces[course.id] || {};
      const questions = (workspace.questions || []).filter(question => question.status === 'open');
      openQuestions += questions.length;
      officeHours += questions.filter(question => question.officeHours).length;
      draftOutlines += (workspace.outlineProposals || []).filter(proposal => proposal.weekStart === weekStart && proposal.status === 'draft').length;
      const hadMeeting = courseBlocks(course).some(block => {
        for (let offset = 0; offset < 7; offset++) {
          const day = new Date(`${weekStart}T12:00:00`);
          day.setDate(day.getDate() + offset);
          if (day <= new Date() && block.days.includes(day.getDay())) return true;
        }
        return false;
      });
      const captured = (workspace.classCaptures || []).some(capture => capture.classDate >= weekStart);
      if (hadMeeting && !captured) missingCaptures++;
    }
    return { openQuestions, officeHours, draftOutlines, missingCaptures };
  }, [courses, activeSemester, workspaces, weekStart]);

  if (pathname !== '/review' || loading) return null;

  return <section className="mb-6 rounded-xl border border-violet-500/30 bg-violet-500/5 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-violet-300">Academic workflow review</p><h2 className="mt-1 font-semibold text-slate-100">Close the loops created during class</h2><p className="mt-1 text-sm text-slate-400">Resolve questions, capture missing classes, and approve outline drafts before planning the next week.</p></div><div className="flex gap-2"><Link href="/questions" className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-300">Questions</Link><Link href="/outline-updates" className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white">Outline drafts</Link></div></div><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xl font-semibold text-sky-300">{summary.openQuestions}</p><p className="text-xs text-slate-500">Open questions</p></div><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xl font-semibold text-amber-300">{summary.officeHours}</p><p className="text-xs text-slate-500">Office-hours items</p></div><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xl font-semibold text-violet-300">{summary.draftOutlines}</p><p className="text-xs text-slate-500">Outline drafts</p></div><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xl font-semibold text-rose-300">{summary.missingCaptures}</p><p className="text-xs text-slate-500">Courses missing capture</p></div></div></section>;
}
