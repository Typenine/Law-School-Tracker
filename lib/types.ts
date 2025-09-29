export type TaskStatus = 'todo' | 'done';

export interface Task {
  id: string;
  title: string;
  course?: string | null;
  dueDate: string; // ISO string
  status: TaskStatus;
  createdAt: string; // ISO
  estimatedMinutes?: number | null;
}

export interface NewTaskInput {
  title: string;
  course?: string | null;
  dueDate: string; // ISO
  status?: TaskStatus;
  estimatedMinutes?: number | null;
}

export interface UpdateTaskInput {
  title?: string;
  course?: string | null;
  dueDate?: string; // ISO
  status?: TaskStatus;
  estimatedMinutes?: number | null;
}

export interface StudySession {
  id: string;
  taskId?: string | null;
  when: string; // ISO
  minutes: number;
  focus?: number | null; // 1-10
  notes?: string | null;
  createdAt: string; // ISO
}

export interface NewSessionInput {
  taskId?: string | null;
  when?: string; // ISO
  minutes: number;
  focus?: number | null;
  notes?: string | null;
}

export interface StatsPayload {
  upcoming7d: number;
  hoursThisWeek: number;
  avgFocusThisWeek: number | null;
  estMinutesThisWeek: number; // sum of estimated minutes for TODO tasks due this week
  loggedMinutesThisWeek: number; // sum of minutes logged this week
  remainingMinutesThisWeek: number; // max(0, est - logged)
}
