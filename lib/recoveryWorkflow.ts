import type { Task } from './types';

export type RecoveryCategory = 'must' | 'skim' | 'ask' | 'defer' | 'drop';

export function recoveryOverride(task: Task): RecoveryCategory | null {
  const tag = (task.tags || []).find(item => item.startsWith('recovery-override:'));
  const value = tag?.slice('recovery-override:'.length);
  return value === 'must' || value === 'skim' || value === 'ask' || value === 'defer' || value === 'drop' ? value : null;
}

export function recoveryReason(task: Task, examDays?: number | null) {
  const override = recoveryOverride(task);
  if (override) return `Manually classified as ${override}.`;
  const title = `${task.title} ${(task.tags || []).join(' ')}`.toLowerCase();
  const dueDays = Math.ceil((new Date(task.dueDate).getTime() - Date.now()) / 86400000);
  if (/optional|recommended only|extra credit/.test(title)) return 'Optional work with lower immediate value.';
  if (examDays !== null && examDays !== undefined && examDays <= 14 && /outline|practice|review/.test(title)) return `Direct exam preparation with ${examDays} days remaining.`;
  if (dueDays < 0) return `${Math.abs(dueDays)} day${Math.abs(dueDays) === 1 ? '' : 's'} overdue.`;
  if (dueDays <= 1) return 'Due within one day.';
  if (/memo|brief|paper|exam|presentation|project/.test(title)) return 'Major graded deliverable.';
  if (/read|pages|chapter|casebook/.test(title)) return 'Reading can be reduced to rules, holdings, and professor emphasis if time is limited.';
  return 'Lower urgency than current deadlines.';
}
