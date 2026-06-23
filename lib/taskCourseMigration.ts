import type { Course, Task } from './types';
import { courseIdFromTags, mergeTaskTags } from './taskMetadata';
import { listCourses, listTasks, updateTask } from './storage';

function key(value?: string | null) {
  return (value || '').trim().toLowerCase();
}

function uniqueCourseByTitle(courses: Course[], title?: string | null) {
  const matches = courses.filter(course => key(course.title) === key(title));
  return matches.length === 1 ? matches[0] : null;
}

export async function backfillTaskCourseIds() {
  const [courses, tasks] = await Promise.all([listCourses(), listTasks()]);
  let updated = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const task of tasks) {
    if (courseIdFromTags(task.tags)) continue;
    if (!task.course) continue;
    const course = uniqueCourseByTitle(courses, task.course);
    if (!course) {
      const matches = courses.filter(item => key(item.title) === key(task.course));
      if (matches.length > 1) ambiguous++; else unmatched++;
      continue;
    }
    await updateTask(task.id, { tags: mergeTaskTags(task.tags, task.tags, { courseId: course.id }) });
    updated++;
  }

  return { updated, ambiguous, unmatched, total: tasks.length };
}

export async function cascadeCourseRename(course: Course, oldTitle: string) {
  if (course.title === oldTitle) return 0;
  const tasks = await listTasks();
  let updated = 0;
  for (const task of tasks) {
    const linkedId = courseIdFromTags(task.tags);
    const legacyMatch = !linkedId && key(task.course) === key(oldTitle);
    if (linkedId !== course.id && !legacyMatch) continue;
    await updateTask(task.id, {
      course: course.title,
      tags: mergeTaskTags(task.tags, task.tags, { courseId: course.id }),
    });
    updated++;
  }
  return updated;
}

export function taskCourseIdentity(task: Task) {
  return courseIdFromTags(task.tags) || null;
}
