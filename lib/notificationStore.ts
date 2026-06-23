import { isActiveTask } from './taskMetadata';
import { getSettings, listTasks, patchSettings } from './storage';

export const NOTIFICATIONS_KEY = 'notificationsV1';

export type TrackerNotificationKind = 'deadline' | 'overdue' | 'weekly-review' | 'outline-draft' | 'system';

export interface TrackerNotification {
  id: string;
  kind: TrackerNotificationKind;
  title: string;
  body: string;
  href?: string | null;
  course?: string | null;
  createdAt: string;
  readAt?: string | null;
  dismissedAt?: string | null;
  browserShownAt?: string | null;
}

function normalized(value: unknown): TrackerNotification[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string') : [];
}

export async function listNotifications(includeDismissed = false) {
  const settings = await getSettings([NOTIFICATIONS_KEY]);
  const notifications = normalized(settings[NOTIFICATIONS_KEY]);
  return notifications
    .filter(item => includeDismissed || !item.dismissedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveNotifications(notifications: TrackerNotification[]) {
  const trimmed = notifications
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 250);
  await patchSettings({ [NOTIFICATIONS_KEY]: trimmed });
}

export async function addNotifications(items: TrackerNotification[]) {
  const current = await listNotifications(true);
  const byId = new Map(current.map(item => [item.id, item]));
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  const next = Array.from(byId.values());
  await saveNotifications(next);
  return next;
}

export async function updateNotification(id: string, patch: Partial<TrackerNotification>) {
  const current = await listNotifications(true);
  const index = current.findIndex(item => item.id === id);
  if (index < 0) return null;
  current[index] = { ...current[index], ...patch };
  await saveNotifications(current);
  return current[index];
}

function deadlineId(taskId: string, dueDate: string, kind: 'deadline' | 'overdue') {
  return `${kind}:${taskId}:${dueDate}`;
}

export async function generateTaskNotifications(now = new Date()) {
  const settings = await getSettings(['remindersEnabled', 'remindersLeadHours']);
  if (!settings.remindersEnabled) return [] as TrackerNotification[];
  const leadHours = Math.max(1, Math.min(168, Number(settings.remindersLeadHours) || 24));
  const leadEnd = now.getTime() + leadHours * 60 * 60 * 1000;
  const tasks = (await listTasks()).filter(task => isActiveTask(task) && task.status !== 'done');
  const generated: TrackerNotification[] = [];

  for (const task of tasks) {
    const due = new Date(task.dueDate);
    if (Number.isNaN(due.getTime())) continue;
    if (due.getTime() < now.getTime()) {
      generated.push({
        id: deadlineId(task.id, task.dueDate, 'overdue'),
        kind: 'overdue',
        title: `Overdue: ${task.title}`,
        body: `${task.course ? `${task.course} · ` : ''}Due ${due.toLocaleString()}. Decide whether to complete, move, skim, or use Recovery Mode.`,
        href: '/recovery',
        course: task.course || null,
        createdAt: now.toISOString(),
      });
    } else if (due.getTime() <= leadEnd) {
      generated.push({
        id: deadlineId(task.id, task.dueDate, 'deadline'),
        kind: 'deadline',
        title: `Due soon: ${task.title}`,
        body: `${task.course ? `${task.course} · ` : ''}Due ${due.toLocaleString()}.`,
        href: `/work?task=${encodeURIComponent(task.id)}`,
        course: task.course || null,
        createdAt: now.toISOString(),
      });
    }
  }

  if (generated.length) await addNotifications(generated);
  return generated;
}

export async function addWeeklyReviewNotification(weekStart: string, createdAt = new Date().toISOString()) {
  const item: TrackerNotification = {
    id: `weekly-review:${weekStart}`,
    kind: 'weekly-review',
    title: 'Weekly Review is ready',
    body: 'Review unfinished work, class captures, outline drafts, and the next two weeks before finalizing your plan.',
    href: '/review',
    createdAt,
  };
  await addNotifications([item]);
  return item;
}

export async function addOutlineDraftNotification(courseId: string, courseTitle: string, weekStart: string, createdAt = new Date().toISOString()) {
  const item: TrackerNotification = {
    id: `outline-draft:${courseId}:${weekStart}`,
    kind: 'outline-draft',
    title: `${courseTitle} outline draft is ready`,
    body: 'Review, edit, and approve the current-week outline proposal.',
    href: '/outline-updates',
    course: courseTitle,
    createdAt,
  };
  await addNotifications([item]);
  return item;
}
