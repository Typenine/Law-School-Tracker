import type { Task } from './types';

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
  if (task.estimatedMinutes && task.estimatedMinutes > 0) return task.estimatedMinutes;
  const activity = (task.activity || '').toLowerCase();
  if (activity === 'reading') return Math.max(30, Math.min(180, (task.pagesRead || 20) * 3));
  if (activity === 'practice') return 75;
  if (activity === 'outline') return 45;
  return 30;
}

export function buildWeeklyPlan(tasks: Task[], weekStart: Date, availability: WeeklyAvailability): WeeklyPlanBlock[] {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const remaining = Object.fromEntries(days.map((day) => [dateKey(day), Math.max(0, availability[day.getDay()] || 0)])) as Record<string, number>;
  const blocks: WeeklyPlanBlock[] = [];
  const open = tasks
    .filter((task) => task.status !== 'done')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  for (const task of open) {
    let minutesLeft = estimateTaskMinutes(task);
    const due = new Date(task.dueDate);
    due.setHours(23, 59, 59, 999);
    const eligible = days.filter((day) => day <= due);
    if (!eligible.length) eligible.push(days[0]);

    for (const day of eligible) {
      if (minutesLeft <= 0) break;
      const key = dateKey(day);
      const available = remaining[key] || 0;
      if (available <= 0) continue;
      const planned = Math.min(minutesLeft, available, 90);
      blocks.push({
        id: `${task.id}:${key}:${blocks.length}`,
        taskId: task.id,
        day: key,
        plannedMinutes: planned,
        title: task.title,
        course: task.course || null,
      });
      remaining[key] -= planned;
      minutesLeft -= planned;
    }
  }

  return blocks;
}
