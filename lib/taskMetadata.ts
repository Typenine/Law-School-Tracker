import type { Course, NewTaskInput, Task, TaskLifecycle, UpdateTaskInput } from './types';

const COURSE_TAG = 'course-id:';
const LIFE_TAG = 'task-lifecycle:';
const FINGERPRINT_TAG = 'syllabus-fingerprint:';
const SOURCE_TAG = 'syllabus-source:';

type MutableTaskPayload = Partial<NewTaskInput & UpdateTaskInput> & {
  courseId?: string | null;
  lifecycle?: TaskLifecycle;
};

function valueFromTag(tags: string[] | null | undefined, prefix: string) {
  const tag = (tags || []).find(item => item.startsWith(prefix));
  if (!tag) return null;
  const value = tag.slice(prefix.length);
  try { return decodeURIComponent(value); } catch { return value; }
}

export function courseIdFromTags(tags?: string[] | null) {
  return valueFromTag(tags, COURSE_TAG);
}

export function lifecycleFromTags(tags?: string[] | null): TaskLifecycle {
  const value = valueFromTag(tags, LIFE_TAG);
  return value === 'archived' || value === 'canceled' ? value : 'active';
}

export function normalizeTask(task: Task): Task {
  return { ...task, courseId: task.courseId || courseIdFromTags(task.tags), lifecycle: task.lifecycle || lifecycleFromTags(task.tags) };
}

export function isActiveTask(task: Task) {
  return lifecycleFromTags(task.tags) === 'active';
}

export function taskMatchesCourse(task: Task, course: Pick<Course, 'id' | 'title'> | string) {
  const normalized = normalizeTask(task);
  if (typeof course !== 'string' && normalized.courseId) return normalized.courseId === course.id;
  const title = typeof course === 'string' ? course : course.title;
  return (normalized.course || '').trim().toLowerCase() === title.trim().toLowerCase();
}

export function normalizeSyllabusText(value: string) {
  return value.toLowerCase().replace(/\b\d+(?:\s*[-–]\s*\d+)?\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-');
}

export function syllabusFingerprint(input: Pick<NewTaskInput, 'title' | 'activity' | 'course'> & { kind?: string }) {
  return [input.kind || input.activity || 'task', input.course || '', normalizeSyllabusText(input.title)].join('|').slice(0, 220);
}

export function syllabusFingerprintFromTags(tags?: string[] | null) {
  return valueFromTag(tags, FINGERPRINT_TAG);
}

export function syllabusSourceFromTags(tags?: string[] | null) {
  return valueFromTag(tags, SOURCE_TAG);
}

function encoded(prefix: string, value: string) {
  return `${prefix}${encodeURIComponent(value)}`;
}

export function mergeTaskTags(current: string[] | null | undefined, requested: string[] | null | undefined, metadata: { courseId?: string | null; lifecycle?: TaskLifecycle; fingerprint?: string | null } = {}) {
  const requestedTags = requested || [];
  const replacesSource = requestedTags.some(tag => tag.startsWith(SOURCE_TAG));
  const protectedTags = (current || []).filter(tag =>
    tag === 'assignment-plan-created' ||
    tag === 'syllabus-removed' ||
    tag.startsWith('assignment-parent:') ||
    (!replacesSource && tag.startsWith(SOURCE_TAG))
  );
  let tags = Array.from(new Set([...requestedTags, ...protectedTags]));
  if (metadata.courseId !== undefined) {
    tags = tags.filter(tag => !tag.startsWith(COURSE_TAG));
    if (metadata.courseId) tags.push(encoded(COURSE_TAG, metadata.courseId));
  }
  if (metadata.lifecycle !== undefined) {
    tags = tags.filter(tag => !tag.startsWith(LIFE_TAG));
    if (metadata.lifecycle !== 'active') tags.push(encoded(LIFE_TAG, metadata.lifecycle));
  }
  if (metadata.fingerprint !== undefined) {
    tags = tags.filter(tag => !tag.startsWith(FINGERPRINT_TAG));
    if (metadata.fingerprint) tags.push(encoded(FINGERPRINT_TAG, metadata.fingerprint));
  }
  if (metadata.lifecycle === 'active') tags = tags.filter(tag => tag !== 'syllabus-removed');
  return Array.from(new Set(tags));
}

export function prepareTaskPayload<T extends NewTaskInput | UpdateTaskInput>(input: T, current?: Task | null) {
  const metadata = input as MutableTaskPayload;
  const { courseId, lifecycle, ...rawRest } = metadata;
  const rest = rawRest as Partial<NewTaskInput & UpdateTaskInput>;
  const requestedTags: string[] = Array.isArray(rest.tags) ? rest.tags : [];
  const title = rest.title ?? current?.title;
  const course = rest.course !== undefined ? rest.course : current?.course;
  const activity = rest.activity !== undefined ? rest.activity : current?.activity;
  const syllabus = requestedTags.includes('syllabus-import') || (current?.tags || []).includes('syllabus-import');
  const fingerprint = syllabus && title ? syllabusFingerprint({ title, course, activity }) : undefined;
  return {
    ...rest,
    tags: mergeTaskTags(current?.tags, rest.tags, { courseId: courseId !== undefined ? courseId : current?.courseId, lifecycle: lifecycle !== undefined ? lifecycle : current?.lifecycle, fingerprint }),
    ...(lifecycle === 'archived' || lifecycle === 'canceled' ? { status: 'done', completedAt: null } : {}),
  };
}
