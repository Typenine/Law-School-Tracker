export type SourceType = 'casebook' | 'article' | 'case' | 'statute' | 'problem' | 'other';
export type ReadingPriority = 'required' | 'optional' | 'skim';
export type TaskType = 'reading' | 'brief' | 'memo' | 'quiz' | 'exam' | 'paper' | 'presentation' | 'problem_set' | 'admin' | 'other';
export type TaskStatusWizard = 'planned' | 'confirmed' | 'edited';

export interface WizardCourse {
  code: string | null;
  title: string | null;
  section: string | null;
  professor: string | null;
  professor_email?: string | null;
  office_hours?: string | null;
  location?: string | null;
  meeting_days: number[] | null;
  meeting_time: string | null;
  meeting_end_time?: string | null;
  timezone: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface Reading {
  source_type: SourceType;
  short_title: string | null;
  pages: string | null;
  priority: ReadingPriority;
  estimated_minutes?: number | null;
  source_text?: string;
  source_ref?: string;
  confidence?: number;
}

export interface WizardTask {
  type: TaskType;
  title: string;
  due_datetime: string;
  estimated_minutes: number | null;
  blocking: boolean;
  source_ref: string;
  source_text?: string;
  status: TaskStatusWizard;
  confidence?: number;
}

export interface Session {
  date: string;
  sequence_number: number;
  topic: string | null;
  readings: Reading[];
  assignments_due: WizardTask[];
  notes: string | null;
  canceled: boolean;
  source_ref?: string;
  source_text?: string;
  confidence?: number;
}

export interface ExtractedDocumentSections {
  required_materials: string[];
  grading_components: string[];
  office_hours: string[];
  major_assessments: string[];
  policies: string[];
  holidays_and_breaks: string[];
}

export interface WizardPreview {
  course: WizardCourse | null;
  sessions: Session[];
  readings: Reading[];
  tasks: WizardTask[];
  sections?: ExtractedDocumentSections;
  unassignedImportantLines?: Array<{ text: string; source_ref: string; reason: string }>;
  diagnostics?: {
    sourceCharacters: number;
    sourceLines: number;
    normalizedLines: number;
    sessions: number;
    readings: number;
    tasks: number;
    canceledSessions: number;
    dateCoverage: number;
    likelyScannedDocument: boolean;
  };
  lowConfidence: Array<{ kind: 'course' | 'session' | 'reading' | 'task' | 'document'; ref?: string; confidence: number; reason?: string }>;
}
