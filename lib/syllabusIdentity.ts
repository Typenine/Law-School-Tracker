import type { StoredSyllabusItem } from './courseWorkspace';
import { normalizeSyllabusText } from './taskMetadata';

const GENERIC_WORDS = new Set([
  'read', 'reading', 'page', 'pages', 'pp', 'complete', 'review', 'assignment',
  'due', 'at', 'start', 'of', 'class', 'prepare', 'materials', 'material',
]);

export function directSyllabusIdentity(item: StoredSyllabusItem) {
  return item.sourceKey || `${item.kind}|${item.title.toLowerCase()}`;
}

function semanticTitleIdentity(title: string) {
  const full = normalizeSyllabusText(title);
  const withoutPageRanges = normalizeSyllabusText(
    title.replace(/\b(?:pages?|pp?\.?)\s*\d+(?:\s*[-–—]\s*\d+)?\b/gi, ' '),
  );
  const substantive = withoutPageRanges
    .split('-')
    .filter(token => token && !GENERIC_WORDS.has(token));
  return substantive.length ? withoutPageRanges : full;
}

export function stableSyllabusIdentity(item: StoredSyllabusItem) {
  return `${item.kind}|${item.activity}|${semanticTitleIdentity(item.title)}`;
}

export function syllabusItemChanged(before: StoredSyllabusItem, after: StoredSyllabusItem) {
  return before.title !== after.title || before.dueDate !== after.dueDate || before.selected !== after.selected || before.notes !== after.notes || before.activity !== after.activity;
}
