'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SemesterInfo } from '@/lib/types';
import type { AcademicCourse } from '@/lib/academic';
import { coursesForSemester } from '@/lib/academic';
import { onCoursesChanged } from '@/lib/coursesBus';
import { onSemesterChanged } from '@/lib/semesterBus';
import { apiFetch } from '@/lib/apiClient';

type CatalogResponse = {
  currentSemesterId: string | null;
  semesters: SemesterInfo[];
  courses: AcademicCourse[];
};

export function useAcademicCatalog() {
  const [semesters, setSemesters] = useState<SemesterInfo[]>([]);
  const [courses, setCourses] = useState<AcademicCourse[]>([]);
  const [currentSemesterId, setCurrentSemesterId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<CatalogResponse>('/api/academic/catalog');
      setSemesters(Array.isArray(data?.semesters) ? data.semesters : []);
      setCourses(Array.isArray(data?.courses) ? data.courses : []);
      setCurrentSemesterId(data?.currentSemesterId || '');
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

  return { semesters, courses, currentSemesterId, loading, refresh };
}

type Props = {
  semesterId: string;
  courseId: string;
  onSemesterChange: (semesterId: string) => void;
  onCourseChange: (courseId: string, course: AcademicCourse | null) => void;
  storageKeyPrefix?: string;
  semesterLabel?: string;
  courseLabel?: string;
  coursePlaceholder?: string;
  compact?: boolean;
  className?: string;
};

export default function SemesterCoursePicker({
  semesterId,
  courseId,
  onSemesterChange,
  onCourseChange,
  storageKeyPrefix,
  semesterLabel = 'Semester',
  courseLabel = 'Course',
  coursePlaceholder = 'Select…',
  compact = false,
  className = '',
}: Props) {
  const { semesters, courses, currentSemesterId, loading } = useAcademicCatalog();

  const selectedCourse = useMemo(
    () => courses.find(course => String(course.id) === String(courseId)) || null,
    [courses, courseId],
  );

  const visibleCourses = useMemo(
    () => coursesForSemester(courses, semesterId),
    [courses, semesterId],
  );

  useEffect(() => {
    if (semesterId) return;
    const target = selectedCourse?.semesterId || currentSemesterId;
    if (target) onSemesterChange(target);
  }, [semesterId, selectedCourse?.semesterId, currentSemesterId, onSemesterChange]);

  useEffect(() => {
    if (!semesterId || !courseId) return;
    if (visibleCourses.some(course => String(course.id) === String(courseId))) return;
    onCourseChange('', null);
  }, [semesterId, courseId, visibleCourses, onCourseChange]);

  useEffect(() => {
    if (!storageKeyPrefix || !semesterId || courseId || !visibleCourses.length) return;
    try {
      const saved = window.localStorage.getItem(`${storageKeyPrefix}:${semesterId}`) || '';
      if (!saved) return;
      const match = visibleCourses.find(course =>
        String(course.id) === saved
        || course.title === saved
        || course.code === saved
      ) || null;
      if (match) onCourseChange(match.id, match);
    } catch {}
  }, [storageKeyPrefix, semesterId, courseId, visibleCourses, onCourseChange]);

  const inputClass = compact
    ? 'bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1.5 text-xs'
    : 'bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2';

  return (
    <div className={`flex flex-wrap gap-2 items-end ${className}`}>
      <div>
        <div className="text-xs text-slate-300/70 mb-1">{semesterLabel}</div>
        <select
          value={semesterId}
          onChange={event => {
            onSemesterChange(event.target.value);
            onCourseChange('', null);
          }}
          disabled={loading && !semesters.length}
          className={`${inputClass} min-w-[170px] disabled:opacity-50`}
        >
          {!semesters.length && <option value="">No semesters</option>}
          {semesters.map(semester => (
            <option key={semester.id} value={semester.id}>
              {semester.name}{semester.id === currentSemesterId ? ' (Current)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="text-xs text-slate-300/70 mb-1">{courseLabel}</div>
        <select
          value={courseId}
          onChange={event => {
            const nextId = event.target.value;
            const match = visibleCourses.find(course => String(course.id) === String(nextId)) || null;
            if (storageKeyPrefix && semesterId) {
              try {
                if (match) window.localStorage.setItem(`${storageKeyPrefix}:${semesterId}`, match.id);
                else window.localStorage.removeItem(`${storageKeyPrefix}:${semesterId}`);
              } catch {}
            }
            onCourseChange(nextId, match);
          }}
          disabled={!semesterId}
          className={`${inputClass} min-w-[220px] disabled:opacity-50`}
        >
          <option value="">{coursePlaceholder}</option>
          {semesterId && visibleCourses.length === 0 && <option value="" disabled>No courses in this semester</option>}
          {visibleCourses.map(course => (
            <option key={course.id} value={course.id}>{course.title || course.code}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
