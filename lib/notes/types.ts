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
  position: number;
  noteCount: number;
  /** Section names, kept for callers that only need labels. */
  sections: string[];
  createdAt: string;
  updatedAt: string;
}

/** A section tab inside a notebook. */
export interface NoteSection {
  id: string;
  notebookId: string;
  /** Sections nest: a category holds weeks, a week holds pages. */
  parentId: string | null;
  name: string;
  color: string | null;
  position: number;
  pageCount: number;
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
  /** The section a page belongs to. Names repeat across branches, ids do not. */
  sectionId: string | null;
  position: number;
  classDate: string | null;
  sourceType: NoteSourceType;
  topics: string[];
  originalFilename: string | null;
  mimeType: string | null;
  pinned: boolean;
  archived: boolean;
  /** Set when the page is in the trash; null otherwise. */
  deletedAt: string | null;
  wordCount: number;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiNote extends AiNoteSummary {
  /** Plain text, used for search, previews and the GPT endpoints. */
  content: string;
  /** Rich text shown in the editor. */
  contentHtml: string;
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
  sectionId?: string | null;
  from?: string | null;
  to?: string | null;
  archived?: boolean;
  /** True to look inside the trash instead of past it. */
  deleted?: boolean;
  limit?: number;
}
