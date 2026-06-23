"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SemesterInfo } from '@/lib/types';
import { onSemesterChanged, notifySemesterChanged } from '@/lib/semesterBus';
import { apiFetch } from '@/lib/apiClient';

export function useSemester() {
  const [currentTerm, setCurrentTermState] = useState<string>('');
  const [showAllTerms, setShowAllTerms] = useState<boolean>(false);
  const [semesters, setSemesters] = useState<SemesterInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ semesters: SemesterInfo[] }>('/api/semesters');
      const list = Array.isArray(data?.semesters) ? data.semesters : [];
      setSemesters(list);

      let stored = '';
      try { stored = window.localStorage.getItem('currentTerm') || ''; } catch {}
      const storedExists = list.some((semester) => semester.id === stored);
      const serverActive = list.find((semester) => semester.isActive);
      const resolved = storedExists ? stored : (serverActive?.id || '');
      setCurrentTermState(resolved);
      try {
        if (resolved) window.localStorage.setItem('currentTerm', resolved);
        else window.localStorage.removeItem('currentTerm');
      } catch {}
    } catch {
      try {
        const stored = window.localStorage.getItem('currentTerm') || '';
        setCurrentTermState(stored);
      } catch {}
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const value = window.localStorage.getItem('tasksShowAllTerms');
      setShowAllTerms(value === 'true');
    } catch {}
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = onSemesterChanged(() => { void refresh(); });
    return off;
  }, [refresh]);

  const updateCurrentTerm = useCallback((termId: string) => {
    const next = termId || '';
    try {
      if (next) window.localStorage.setItem('currentTerm', next);
      else window.localStorage.removeItem('currentTerm');
    } catch {}
    setCurrentTermState(next);
    try { notifySemesterChanged(); } catch {}
  }, []);

  const toggleShowAll = useCallback(() => {
    setShowAllTerms((previous) => {
      const next = !previous;
      try { window.localStorage.setItem('tasksShowAllTerms', String(next)); } catch {}
      return next;
    });
  }, []);

  const activeSemester = useMemo(() => {
    return semesters.find((semester) => semester.id === currentTerm)
      || semesters.find((semester) => semester.isActive)
      || null;
  }, [semesters, currentTerm]);

  return {
    currentTerm,
    setCurrentTerm: updateCurrentTerm,
    showAllTerms,
    setShowAllTerms,
    toggleShowAll,
    semesters,
    activeSemester,
    loading,
    refresh,
  };
}
