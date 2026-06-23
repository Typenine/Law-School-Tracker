export interface PersistedWorkSession {
  taskId: string;
  running: boolean;
  accumulatedSeconds: number;
  startedAt: number | null;
  sessionStartedAt: string;
  notes: string;
  pages: string;
}

const PREFIX = 'activeWorkSessionV1:';

function storageKey(taskId: string) {
  return `${PREFIX}${taskId}`;
}

export function elapsedSeconds(session: PersistedWorkSession, now = Date.now()) {
  const runningSeconds = session.running && session.startedAt ? Math.max(0, Math.floor((now - session.startedAt) / 1000)) : 0;
  return Math.max(0, session.accumulatedSeconds + runningSeconds);
}

export function loadWorkSession(taskId: string): PersistedWorkSession | null {
  if (typeof window === 'undefined' || !taskId) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(taskId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedWorkSession;
    if (parsed.taskId !== taskId) return null;
    return {
      taskId,
      running: Boolean(parsed.running),
      accumulatedSeconds: Math.max(0, Number(parsed.accumulatedSeconds) || 0),
      startedAt: parsed.startedAt ? Number(parsed.startedAt) : null,
      sessionStartedAt: parsed.sessionStartedAt || new Date().toISOString(),
      notes: parsed.notes || '',
      pages: parsed.pages || '',
    };
  } catch {
    return null;
  }
}

export function saveWorkSession(session: PersistedWorkSession) {
  if (typeof window === 'undefined' || !session.taskId) return;
  window.localStorage.setItem(storageKey(session.taskId), JSON.stringify(session));
}

export function clearWorkSession(taskId: string) {
  if (typeof window === 'undefined' || !taskId) return;
  window.localStorage.removeItem(storageKey(taskId));
}

export function newWorkSession(taskId: string): PersistedWorkSession {
  return {
    taskId,
    running: false,
    accumulatedSeconds: 0,
    startedAt: null,
    sessionStartedAt: new Date().toISOString(),
    notes: '',
    pages: '',
  };
}
