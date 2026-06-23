import { randomUUID } from 'crypto';
import type { Course, StudySession, Task } from './types';
import { courseIdFromTags, mergeTaskTags } from './taskMetadata';
import {
  createCourse,
  createSession,
  createTask,
  deleteCourse,
  deleteTask,
  getSettings,
  listCourses,
  listScheduleBlocks,
  listSessions,
  listTasks,
  patchSettings,
  replaceAllScheduleBlocks,
  resetAllSessions,
  updateTask,
} from './storage';
import { COURSE_WORKSPACES_KEY } from './courseWorkspace';
import { ACTIVE_WORK_SESSIONS_KEY } from './activeWorkSessionStore';

export interface FullTrackerBackup {
  format: 'law-school-tracker-backup';
  version: 1;
  exportedAt: string;
  tasks: Task[];
  courses: Course[];
  sessions: StudySession[];
  scheduleBlocks: Awaited<ReturnType<typeof listScheduleBlocks>>;
  settings: Record<string, any>;
}

export async function exportFullBackup(): Promise<FullTrackerBackup> {
  const [tasks, courses, sessions, scheduleBlocks, settings] = await Promise.all([
    listTasks(), listCourses(), listSessions(), listScheduleBlocks(), getSettings(),
  ]);
  return {
    format: 'law-school-tracker-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    courses,
    sessions,
    scheduleBlocks,
    settings,
  };
}

function validBackup(value: any): value is FullTrackerBackup {
  return value?.format === 'law-school-tracker-backup' && value?.version === 1 && Array.isArray(value.tasks) && Array.isArray(value.courses) && Array.isArray(value.sessions) && value.settings && typeof value.settings === 'object';
}

function remapCourseSettings(settings: Record<string, any>, courseIds: Map<string, string>, taskIds: Map<string, string>) {
  const next = structuredClone(settings);
  const workspaces = next[COURSE_WORKSPACES_KEY];
  if (workspaces && typeof workspaces === 'object') {
    const remapped: Record<string, any> = {};
    for (const [oldId, workspace] of Object.entries(workspaces)) remapped[courseIds.get(oldId) || oldId] = workspace;
    next[COURSE_WORKSPACES_KEY] = remapped;
  }
  const activeSessions = next[ACTIVE_WORK_SESSIONS_KEY];
  if (activeSessions && typeof activeSessions === 'object') {
    const remapped: Record<string, any> = {};
    for (const [oldId, session] of Object.entries(activeSessions)) {
      const taskId = taskIds.get(oldId) || oldId;
      remapped[taskId] = { ...(session as any), taskId };
    }
    next[ACTIVE_WORK_SESSIONS_KEY] = remapped;
  }
  if (Array.isArray(next.notificationsV1)) {
    next.notificationsV1 = next.notificationsV1.map((notification: any) => {
      const match = typeof notification.href === 'string' ? notification.href.match(/task=([^&]+)/) : null;
      if (!match) return notification;
      const oldTaskId = decodeURIComponent(match[1]);
      const newTaskId = taskIds.get(oldTaskId);
      return newTaskId ? { ...notification, href: notification.href.replace(match[1], encodeURIComponent(newTaskId)) } : notification;
    });
  }
  return next;
}

export async function restoreFullBackup(value: unknown) {
  if (!validBackup(value)) throw new Error('This is not a valid Law School Tracker backup.');
  const backup = value;
  const [existingTasks, existingCourses] = await Promise.all([listTasks(), listCourses()]);
  await resetAllSessions();
  for (const task of existingTasks) await deleteTask(task.id);
  for (const course of existingCourses) await deleteCourse(course.id);
  await replaceAllScheduleBlocks([]);

  const courseIds = new Map<string, string>();
  for (const course of backup.courses) {
    const created = await createCourse({
      code: course.code,
      title: course.title,
      instructor: course.instructor,
      instructorEmail: course.instructorEmail,
      room: course.room,
      location: course.location,
      color: course.color,
      meetingDays: course.meetingDays,
      meetingStart: course.meetingStart,
      meetingEnd: course.meetingEnd,
      meetingBlocks: course.meetingBlocks,
      startDate: course.startDate,
      endDate: course.endDate,
      semester: course.semester,
      year: course.year,
    });
    courseIds.set(course.id, created.id);
  }

  const taskIds = new Map<string, string>();
  const createdTasks = new Map<string, Task>();
  for (const task of backup.tasks) {
    const oldCourseId = courseIdFromTags(task.tags);
    const tags = mergeTaskTags(task.tags, task.tags, { courseId: oldCourseId ? courseIds.get(oldCourseId) || null : undefined, lifecycle: task.lifecycle });
    const created = await createTask({
      title: task.title,
      course: task.course,
      dueDate: task.dueDate,
      status: task.status,
      startTime: task.startTime,
      endTime: task.endTime,
      estimatedMinutes: task.estimatedMinutes,
      estimateOrigin: task.estimateOrigin,
      priority: task.priority,
      notes: task.notes,
      attachments: task.attachments,
      dependsOn: null,
      tags,
      term: task.term,
      pagesRead: task.pagesRead,
      activity: task.activity,
    });
    taskIds.set(task.id, created.id);
    createdTasks.set(task.id, created);
  }

  for (const task of backup.tasks) {
    const newId = taskIds.get(task.id);
    if (!newId) continue;
    const dependsOn = (task.dependsOn || []).map(id => taskIds.get(id)).filter(Boolean) as string[];
    await updateTask(newId, {
      dependsOn: dependsOn.length ? dependsOn : null,
      actualMinutes: task.actualMinutes,
      completedAt: task.completedAt,
      focus: task.focus,
    });
  }

  for (const session of backup.sessions) {
    await createSession({
      taskId: session.taskId ? taskIds.get(session.taskId) || null : null,
      when: session.when,
      minutes: session.minutes,
      focus: session.focus,
      notes: session.notes,
      pagesRead: session.pagesRead,
      outlinePages: session.outlinePages,
      practiceQs: session.practiceQs,
      activity: session.activity,
    });
  }

  await replaceAllScheduleBlocks((backup.scheduleBlocks || []).map(block => ({
    ...block,
    id: /^[0-9a-f-]{36}$/i.test(block.id) ? block.id : randomUUID(),
    taskId: block.taskId ? taskIds.get(block.taskId) || '' : '',
  })));

  const currentSettings = await getSettings();
  const cleared = Object.fromEntries(Object.keys(currentSettings).map(key => [key, null]));
  await patchSettings({ ...cleared, ...remapCourseSettings(backup.settings, courseIds, taskIds) });

  return {
    coursesRestored: backup.courses.length,
    tasksRestored: backup.tasks.length,
    sessionsRestored: backup.sessions.length,
    plannerBlocksRestored: backup.scheduleBlocks?.length || 0,
  };
}
