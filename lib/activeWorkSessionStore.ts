import { getSettings, patchSettings } from './storage';

export const ACTIVE_WORK_SESSIONS_KEY = 'activeWorkSessionsV1';

export interface ActiveWorkSessionRecord {
  taskId: string;
  running: boolean;
  accumulatedSeconds: number;
  startedAt: number | null;
  sessionStartedAt: string;
  notes: string;
  pages: string;
  updatedAt: string;
}

type ActiveWorkSessionMap = Record<string, ActiveWorkSessionRecord>;

export async function listActiveWorkSessions() {
  const settings = await getSettings([ACTIVE_WORK_SESSIONS_KEY]);
  const value = settings[ACTIVE_WORK_SESSIONS_KEY];
  return value && typeof value === 'object' ? value as ActiveWorkSessionMap : {};
}

export async function getActiveWorkSession(taskId: string) {
  const map = await listActiveWorkSessions();
  return map[taskId] || null;
}

export async function saveActiveWorkSession(session: ActiveWorkSessionRecord) {
  const map = await listActiveWorkSessions();
  const current = map[session.taskId];
  if (current && current.updatedAt > session.updatedAt) return current;
  const next = { ...session, updatedAt: session.updatedAt || new Date().toISOString() };
  await patchSettings({ [ACTIVE_WORK_SESSIONS_KEY]: { ...map, [session.taskId]: next } });
  return next;
}

export async function deleteActiveWorkSession(taskId: string) {
  const map = await listActiveWorkSessions();
  if (!map[taskId]) return false;
  const next = { ...map };
  delete next[taskId];
  await patchSettings({ [ACTIVE_WORK_SESSIONS_KEY]: next });
  return true;
}
