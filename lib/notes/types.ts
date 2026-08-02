export type NoteSourceType =
  | 'class-notes'
  | 'reading-notes'
  | 'case-brief'
  | 'outline'
  | 'professor-material'
  | 'other';

export interface NoteNotebook {
  id: string;
  name: string;
  course: string | null;
  semester: string | null;
  color: string | null;
  archived: boolean;
  noteCount: number;
  sections: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AiNoteSummary {
  id: string;
  title: string;
  notebookId: string | null;
  notebookName: string | null;
  course: string | null;
  semester: string | null;
  section: string;
  classDate: string | null;
  sourceType: NoteSourceType;
  topics: string[];
  originalFilename: string | null;
  mimeType: string | null;
  pinned: boolean;
  archived: boolean;
  wordCount: number;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiNote extends AiNoteSummary {
  content: string;
}

export interface AiNoteSearchResult extends AiNoteSummary {
  excerpt: string;
  score: number;
}

export interface NoteFilters {
  notebookId?: string | null;
  course?: string | null;
  semester?: string | null;
  section?: string | null;
  from?: string | null;
  to?: string | null;
  archived?: boolean;
  limit?: number;
}
