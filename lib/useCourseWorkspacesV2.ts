"use client";

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './apiClient';
import type { ClassCapture, CourseQuestion, CourseWorkspace, CourseWorkspaceMap } from './courseWorkspace';

export type ClientWorkspace = CourseWorkspace & { _revision?: number; _updatedAt?: string };

function addLegacyCapture(courseId: string, current: ClientWorkspace, next: ClientWorkspace): ClientWorkspace {
  const captureCount = current.classCaptures?.length || 0;
  const nextCount = next.classCaptures?.length || 0;
  if (!next.lastClassCaptureAt || next.lastClassCaptureAt === current.lastClassCaptureAt || nextCount > captureCount) return next;

  const createdAt = next.lastClassCaptureAt;
  const classDate = createdAt.slice(0, 10);
  const capture: ClassCapture = {
    id: `capture:${courseId}:${Date.now()}`,
    classDate,
    topic: next.lastClassTopic || undefined,
    question: next.lastClassQuestion || undefined,
    outlineFlag: Boolean(next.lastClassTopic),
    createdAt,
  };
  const captures = [...(next.classCaptures || []), capture];
  let questions = next.questions || [];
  if (next.lastClassQuestion?.trim()) {
    const text = next.lastClassQuestion.trim();
    const duplicate = questions.some(question => question.text.trim().toLowerCase() === text.toLowerCase());
    if (!duplicate) {
      const question: CourseQuestion = {
        id: `question:${courseId}:${Date.now()}`,
        text,
        source: 'class',
        status: 'open',
        officeHours: true,
        createdAt,
      };
      questions = [...questions, question];
    }
  }
  return { ...next, classCaptures: captures, questions };
}

export function useCourseWorkspaces() {
  const [workspaces, setWorkspaces] = useState<CourseWorkspaceMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ settings: Record<string, any> }>('/api/settings?keys=courseWorkspacesV1');
      setWorkspaces((data.settings?.courseWorkspacesV1 || {}) as CourseWorkspaceMap);
      setError(null);
    } catch (cause: any) {
      setError(cause?.message || 'Unable to load course workspaces.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveOne = useCallback(async (courseId: string, current: ClientWorkspace, next: ClientWorkspace) => {
    let candidate = addLegacyCapture(courseId, current, next);
    let expectedRevision = Number(current._revision || 0);
    let response: Response;

    for (let attempt = 0; attempt < 2; attempt++) {
      response = await fetch('/api/course-workspace', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, workspace: candidate, expectedRevision }),
      });
      const data = await response.json();
      if (response.status !== 409) {
        if (!response.ok) throw new Error(data?.error || 'Unable to update course workspace.');
        return data.workspace as ClientWorkspace;
      }
      const latest = (data.workspace || {}) as ClientWorkspace;
      expectedRevision = Number(data.revision || 0);
      candidate = addLegacyCapture(courseId, latest, { ...latest, ...candidate, _revision: expectedRevision });
    }
    throw new Error('Course workspace changed in another tab. Reload and try again.');
  }, []);

  const updateWorkspace = useCallback(async (courseId: string, updater: CourseWorkspace | ((current: CourseWorkspace) => CourseWorkspace)) => {
    const current = (workspaces[courseId] || {}) as ClientWorkspace;
    const requested = typeof updater === 'function' ? updater(current) : updater;
    const saved = await saveOne(courseId, current, requested as ClientWorkspace);
    setWorkspaces(previous => ({ ...previous, [courseId]: saved }));
    return saved;
  }, [workspaces, saveOne]);

  const saveMap = useCallback(async (next: CourseWorkspaceMap) => {
    const saved: CourseWorkspaceMap = { ...workspaces };
    for (const [courseId, workspace] of Object.entries(next)) {
      saved[courseId] = await saveOne(courseId, (workspaces[courseId] || {}) as ClientWorkspace, workspace as ClientWorkspace);
    }
    setWorkspaces(saved);
  }, [workspaces, saveOne]);

  return { workspaces, loading, error, refresh, saveMap, updateWorkspace };
}
