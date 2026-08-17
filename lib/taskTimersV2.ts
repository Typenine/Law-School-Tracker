import { getSettings, patchSettings } from './storage';

export async function clearStoredTaskTimer(taskId: string): Promise<void> {
  try {
    const settings = await getSettings(['taskTimersV1']);
    const current = settings?.taskTimersV1;
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(taskId in current)) return;
    const next = { ...(current as Record<string, unknown>) };
    delete next[taskId];
    await patchSettings({ taskTimersV1: next });
  } catch {
    // Timer cleanup must never make a task lifecycle mutation fail. A stale
    // client-side timer is safe to overwrite on the next settings sync.
  }
}
