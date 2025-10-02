// Data model for Syllabus Import Wizard (strict names per spec)

export type SourceType = 'casebook' | 'article' | 'case' | 'statute';
export type ReadingPriority = 'required' | 'optional' | 'skim';
export type TaskType = 'reading' | 'brief' | 'memo' | 'quiz' | 'exam' | 'admin';
export type TaskStatusWizard = 'planned' | 'confirmed' | 'edited';

export interface WizardCourse {
  code: string | null;
  title: string | null;
  section: string | null;
  professor: string | null;
  meeting_days: number[] | null; // 0=Sun..6=Sat
  meeting_time: string | null; // HH:MM 24h (start time of class)
  timezone: string | null; // e.g., America/Chicago
  start_date: string | null; // ISO date
  end_date: string | null; // ISO date
}

export interface Reading {
  source_type: SourceType;
  short_title: string | null; // or citation
  pages: string | null; // pages/sections like "pp. 10–25" or "§2.03"
  priority: ReadingPriority;
  // provenance
  source_ref?: string; // original row/line id
  confidence?: number; // 0..1
}

export interface WizardTask {
  type: TaskType;
  title: string;
  due_datetime: string; // ISO datetime with implied timezone
  estimated_minutes: number | null;
  blocking: boolean; // true/false
  source_ref: string; // pointer to session/reading row
  status: TaskStatusWizard; // planned/confirmed/edited
  confidence?: number; // 0..1
}

export interface Session {
  date: string; // ISO date
  sequence_number: number;
  topic: string | null;
  readings: Reading[];
  assignments_due: WizardTask[];
  notes: string | null;
  canceled: boolean;
  source_ref?: string; // original line/table row id
  confidence?: number; // 0..1
}

export interface WizardPreview {
  course: WizardCourse | null;
  sessions: Session[];
  readings: Reading[]; // flattened across sessions
  tasks: WizardTask[]; // flattened across sessions
  lowConfidence: Array<{ kind: 'course' | 'session' | 'reading' | 'task'; ref?: string; confidence: number; reason?: string }>
}
