import type { StoredSyllabusItem } from './courseWorkspace';
import { normalizeSyllabusText } from './taskMetadata';

export function directSyllabusIdentity(item: StoredSyllabusItem) {
  return item.sourceKey || `${item.kind}|${item.title.toLowerCase()}`;
}

export function stableSyllabusIdentity(item: StoredSyllabusItem) {
  return `${item.kind}|${item.activity}|${normalizeSyllabusText(item.title)}`;
}

export function syllabusItemChanged(before: StoredSyllabusItem, after: StoredSyllabusItem) {
  return before.title !== after.title || before.dueDate !== after.dueDate || before.selected !== after.selected || before.notes !== after.notes || before.activity !== after.activity;
}
