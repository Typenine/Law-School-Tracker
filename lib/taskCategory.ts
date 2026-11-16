import type { Task } from './types';

// Misc is a task category, not a Course row in the academic catalog.
export const MISC_TASK_COURSE_ID = '__misc_task_category__';
export const MISC_TASK_LABEL = 'Misc';

export function isMiscTask(task: Pick<Task, 'course' | 'courseId'>): boolean {
  return !task.courseId && (task.course || '').trim().toLowerCase() === MISC_TASK_LABEL.toLowerCase();
}
