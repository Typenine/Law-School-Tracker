"use client";

import { useEffect, useState, useCallback } from 'react';
import { notifySemesterChanged } from '@/lib/semesterBus';
import { useTerm } from '@/lib/useTerm';

/**
 * Compatibility wrapper for older calendar/task surfaces.
 *
 * The canonical term now comes from /api/semesters/current via useTerm().
 * localStorage is only a fallback while that request is loading.
 */
export function useSemester() {
  const { term } = useTerm();
  const [fallbackTerm, setFallbackTerm] = useState<string>('');
  const [showAllTerms, setShowAllTerms] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { setFallbackTerm(window.localStorage.getItem('currentTerm') || ''); } catch {}
    try { setShowAllTerms(window.localStorage.getItem('tasksShowAllTerms') === 'true'); } catch {}
  }, []);

  useEffect(() => {
    if (!term?.id || typeof window === 'undefined') return;
    try { window.localStorage.setItem('currentTerm', term.id); } catch {}
    setFallbackTerm(term.id);
  }, [term?.id]);

  const updateCurrentTerm = useCallback((termId: string) => {
    // Kept for older callers. A manual value is a temporary fallback only;
    // the date-resolved term wins as soon as it is available.
    try { if (typeof window !== 'undefined') window.localStorage.setItem('currentTerm', termId || ''); } catch {}
    setFallbackTerm(termId || '');
    try { notifySemesterChanged(); } catch {}
  }, []);

  const toggleShowAll = useCallback(() => {
    setShowAllTerms(prev => {
      const next = !prev;
      try { if (typeof window !== 'undefined') window.localStorage.setItem('tasksShowAllTerms', String(next)); } catch {}
      return next;
    });
  }, []);

  return {
    currentTerm: term?.id || fallbackTerm,
    setCurrentTerm: updateCurrentTerm,
    showAllTerms,
    setShowAllTerms,
    toggleShowAll,
  };
}
