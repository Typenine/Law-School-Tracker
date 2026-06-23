"use client";

import { useCallback, useEffect, useState } from 'react';
import type { Course } from '@/lib/types';
import { apiFetch } from '@/lib/apiClient';
import { onCoursesChanged } from '@/lib/coursesBus';

export function useCourses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ courses: Course[] }>('/api/courses');
      setCourses(Array.isArray(data?.courses) ? data.courses : []);
      setError(null);
    } catch (cause: any) {
      setError(cause?.message || 'Failed to load courses');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const off = onCoursesChanged(() => { void refresh(); });
    const genericRefresh = () => { void refresh(); };
    window.addEventListener('tracker-data-changed', genericRefresh);
    return () => {
      off();
      window.removeEventListener('tracker-data-changed', genericRefresh);
    };
  }, [refresh]);

  return { courses, loading, error, refresh };
}
