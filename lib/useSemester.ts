"use client";

import { useEffect, useState, useCallback } from 'react';
import { onSemesterChanged, notifySemesterChanged } from '@/lib/semesterBus';

export function useSemester() {
  const [currentTerm, setCurrentTerm] = useState<string>('');
  const [showAllTerms, setShowAllTerms] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const t = window.localStorage.getItem('currentTerm') || '';
      setCurrentTerm(t);
    } catch {}
    try {
      const s = window.localStorage.getItem('tasksShowAllTerms');
      setShowAllTerms(s === 'true');
    } catch {}
  }, []);

  useEffect(() => {
    const off = onSemesterChanged(() => {
      try { const t = window.localStorage.getItem('currentTerm') || ''; setCurrentTerm(t); } catch {}
    });
    return off;
  }, []);

  const updateCurrentTerm = useCallback((termId: string) => {
    try { if (typeof window !== 'undefined') window.localStorage.setItem('currentTerm', termId || ''); } catch {}
    setCurrentTerm(termId || '');
    try { notifySemesterChanged(); } catch {}
  }, []);

  const toggleShowAll = useCallback(() => {
    setShowAllTerms(prev => {
      const next = !prev;
      try { if (typeof window !== 'undefined') window.localStorage.setItem('tasksShowAllTerms', String(next)); } catch {}
      return next;
    });
  }, []);

  return { currentTerm, setCurrentTerm: updateCurrentTerm, showAllTerms, setShowAllTerms, toggleShowAll };
}
