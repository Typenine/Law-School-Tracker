"use client";

import { useCallback, useEffect, useState } from 'react';
import type { Course } from '@/lib/types';
import type { AcademicCourse } from '@/lib/academic';
import { apiFetch } from '@/lib/apiClient';
import { onCoursesChanged } from '@/lib/coursesBus';
import { onSemesterChanged } from '@/lib/semesterBus';

type CatalogResponse = {
  currentSemesterId: string | null;
  courses: AcademicCourse[];
};

export function useCourses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [currentSemesterId, setCurrentSemesterId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<CatalogResponse>('/api/academic/catalog');
      const all = Array.isArray(data?.courses) ? data.courses : [];
      const current = data?.currentSemesterId || '';
      setAllCourses(all);
      setCurrentSemesterId(current);
      setCourses(current ? all.filter(course => course.semesterId === current) : all);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load courses');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const offCourses = onCoursesChanged(() => { void refresh(); });
    const offSemesters = onSemesterChanged(() => { void refresh(); });
    return () => { offCourses(); offSemesters(); };
  }, [refresh]);

  return { courses, allCourses, currentSemesterId, loading, error, refresh };
}
