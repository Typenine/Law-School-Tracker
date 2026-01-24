let chan: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try { chan = new BroadcastChannel('tasks'); } catch {}
}

const LS_KEY = 'tasksUpdatedAt';

export function notifyTasksChanged(): void {
  const ts = Date.now();
  if (chan) {
    try { chan.postMessage(ts); } catch {}
  }
  try { if (typeof window !== 'undefined') window.localStorage.setItem(LS_KEY, String(ts)); } catch {}
}

export function onTasksChanged(cb: () => void): () => void {
  const onMsg = () => cb();
  const onStorage = (e: StorageEvent) => { if (e.key === LS_KEY) cb(); };
  if (chan) {
    try { chan.addEventListener('message', onMsg as any); } catch {}
  }
  if (typeof window !== 'undefined') {
    try { window.addEventListener('storage', onStorage); } catch {}
  }
  return () => {
    if (chan) {
      try { chan.removeEventListener('message', onMsg as any); } catch {}
    }
    if (typeof window !== 'undefined') {
      try { window.removeEventListener('storage', onStorage); } catch {}
    }
  };
}
