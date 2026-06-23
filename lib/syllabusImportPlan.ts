import type { Course, Task } from './types';
import type { StoredSyllabusItem } from './courseWorkspace';
import type { WizardPreview } from './wizard_types';
import {
  normalizeSyllabusText,
  syllabusFingerprint,
  syllabusFingerprintFromTags,
  syllabusSourceFromTags,
  taskMatchesCourse,
} from './taskMetadata';

export interface ImportItem {
  id: string;
  sourceKey: string;
  selected: boolean;
  kind: 'task' | 'event';
  title: string;
  dueDate: string;
  activity: string;
  estimatedMinutes?: number | null;
  notes?: string;
  tags?: string[];
  confidence?: number;
}

export interface SyllabusApplyProgress {
  signature: string;
  completed: string[];
  startedAt: string;
}

function meetingTime(course?: Course | null) {
  return course?.meetingStart || course?.meetingBlocks?.[0]?.start || '09:00';
}

function nextStableKey(counts: Map<string, number>, base: string) {
  const count = (counts.get(base) || 0) + 1;
  counts.set(base, count);
  return `${base}:${count}`;
}

export function itemsFromPreview(preview: WizardPreview, course?: Course | null): ImportItem[] {
  const result: ImportItem[] = [];
  const counts = new Map<string, number>();
  for (const session of preview.sessions || []) {
    if (session.canceled) {
      const sourceKey = `event:no-class:${session.date}`;
      result.push({ sourceKey, id: sourceKey, selected: true, kind: 'event', title: `No class: ${course?.title || preview.course?.title || 'Course'}`, dueDate: `${session.date}T00:00:00`, activity: 'calendar', notes: session.source_text || session.notes || 'No class date imported from syllabus.', tags: ['syllabus-import', 'no-class'], confidence: session.confidence });
    }
    for (const reading of session.readings || []) {
      const title = `Read: ${[reading.short_title, reading.pages].filter(Boolean).join(' ')}`.trim();
      const base = `reading:${normalizeSyllabusText(title) || 'untitled'}`;
      const sourceKey = nextStableKey(counts, base);
      result.push({ sourceKey, id: sourceKey, selected: reading.priority !== 'optional', kind: 'task', title, dueDate: `${session.date}T${meetingTime(course)}:00`, activity: 'reading', estimatedMinutes: reading.estimated_minutes, notes: [reading.priority === 'skim' ? 'Strategic skim.' : reading.priority === 'optional' ? 'Optional reading.' : null, reading.source_text].filter(Boolean).join('\n'), tags: ['syllabus-import', reading.priority, reading.source_type], confidence: reading.confidence });
    }
    for (const assignment of session.assignments_due || []) {
      const base = `assignment:${normalizeSyllabusText(assignment.title) || 'untitled'}`;
      const sourceKey = nextStableKey(counts, base);
      result.push({ sourceKey, id: sourceKey, selected: true, kind: 'task', title: assignment.title, dueDate: assignment.due_datetime, activity: assignment.type === 'exam' ? 'practice' : assignment.type === 'reading' ? 'reading' : 'other', estimatedMinutes: assignment.estimated_minutes, notes: assignment.source_text, tags: ['syllabus-import', assignment.type], confidence: assignment.confidence });
    }
  }
  return result;
}

export function storedItems(items: ImportItem[]): StoredSyllabusItem[] {
  return items.map(item => ({ sourceKey: item.sourceKey, kind: item.kind, title: item.title, dueDate: item.dueDate, activity: item.activity, selected: item.selected, notes: item.notes, tags: item.tags }));
}

export function syllabusSourceTag(sourceKey: string) {
  return `syllabus-source:${encodeURIComponent(sourceKey)}`;
}

export function syllabusEventToken(sourceKey: string) {
  return `[syllabus-source:${sourceKey}]`;
}

export function isMajorAssignment(item: ImportItem) {
  return item.tags?.some(tag => ['memo','brief','paper','presentation'].includes(tag)) || /(memo|brief|paper|essay|presentation|oral argument|project)/i.test(item.title);
}

export function findTaskForImport(tasks: Task[], item: ImportItem, course: Course, priorSourceKey?: string) {
  const courseTasks = tasks.filter(task => taskMatchesCourse(task, course));
  const direct = courseTasks.find(task => syllabusSourceFromTags(task.tags) === item.sourceKey);
  if (direct) return direct;
  if (priorSourceKey) {
    const prior = courseTasks.find(task => syllabusSourceFromTags(task.tags) === priorSourceKey);
    if (prior) return prior;
  }
  const fingerprint = syllabusFingerprint({ title: item.title, activity: item.activity, course: course.title });
  const matches = courseTasks.filter(task => syllabusFingerprintFromTags(task.tags) === fingerprint);
  return matches.length === 1 ? matches[0] : null;
}

function simpleHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function syllabusApplySignature(courseId: string, fileName: string, items: ImportItem[]) {
  return simpleHash(`${courseId}|${fileName}|${items.map(item => `${item.sourceKey}:${item.selected}:${item.dueDate}`).join('|')}`);
}

function progressKey(courseId: string) {
  return `syllabusApplyProgressV2:${courseId}`;
}

export function loadSyllabusProgress(courseId: string, signature: string): SyllabusApplyProgress {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(progressKey(courseId));
      const parsed = raw ? JSON.parse(raw) as SyllabusApplyProgress : null;
      if (parsed?.signature === signature) return parsed;
    } catch {}
  }
  return { signature, completed: [], startedAt: new Date().toISOString() };
}

export function saveSyllabusProgress(courseId: string, progress: SyllabusApplyProgress) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(progressKey(courseId), JSON.stringify(progress));
}

export function clearSyllabusProgress(courseId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(progressKey(courseId));
}
