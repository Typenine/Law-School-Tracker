/**
 * Combines time actually studied with still-scheduled time.
 * Completed tasks lose their schedule blocks, but should not regain capacity.
 * For each task on each day, reserve max(planned, logged) to avoid double counting.
 */
export type StudyDayLoad = {
  plannedMinutes: number;
  loggedMinutes: number;
  committedMinutes: number;
  plannedByTask: Record<string, number>;
  loggedByTask: Record<string, number>;
};
type Block = { day: string; taskId?: string | null; id?: string | null; plannedMinutes: number };
type Session = { when: string; taskId?: string | null; id?: string | null; minutes: number };

function empty(): StudyDayLoad {
  return { plannedMinutes: 0, loggedMinutes: 0, committedMinutes: 0, plannedByTask: {}, loggedByTask: {} };
}
function positive(n: unknown): number {
  const value = Number(n);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
function recalculate(day: StudyDayLoad): void {
  day.committedMinutes = [...new Set([...Object.keys(day.plannedByTask), ...Object.keys(day.loggedByTask)])]
    .reduce((sum, key) => sum + Math.max(day.plannedByTask[key] || 0, day.loggedByTask[key] || 0), 0);
}
export function summarizeStudyDays(blocks: readonly Block[], sessions: readonly Session[], sessionDay: (when: string) => string): Record<string, StudyDayLoad> {
  const output: Record<string, StudyDayLoad> = {};
  for (const [index, block] of blocks.entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(block.day)) continue;
    const day = output[block.day] ||= empty();
    const key = block.taskId ? 'task:' + block.taskId : 'block:' + (block.id || index);
    const minutes = positive(block.plannedMinutes);
    day.plannedMinutes += minutes;
    day.plannedByTask[key] = (day.plannedByTask[key] || 0) + minutes;
  }
  for (const [index, session] of sessions.entries()) {
    if (!Number.isFinite(Date.parse(session.when))) continue;
    let key: string;
    try { key = sessionDay(session.when); } catch { continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const day = output[key] ||= empty();
    const id = session.taskId ? 'task:' + session.taskId : 'session:' + (session.id || index);
    const minutes = positive(session.minutes);
    day.loggedMinutes += minutes;
    day.loggedByTask[id] = (day.loggedByTask[id] || 0) + minutes;
  }
  for (const day of Object.values(output)) recalculate(day);
  return output;
}
export function addPlannedStudyMinutes(day: StudyDayLoad | undefined, taskId: string | null | undefined, minutes: number): StudyDayLoad {
  const next: StudyDayLoad = day ? { ...day, plannedByTask: { ...day.plannedByTask }, loggedByTask: { ...day.loggedByTask } } : empty();
  const key = taskId ? 'task:' + taskId : 'block:unlinked';
  const increment = positive(minutes);
  next.plannedMinutes += increment;
  next.plannedByTask[key] = (next.plannedByTask[key] || 0) + increment;
  recalculate(next);
  return next;
}
