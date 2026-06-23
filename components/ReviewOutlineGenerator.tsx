"use client";

import { useEffect, useMemo, useRef } from 'react';
import { buildOutlineProposal } from '@/lib/outlineWorkflow';
import { isActiveTask, taskMatchesCourse } from '@/lib/taskMetadata';
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

export default function ReviewOutlineGenerator() {
  const { courses } = useCourses();
  const { tasks } = useTasks();
  const { activeSemester, currentTerm } = useSemester();
  const { workspaces, updateWorkspace, loading } = useCourseWorkspaces();
  const started = useRef(false);
  const currentWeek = weekStart();
  const activeCourses = useMemo(() => activeSemester ? courses.filter(course => course.semester === activeSemester.season && course.year === activeSemester.year) : courses, [courses, activeSemester]);

  useEffect(() => {
    if (loading || started.current || !activeCourses.length) return;
    started.current = true;
    void (async () => {
      for (const course of activeCourses) {
        const workspace = workspaces[course.id] || {};
        if ((workspace.outlineProposals || []).some(proposal => proposal.weekStart === currentWeek)) continue;
        const completed = tasks.filter(task => isActiveTask(task) && task.status === 'done' && (!currentTerm || task.term === currentTerm) && taskMatchesCourse(task, course));
        const proposal = buildOutlineProposal(course.title, workspace.classCaptures || [], workspace.questions || [], completed, workspace.syllabusAnalysis);
        if (proposal) await updateWorkspace(course.id, current => ({ ...current, outlineProposals: [...(current.outlineProposals || []), proposal] }));
      }
    })();
  }, [loading, activeCourses, workspaces, tasks, currentTerm, currentWeek, updateWorkspace]);

  return null;
}
