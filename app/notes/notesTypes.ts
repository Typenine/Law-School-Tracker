export type Notebook = {
  id: string;
  name: string;
  course: string | null;
  semester: string | null;
  color: string | null;
  archived: boolean;
  position: number;
  noteCount: number;
  sections: string[];
  createdAt: string;
  updatedAt: string;
};

export type Section = {
  id: string;
  notebookId: string;
  /** Null for a top-level category; a section id for a week inside one. */
  parentId: string | null;
  name: string;
  color: string | null;
  position: number;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PageSummary = {
  id: string;
  title: string;
  notebookId: string | null;
  notebookName: string | null;
  course: string | null;
  semester: string | null;
  section: string;
  sectionId: string | null;
  position: number;
  classDate: string | null;
  sourceType: string;
  topics: string[];
  originalFilename: string | null;
  mimeType: string | null;
  pinned: boolean;
  archived: boolean;
  deletedAt: string | null;
  wordCount: number;
  preview: string;
  createdAt: string;
  updatedAt: string;
};

export type Page = PageSummary & { content: string; contentHtml: string };

export const SOURCE_TYPES = [
  ['class-notes', 'Class notes'],
  ['reading-notes', 'Reading notes'],
  ['case-brief', 'Case brief'],
  ['outline', 'Outline'],
  ['professor-material', 'Professor material'],
  ['other', 'Other'],
] as const;

/** OneNote-ish tab palette. */
export const SECTION_COLORS = [
  '#8b5cf6', '#2f6fed', '#0f9d8f', '#3f9142', '#d4a017',
  '#e0672f', '#d24a63', '#8e6a4f', '#5b6b7f',
];

export function sectionColor(section: Section | undefined, index: number): string {
  return section?.color || SECTION_COLORS[index % SECTION_COLORS.length];
}

export function formatUpdated(value: string): string {
  const date = new Date(value);
  const difference = Date.now() - date.getTime();
  if (difference < 60_000) return 'just now';
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}m ago`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function longDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }) + ' · ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function safeFilename(value: string): string {
  return value.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'page';
}
