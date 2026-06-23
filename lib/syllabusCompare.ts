import type { StoredSyllabusAnalysis, StoredSyllabusItem, SyllabusChangeSummary } from './courseWorkspace';
import { directSyllabusIdentity, stableSyllabusIdentity, syllabusItemChanged } from './syllabusIdentity';

export function compareSyllabusVersions(previous: StoredSyllabusAnalysis | undefined, current: StoredSyllabusAnalysis): SyllabusChangeSummary {
  const beforeItems = previous?.importItems || [];
  const afterItems = current.importItems || [];
  const direct = new Map<string, StoredSyllabusItem>();
  for (const item of beforeItems) direct.set(directSyllabusIdentity(item), item);

  const usedBefore = new Set<StoredSyllabusItem>();
  const usedAfter = new Set<StoredSyllabusItem>();
  const differences: Array<{ before: StoredSyllabusItem; after: StoredSyllabusItem }> = [];
  let unchanged = 0;

  for (const after of afterItems) {
    const before = direct.get(directSyllabusIdentity(after));
    if (!before) continue;
    usedBefore.add(before);
    usedAfter.add(after);
    if (syllabusItemChanged(before, after)) differences.push({ before, after }); else unchanged++;
  }

  for (const after of afterItems) {
    if (usedAfter.has(after)) continue;
    const identity = stableSyllabusIdentity(after);
    const candidates = beforeItems.filter(item => !usedBefore.has(item) && stableSyllabusIdentity(item) === identity);
    if (!candidates.length) continue;
    const afterTime = new Date(after.dueDate).getTime();
    candidates.sort((a, b) => Math.abs(new Date(a.dueDate).getTime() - afterTime) - Math.abs(new Date(b.dueDate).getTime() - afterTime));
    const before = candidates[0];
    usedBefore.add(before);
    usedAfter.add(after);
    if (syllabusItemChanged(before, after)) differences.push({ before, after }); else unchanged++;
  }

  return {
    comparedAt: new Date().toISOString(),
    previousVersionId: previous?.id,
    currentVersionId: current.id,
    added: afterItems.filter(item => !usedAfter.has(item)),
    removed: beforeItems.filter(item => !usedBefore.has(item)),
    changed: differences,
    unchanged,
  };
}
