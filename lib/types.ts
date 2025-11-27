export type TaskStatus = 'todo' | 'done';

export interface Task {
  id: string;
  title: string;
  course?: string | null;
  dueDate: string; // ISO string
  status: TaskStatus;
  createdAt: string; // ISO
  startTime?: string | null; // optional HH:MM 24h for calendar scheduling
  endTime?: string | null;   // optional HH:MM 24h for calendar scheduling
  estimatedMinutes?: number | null;
  estimateOrigin?: 'learned' | 'default' | 'manual' | null;
  actualMinutes?: number | null; // logged time when completed
  priority?: number | null; // 1-5
  notes?: string | null;
  attachments?: string[] | null; // URLs
  dependsOn?: string[] | null; // task IDs
  tags?: string[] | null;
  term?: string | null;
  completedAt?: string | null; // ISO when marked done
  focus?: number | null; // 1-10 focus level when completed
  pagesRead?: number | null; // pages read for this task
  activity?: string | null; // reading|review|outline|practice|other
}

export type Semester = 'Spring' | 'Summer' | 'Fall';

export interface Course {
  id: string;
  code?: string | null; // e.g., Torts 101
  title: string; // e.g., Torts
  instructor?: string | null;
  instructorEmail?: string | null;
  room?: string | null;
  location?: string | null;
  color?: string | null; // hex like #7c3aed
  meetingDays?: number[] | null; // 0=Sun..6=Sat
  meetingStart?: string | null; // HH:MM (24h)
  meetingEnd?: string | null; // HH:MM (24h)
  meetingBlocks?: CourseMeetingBlock[] | null; // multiple patterns
  startDate?: string | null; // ISO date
  endDate?: string | null; // ISO date
  semester?: Semester | null;
  year?: number | null;
  createdAt: string; // ISO
  // Learned reading pace (minutes/page) derived from sessions (EMA)
  learnedMpp?: number | null;
  learnedSample?: number | null; // number of samples incorporated
  learnedUpdatedAt?: string | null; // ISO timestamp
  // Manual override
  overrideEnabled?: boolean | null;
  overrideMpp?: number | null;
  // Default activity for new tasks in this course
  defaultActivity?: string | null;
}

export interface NewCourseInput {
  code?: string | null;
  title: string;
  instructor?: string | null;
  instructorEmail?: string | null;
  room?: string | null;
  location?: string | null;
  color?: string | null;
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
  color?: string | null;
  meetingDays?: number[] | null;
  meetingStart?: string | null;
  meetingEnd?: string | null;
  meetingBlocks?: CourseMeetingBlock[] | null;
  startDate?: string | null;
  endDate?: string | null;
  semester?: Semester | null;
  year?: number | null;
  overrideEnabled?: boolean | null;
  overrideMpp?: number | null;
  defaultActivity?: string | null;
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
  startTime?: string | null; // HH:MM 24h
  endTime?: string | null;   // HH:MM 24h
  estimatedMinutes?: number | null;
  estimateOrigin?: 'learned' | 'default' | 'manual' | null;
  priority?: number | null;
  notes?: string | null;
  attachments?: string[] | null;
  dependsOn?: string[] | null;
  tags?: string[] | null;
  term?: string | null;
  pagesRead?: number | null;
  activity?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  course?: string | null;
  dueDate?: string; // ISO
  status?: TaskStatus;
  startTime?: string | null; // HH:MM 24h
  endTime?: string | null;   // HH:MM 24h
  estimatedMinutes?: number | null;
  estimateOrigin?: 'learned' | 'default' | 'manual' | null;
  actualMinutes?: number | null;
  priority?: number | null;
  notes?: string | null;
  attachments?: string[] | null;
  dependsOn?: string[] | null;
  tags?: string[] | null;
  term?: string | null;
  completedAt?: string | null;
  focus?: number | null;
  pagesRead?: number | null;
  activity?: string | null;
}

export interface StudySession {
  id: string;
  taskId?: string | null;
  when: string; // ISO
  minutes: number;
  focus?: number | null; // 1-10
  notes?: string | null;
  pagesRead?: number | null;
  outlinePages?: number | null;
  practiceQs?: number | null;
  activity?: string | null; // reading|review|outline|practice|other
  createdAt: string; // ISO
}

export interface NewSessionInput {
  taskId?: string | null;
  when?: string; // ISO
  minutes: number;
  focus?: number | null;
  notes?: string | null;
  pagesRead?: number | null;
  outlinePages?: number | null;
  practiceQs?: number | null;
  activity?: string | null;
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
  // New 7-day averages
  avgFocus7d?: number | null;
  avgHours7d?: number | null;
  // Predictive timing based on historical data
  subjectAverages?: Array<{
    subject: string;
    avgMinutesPerTask: number;
    avgFocus: number;
    totalTasks: number;
  }>;
}

// Weekly study goals: global or per-course scope
export interface WeeklyGoal {
  id: string;
  scope: 'global' | 'course';
  weeklyMinutes: number;
  course?: string | null;
}

// Availability template: minutes per day of week (0=Sun..6=Sat)
export type AvailabilityTemplate = Record<number, number>;

// Study windows and breaks per day of week
export interface StudyWindow {
  id: string;
  start: string; // HH:MM or 12h format
  end: string;
}
export type WindowsByDow = Record<number, StudyWindow[]>;
export type BreaksByDow = Record<number, StudyWindow[]>;

// Semester with dates and associated availability
export interface SemesterInfo {
  id: string;
  name: string; // e.g., "Fall 2024", "Spring 2025"
  season: 'Spring' | 'Summer' | 'Fall' | 'Winter';
  year: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  isActive?: boolean;
  // Availability specific to this semester
  windowsByDow?: WindowsByDow | null;
  breaksByDow?: BreaksByDow | null;
  createdAt: string; // ISO
}

export interface NewSemesterInput {
  name: string;
  season: 'Spring' | 'Summer' | 'Fall' | 'Winter';
  year: number;
  startDate: string;
  endDate: string;
  isActive?: boolean;
  windowsByDow?: WindowsByDow | null;
  breaksByDow?: BreaksByDow | null;
}

// Personal/life events (separate from school tasks)
export type EventCategory = 'personal' | 'school' | 'work' | 'health' | 'social' | 'other';

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string | null;
  category: EventCategory;
  // Date/time
  date: string; // YYYY-MM-DD
  startTime?: string | null; // HH:MM 24h
  endTime?: string | null; // HH:MM 24h
  allDay?: boolean;
  // Recurrence
  recurring?: boolean;
  recurrenceRule?: string | null; // iCal RRULE format
  recurrenceEndDate?: string | null;
  // Metadata
  location?: string | null;
  color?: string | null; // hex
  course?: string | null; // for school events
  createdAt: string; // ISO
}

export interface NewEventInput {
  title: string;
  description?: string | null;
  category: EventCategory;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  recurring?: boolean;
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null;
  location?: string | null;
  color?: string | null;
  course?: string | null;
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  category?: EventCategory;
  date?: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  recurring?: boolean;
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null;
  location?: string | null;
  color?: string | null;
  course?: string | null;
}
