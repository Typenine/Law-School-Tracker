export type TaskStatus = 'todo' | 'done';

export interface Task {
  id: string;
  title: string;
  course?: string | null;
  dueDate: string; // ISO string
  status: TaskStatus;
  createdAt: string; // ISO
  estimatedMinutes?: number | null;
  priority?: number | null; // 1-5
  notes?: string | null;
  attachments?: string[] | null; // URLs
  dependsOn?: string[] | null; // task IDs
  tags?: string[] | null;
  term?: string | null;
}

export type Semester = 'Spring' | 'Summer' | 'Fall' | 'Winter';

export interface Course {
  id: string;
  code?: string | null; // e.g., Torts 101
  title: string; // e.g., Torts
  instructor?: string | null;
  instructorEmail?: string | null;
  room?: string | null;
  location?: string | null;
  meetingDays?: number[] | null; // 0=Sun..6=Sat
  meetingStart?: string | null; // HH:MM (24h)
  meetingEnd?: string | null; // HH:MM (24h)
  meetingBlocks?: CourseMeetingBlock[] | null; // multiple patterns
  startDate?: string | null; // ISO date
  endDate?: string | null; // ISO date
  semester?: Semester | null;
  year?: number | null;
  createdAt: string; // ISO
}

export interface NewCourseInput {
  code?: string | null;
  title: string;
  instructor?: string | null;
  instructorEmail?: string | null;
  room?: string | null;
  location?: string | null;
  meetingDays?: number[] | null;
  meetingStart?: string | null;
  meetingEnd?: string | null;
  meetingBlocks?: CourseMeetingBlock[] | null;
  startDate?: string | null;
  endDate?: string | null;
  semester?: Semester | null;
  year?: number | null;
}

export interface UpdateCourseInput {
  code?: string | null;
  title?: string;
  instructor?: string | null;
  instructorEmail?: string | null;
  room?: string | null;
  location?: string | null;
  meetingDays?: number[] | null;
  meetingStart?: string | null;
  meetingEnd?: string | null;
  meetingBlocks?: CourseMeetingBlock[] | null;
  startDate?: string | null;
  endDate?: string | null;
  semester?: Semester | null;
  year?: number | null;
}

export interface CourseMeetingBlock {
  days: number[]; // 0=Sun..6=Sat
  start: string; // HH:MM 24h
  end: string; // HH:MM 24h
  location?: string | null;
}

export interface NewTaskInput {
  title: string;
  course?: string | null;
  dueDate: string; // ISO
  status?: TaskStatus;
  estimatedMinutes?: number | null;
  priority?: number | null;
  notes?: string | null;
  attachments?: string[] | null;
  dependsOn?: string[] | null;
  tags?: string[] | null;
  term?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  course?: string | null;
  dueDate?: string; // ISO
  status?: TaskStatus;
  estimatedMinutes?: number | null;
  priority?: number | null;
  notes?: string | null;
  attachments?: string[] | null;
  dependsOn?: string[] | null;
  tags?: string[] | null;
  term?: string | null;
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
  courseBreakdown: Array<{
    course: string | null;
    estMinutes: number;
    loggedMinutes: number;
    remainingMinutes: number;
  }>;
  dailyEst?: Array<{ date: string; estMinutes: number }>;
  heavyDays?: number;
  maxDayMinutes?: number;
}
