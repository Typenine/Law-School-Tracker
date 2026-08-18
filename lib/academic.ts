import type { Course, NewTaskInput, SemesterInfo, UpdateTaskInput } from './types';

export type AcademicCourse = Course & {
  semesterId: string | null;
  semesterName: string | null;
};

export function derivedSemesterId(season?: string | null, year?: number | null): string | null {
  if (!season || !year) return null;
  return `${season.toLowerCase()}-${year}`;
}

export function courseMatchesSemester(course: Course, semester: Pick<SemesterInfo, 'season' | 'year' | 'startDate' | 'endDate'>): boolean {
  if (course.semester && course.year) {
    return course.semester === semester.season && Number(course.year) === Number(semester.year);
  }
  const start = course.startDate?.slice(0, 10) || '';
  const end = course.endDate?.slice(0, 10) || start;
  return Boolean(start && end && start <= semester.endDate.slice(0, 10) && end >= semester.startDate.slice(0, 10));
}

export function semesterIdForCourse(course: Course | null | undefined, semesters: SemesterInfo[]): string | null {
  if (!course) return null;
  const exact = semesters.find(semester => courseMatchesSemester(course, semester));
  if (exact) return exact.id;
  return derivedSemesterId(course.semester, course.year);
}

export function semesterNameForCourse(course: Course | null | undefined, semesters: SemesterInfo[]): string | null {
  if (!course) return null;
  const exact = semesters.find(semester => courseMatchesSemester(course, semester));
  if (exact) return exact.name;
  return course.semester && course.year ? `${course.semester} ${course.year}` : null;
}

export function attachSemesterIds(courses: Course[], semesters: SemesterInfo[]): AcademicCourse[] {
  return courses.map(course => ({
    ...course,
    semesterId: semesterIdForCourse(course, semesters),
    semesterName: semesterNameForCourse(course, semesters),
  }));
}

function syntheticDates(season: string, year: number): { startDate: string; endDate: string } {
  if (season === 'Spring') return { startDate: `${year}-01-01`, endDate: `${year}-05-31` };
  if (season === 'Summer') return { startDate: `${year}-06-01`, endDate: `${year}-08-14` };
  if (season === 'Fall') return { startDate: `${year}-08-15`, endDate: `${year}-12-31` };
  return { startDate: `${year}-12-01`, endDate: `${year}-12-31` };
}

export function buildSemesterOptions(
  semesters: SemesterInfo[],
  courses: Course[],
  currentTerm?: {
    id: string;
    name: string;
    season: string;
    year: number;
    startDate: string;
    endDate: string;
    derived?: boolean;
  } | null,
): SemesterInfo[] {
  const byId = new Map<string, SemesterInfo>();
  for (const semester of semesters) byId.set(semester.id, { ...semester });

  for (const course of courses) {
    if (!course.semester || !course.year) continue;
    const id = semesterIdForCourse(course, semesters) || derivedSemesterId(course.semester, course.year);
    if (!id || byId.has(id)) continue;
    const dates = syntheticDates(course.semester, course.year);
    byId.set(id, {
      id,
      name: `${course.semester} ${course.year}`,
      season: course.semester,
      year: course.year,
      startDate: course.startDate?.slice(0, 10) || dates.startDate,
      endDate: course.endDate?.slice(0, 10) || dates.endDate,
      isActive: currentTerm?.id === id,
      createdAt: '',
    });
  }

  if (currentTerm && !byId.has(currentTerm.id)) {
    byId.set(currentTerm.id, {
      id: currentTerm.id,
      name: currentTerm.name,
      season: currentTerm.season as SemesterInfo['season'],
      year: currentTerm.year,
      startDate: currentTerm.startDate,
      endDate: currentTerm.endDate,
      isActive: true,
      createdAt: '',
    });
  }

  return Array.from(byId.values())
    .map(semester => ({ ...semester, isActive: semester.id === currentTerm?.id }))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export function coursesForSemester(courses: AcademicCourse[], semesterId: string | null | undefined): AcademicCourse[] {
  if (!semesterId) return [];
  return courses.filter(course => course.semesterId === semesterId);
}

export function resolveCourseReference(
  courseId: string | null | undefined,
  courseLabel: string | null | undefined,
  courses: Course[],
): Course | null {
  if (courseId) {
    return courses.find(course => String(course.id) === String(courseId)) || null;
  }
  const key = (courseLabel || '').trim().toLowerCase();
  if (!key) return null;
  return courses.find(course =>
    (course.title || '').trim().toLowerCase() === key
    || (course.code || '').trim().toLowerCase() === key
  ) || null;
}

export function effectiveTaskSemesterId(
  task: { term?: string | null; courseId?: string | null; course?: string | null },
  courses: Course[],
  semesters: SemesterInfo[],
): string | null {
  if (task.term) return task.term;
  const course = resolveCourseReference(task.courseId, task.course, courses);
  return semesterIdForCourse(course, semesters);
}

export function normalizeAcademicTaskInput(
  input: NewTaskInput,
  courses: Course[],
  semesters: SemesterInfo[],
  defaultSemesterId: string | null,
): NewTaskInput {
  const course = resolveCourseReference(input.courseId, input.course, courses);
  if (!course) {
    return {
      ...input,
      courseId: input.courseId ?? null,
      course: input.course ?? null,
      term: input.term ?? defaultSemesterId ?? null,
    };
  }
  return {
    ...input,
    courseId: course.id,
    course: course.title,
    term: semesterIdForCourse(course, semesters) ?? input.term ?? defaultSemesterId ?? null,
  };
}

export function normalizeAcademicTaskPatch(
  input: UpdateTaskInput,
  courses: Course[],
  semesters: SemesterInfo[],
): UpdateTaskInput {
  if (input.courseId === undefined && input.course === undefined) return { ...input };

  if (input.courseId === null && (input.course === undefined || input.course === null)) {
    return { ...input, courseId: null, course: null };
  }

  const course = resolveCourseReference(input.courseId, input.course, courses);
  if (!course) {
    return {
      ...input,
      courseId: input.courseId === undefined ? null : input.courseId,
      course: input.course ?? null,
    };
  }

  return {
    ...input,
    courseId: course.id,
    course: course.title,
    term: semesterIdForCourse(course, semesters) ?? input.term ?? null,
  };
}
