"use client";
import { useEffect, useState, useCallback, useRef } from 'react';

export type TimerState = {
  accMs: number;
  running: boolean;
  startedAt?: number;
};

export type TimersMap = Record<string, TimerState>;

const LS_KEY = 'taskTimersV1';
const SYNC_INTERVAL = 1000;

// Shared state across all hook instances
let globalTimers: TimersMap = {};
let listeners: Set<() => void> = new Set();
let initialized = false;

function notifyListeners() {
  listeners.forEach(fn => fn());
}

function loadFromStorage(): TimersMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveToStorage(timers: TimersMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(timers));
  } catch {}
}

function saveToServer(timers: TimersMap) {
  try {
    void fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskTimersV1: timers }),
    });
  } catch {}
}

// Initialize global state
function initGlobal() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  
  // Load from localStorage first
  globalTimers = loadFromStorage();
  
  // Then try to sync from server
  (async () => {
    try {
      const res = await fetch('/api/settings?keys=taskTimersV1', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const serverTimers = data?.settings?.taskTimersV1;
        if (serverTimers && typeof serverTimers === 'object') {
          // Merge: prefer running timers, otherwise use most recent
          const merged = { ...globalTimers };
          for (const [id, st] of Object.entries(serverTimers as TimersMap)) {
            const local = merged[id];
            if (!local) {
              merged[id] = st;
            } else if (st.running && !local.running) {
              merged[id] = st;
            } else if (!st.running && local.running) {
              // Keep local
            } else {
              // Both same state - use larger accMs
              if ((st.accMs || 0) > (local.accMs || 0)) {
                merged[id] = st;
              }
            }
          }
          globalTimers = merged;
          saveToStorage(merged);
          notifyListeners();
        }
      }
    } catch {}
  })();
  
  // Periodic sync to server
  setInterval(() => {
    saveToServer(globalTimers);
  }, 30000);
  
  // Save on page unload
  window.addEventListener('beforeunload', () => {
    saveToStorage(globalTimers);
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/settings', new Blob([
        JSON.stringify({ taskTimersV1: globalTimers })
      ], { type: 'application/json' }));
    }
  });
}

export function useTimers() {
  const [, forceUpdate] = useState(0);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    initGlobal();
    
    const listener = () => forceUpdate(x => x + 1);
    listeners.add(listener);
    
    // Tick every second to update elapsed time display
    tickRef.current = setInterval(() => {
      forceUpdate(x => x + 1);
    }, SYNC_INTERVAL);
    
    return () => {
      listeners.delete(listener);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);
  
  const getElapsedMs = useCallback((id: string): number => {
    const t = globalTimers[id];
    if (!t) return 0;
    const base = t.accMs || 0;
    if (t.running && t.startedAt) {
      return base + (Date.now() - t.startedAt);
    }
    return base;
  }, []);
  
  const isRunning = useCallback((id: string): boolean => {
    return globalTimers[id]?.running || false;
  }, []);
  
  const start = useCallback((id: string) => {
    const existing = globalTimers[id];
    globalTimers[id] = {
      accMs: existing?.accMs || 0,
      running: true,
      startedAt: Date.now(),
    };
    saveToStorage(globalTimers);
    notifyListeners();
  }, []);
  
  const pause = useCallback((id: string) => {
    const t = globalTimers[id];
    if (!t || !t.running) return;
    const elapsed = t.startedAt ? Date.now() - t.startedAt : 0;
    globalTimers[id] = {
      accMs: (t.accMs || 0) + elapsed,
      running: false,
    };
    saveToStorage(globalTimers);
    notifyListeners();
  }, []);
  
  const toggle = useCallback((id: string) => {
    if (globalTimers[id]?.running) {
      pause(id);
    } else {
      start(id);
    }
  }, [start, pause]);
  
  const clear = useCallback((id: string) => {
    delete globalTimers[id];
    saveToStorage(globalTimers);
    notifyListeners();
  }, []);
  
  const clearAll = useCallback(() => {
    globalTimers = {};
    saveToStorage(globalTimers);
    notifyListeners();
  }, []);
  
  return {
    timers: globalTimers,
    getElapsedMs,
    isRunning,
    start,
    pause,
    toggle,
    clear,
    clearAll,
  };
}

// Format milliseconds as MM:SS or HH:MM:SS
export function formatTimer(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Format minutes as Xh Ym
export function formatMinutes(min: number): string {
  const n = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
