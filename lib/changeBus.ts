/**
 * Shared "something changed" notifier used by the tasks, courses, sessions,
 * schedule, semester and settings buses.
 *
 * The previous implementation relied only on `BroadcastChannel` plus the
 * `storage` event. Neither of those fires in the tab that triggered the
 * change: a BroadcastChannel never delivers a message to the context that
 * posted it, and `storage` only fires in *other* documents. So after deleting
 * or moving something, every subscriber in the current tab kept showing the
 * old data until the next poll, and any component that had already applied an
 * optimistic change could get it overwritten by a stale list. Adding an
 * in-process subscriber set makes the notification reach the current tab
 * immediately while still crossing tabs.
 */

type Listener = () => void;

export type ChangeBus = {
  notify: () => void;
  subscribe: (cb: Listener) => () => void;
};

export function createChangeBus(channelName: string, storageKey: string): ChangeBus {
  const listeners = new Set<Listener>();
  let channel: BroadcastChannel | null = null;
  let wired = false;

  function emit() {
    // Copy first: a listener may unsubscribe while we iterate.
    for (const listener of Array.from(listeners)) {
      try { listener(); } catch {}
    }
  }

  function wire() {
    if (wired || typeof window === 'undefined') return;
    wired = true;
    if ('BroadcastChannel' in window) {
      try {
        channel = new BroadcastChannel(channelName);
        channel.addEventListener('message', emit as any);
      } catch { channel = null; }
    }
    try {
      window.addEventListener('storage', (event: StorageEvent) => {
        if (event.key === storageKey) emit();
      });
    } catch {}
  }

  return {
    notify() {
      if (typeof window === 'undefined') return;
      wire();
      const stamp = Date.now();
      // Other tabs.
      if (channel) { try { channel.postMessage(stamp); } catch {} }
      try { window.localStorage.setItem(storageKey, String(stamp)); } catch {}
      // This tab.
      emit();
    },
    subscribe(cb: Listener) {
      if (typeof window === 'undefined') return () => {};
      wire();
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}
