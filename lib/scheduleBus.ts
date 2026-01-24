let schChan: BroadcastChannel | null = null;
let availChan: BroadcastChannel | null = null;

if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try { schChan = new BroadcastChannel('schedule'); } catch {}
  try { availChan = new BroadcastChannel('availability'); } catch {}
}

const LS_SCHEDULE_KEY = 'scheduleUpdatedAt';
const LS_AVAIL_KEY = 'availabilityUpdatedAt';

export function notifyScheduleChanged(): void {
  const ts = Date.now();
  if (schChan) { try { schChan.postMessage(ts); } catch {} }
  try { if (typeof window !== 'undefined') window.localStorage.setItem(LS_SCHEDULE_KEY, String(ts)); } catch {}
}

export function onScheduleChanged(cb: () => void): () => void {
  const onMsg = () => cb();
  const onStorage = (e: StorageEvent) => { if (e.key === LS_SCHEDULE_KEY) cb(); };
  if (schChan) { try { schChan.addEventListener('message', onMsg as any); } catch {} }
  if (typeof window !== 'undefined') { try { window.addEventListener('storage', onStorage); } catch {} }
  return () => {
    if (schChan) { try { schChan.removeEventListener('message', onMsg as any); } catch {} }
    if (typeof window !== 'undefined') { try { window.removeEventListener('storage', onStorage); } catch {} }
  };
}

export function notifyAvailabilityChanged(): void {
  const ts = Date.now();
  if (availChan) { try { availChan.postMessage(ts); } catch {} }
  try { if (typeof window !== 'undefined') window.localStorage.setItem(LS_AVAIL_KEY, String(ts)); } catch {}
}

export function onAvailabilityChanged(cb: () => void): () => void {
  const onMsg = () => cb();
  const onStorage = (e: StorageEvent) => { if (e.key === LS_AVAIL_KEY) cb(); };
  if (availChan) { try { availChan.addEventListener('message', onMsg as any); } catch {} }
  if (typeof window !== 'undefined') { try { window.addEventListener('storage', onStorage); } catch {} }
  return () => {
    if (availChan) { try { availChan.removeEventListener('message', onMsg as any); } catch {} }
    if (typeof window !== 'undefined') { try { window.removeEventListener('storage', onStorage); } catch {} }
  };
}
