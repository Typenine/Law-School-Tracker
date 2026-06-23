"use client";

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './apiClient';
import { COURSE_WORKSPACES_KEY, CourseWorkspace, CourseWorkspaceMap } from './courseWorkspace';

export function useCourseWorkspaces() {
  const [workspaces, setWorkspaces] = useState<CourseWorkspaceMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${COURSE_WORKSPACES_KEY}`);
      setWorkspaces((data.settings?.[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap);
      setError(null);
    } catch (cause: any) {
      setError(cause?.message || 'Unable to load course workspaces.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveMap = useCallback(async (next: CourseWorkspaceMap) => {
    await apiFetch('/api/settings', { method: 'PATCH', body: { [COURSE_WORKSPACES_KEY]: next } });
    setWorkspaces(next);
  }, []);

  const updateWorkspace = useCallback(async (courseId: string, updater: CourseWorkspace | ((current: CourseWorkspace) => CourseWorkspace)) => {
    let nextMap: CourseWorkspaceMap = {};
    setWorkspaces(currentMap => {
      const current = currentMap[courseId] || {};
      const nextWorkspace = typeof updater === 'function' ? updater(current) : updater;
      nextMap = { ...currentMap, [courseId]: nextWorkspace };
      return nextMap;
    });
    if (!Object.keys(nextMap).length) {
      const data = await apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${COURSE_WORKSPACES_KEY}`);
      const currentMap = (data.settings?.[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap;
      const current = currentMap[courseId] || {};
      nextMap = { ...currentMap, [courseId]: typeof updater === 'function' ? updater(current) : updater };
    }
    await apiFetch('/api/settings', { method: 'PATCH', body: { [COURSE_WORKSPACES_KEY]: nextMap } });
    return nextMap[courseId];
  }, []);

  return { workspaces, loading, error, refresh, saveMap, updateWorkspace };
}
