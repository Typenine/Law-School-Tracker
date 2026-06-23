import { apiFetch } from './apiClient';
import type { Task } from './types';
import { normalizeTask, syllabusFingerprintFromTags } from './taskMetadata';

export async function fetchTasksForClient(): Promise<Task[]> {
  const data = await apiFetch<{ tasks: Task[] }>('/api/tasks');
  return (data.tasks || []).map(normalizeTask);
}

export async function resolveCourseIdForClient(course?: string | null) {
  if (!course) return null;
  try {
    const data = await apiFetch<{ courses: Array<{ id: string; title: string }> }>('/api/courses');
    const normalized = course.trim().toLowerCase();
    const matches = (data.courses || []).filter(item => item.title.trim().toLowerCase() === normalized);
    return matches.length === 1 ? matches[0].id : null;
  } catch {
    return null;
  }
}

export function assignmentIdentity(tags?: string[] | null) {
  const parent = (tags || []).find(tag => tag.startsWith('assignment-parent:'));
  const milestone = (tags || []).find(tag => ['instructions','research','outline','draft','revision','citations','practice','submit'].includes(tag));
  return parent && milestone ? `${parent}|${milestone}` : null;
}

export function findGeneratedTask(tasks: Task[], tags: string[] | null | undefined, courseId?: string | null, course?: string | null) {
  const assignmentKey = assignmentIdentity(tags);
  const fingerprint = syllabusFingerprintFromTags(tags);
  return tasks.find(task => {
    if (assignmentKey && assignmentIdentity(task.tags) === assignmentKey) return true;
    if (!fingerprint || syllabusFingerprintFromTags(task.tags) !== fingerprint) return false;
    return courseId ? task.courseId === courseId : (task.course || '').trim().toLowerCase() === (course || '').trim().toLowerCase();
  }) || null;
}
