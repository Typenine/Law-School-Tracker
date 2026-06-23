import type { Task } from './types';
import { isActiveTask } from './taskMetadata';

export const WEEKLY_PLAN_KEY = 'weeklyPlanV2';
export const WEEKLY_AVAILABILITY_KEY = 'weeklyAvailabilityV2';

export interface WeeklyPlanBlock {
  id: string;
  taskId: string;
  day: string;
  plannedMinutes: number;
  title: string;
  course?: string | null;
}

export interface WeeklyPlanState {
  weekStart: string;
  blocks: WeeklyPlanBlock[];
  updatedAt: string;
}

export interface WeeklyPlanRemainder {
  taskId: string;
  title: string;
  course?: string | null;
  estimatedMinutes: number;
  plannedMinutes: number;
  remainingMinutes: number;
}

export interface WeeklyPlanResult {
  blocks: WeeklyPlanBlock[];
  remainders: WeeklyPlanRemainder[];
  availableByDay: Record<string, number>;
  unusedByDay: Record<string, number>;
}

export type WeeklyAvailability = Record<number, number>;

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function mondayOf(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  const offset = copy.getDay() === 0 ? 6 : copy.getDay() - 1;
  copy.setDate(copy.getDate() - offset);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function estimateTaskMinutes(task: Task): number {
  const alreadyLogged = Math.max(0, task.loggedMinutes || 0);
  const base = task.estimatedMinutes && task.estimatedMinutes > 0
    ? task.estimatedMinutes
    : (task.activity || '').toLowerCase() === 'reading'
      ? Math.max(30, Math.min(180, (task.pagesRead || 20) * 3))
      : (task.activity || '').toLowerCase() === 'practice'
        ? 75
        : (task.activity || '').toLowerCase() === 'outline'
          ? 45
          : 30;
  return Math.max(0, base - alreadyLogged);
}

export function buildWeeklyPlanDetailed(tasks: Task[], weekStart: Date, availability: WeeklyAvailability, busyMinutes: Record<string, number> = {}): WeeklyPlanResult {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const availableByDay = Object.fromEntries(days.map(day => {
    const key = dateKey(day);
    return [key, Math.max(0, (availability[day.getDay()] || 0) - (busyMinutes[key] || 0))];
  })) as Record<string, number>;
  const unusedByDay = { ...availableByDay };
  const blocks: WeeklyPlanBlock[] = [];
  const remainders: WeeklyPlanRemainder[] = [];
  const open = tasks
    .filter(task => isActiveTask(task) && task.status !== 'done')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  for (const task of open) {
    const estimatedMinutes = estimateTaskMinutes(task);
    let minutesLeft = estimatedMinutes;
    const due = new Date(task.dueDate);
    due.setHours(23, 59, 59, 999);
    const eligible = days.filter(day => day <= due);
    if (!eligible.length) eligible.push(days[0]);

    for (const day of eligible) {
      if (minutesLeft <= 0) break;
      const key = dateKey(day);
      const available = unusedByDay[key] || 0;
      if (available <= 0) continue;
      const planned = Math.min(minutesLeft, available, 90);
      blocks.push({ id: `${task.id}:${key}:${blocks.length}`, taskId: task.id, day: key, plannedMinutes: planned, title: task.title, course: task.course || null });
      unusedByDay[key] -= planned;
      minutesLeft -= planned;
    }

    const plannedMinutes = estimatedMinutes - minutesLeft;
    remainders.push({ taskId: task.id, title: task.title, course: task.course || null, estimatedMinutes, plannedMinutes, remainingMinutes: minutesLeft });
  }

  return { blocks, remainders, availableByDay, unusedByDay };
}

export function buildWeeklyPlan(tasks: Task[], weekStart: Date, availability: WeeklyAvailability): WeeklyPlanBlock[] {
  return buildWeeklyPlanDetailed(tasks, weekStart, availability).blocks;
}
