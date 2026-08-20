"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';

export type TaskTimerState = {
  accMs: number;
  running: boolean;
  startedAt?: number;
};

export type TaskTimerMap = Record<string, TaskTimerState>;

const LS_TIMERS = 'taskTimersV1';
const EVENT_NAME = 'app:task-timers-changed';

function readLocalTimers(): TaskTimerMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LS_TIMERS);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as TaskTimerMap : {};
  } catch {
    return {};
  }
}

function normalizeTimers(value: unknown): TaskTimerMap {
  if (!value || typeof value !== 'object') return {};
  const output: TaskTimerMap = {};
  for (const [taskId, raw] of Object.entries(value as Record<string, any>)) {
    if (!raw || typeof raw !== 'object') continue;
    const accMs = Math.max(0, Number(raw.accMs) || 0);
    const running = Boolean(raw.running);
    const startedAt = running && Number.isFinite(Number(raw.startedAt)) ? Number(raw.startedAt) : undefined;
    output[taskId] = { accMs, running, ...(startedAt ? { startedAt } : {}) };
  }
  return output;
}

export function useTaskTimers() {
  const [timers, setTimers] = useState<TaskTimerMap>(() => readLocalTimers());
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const response = await apiFetch<{ settings: Record<string, unknown> }>('/api/settings?keys=taskTimersV1');
        if (canceled) return;
        const server = normalizeTimers(response?.settings?.taskTimersV1);
        setTimers(Object.keys(server).length ? server : readLocalTimers());
      } catch {
        if (!canceled) setTimers(readLocalTimers());
      } finally {
        if (!canceled) setReady(true);
      }
    })();
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(LS_TIMERS, JSON.stringify(timers)); } catch {}
    try { window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: timers })); } catch {}
    const id = window.setTimeout(() => {
      void apiFetch('/api/settings', { method: 'PATCH', body: { taskTimersV1: timers } }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(id);
  }, [ready, timers]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LS_TIMERS || !event.newValue) return;
      try { setTimers(normalizeTimers(JSON.parse(event.newValue))); } catch {}
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!Object.values(timers).some(timer => timer.running)) return;
    const id = window.setInterval(() => setTick(value => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [timers]);

  const runningTaskId = useMemo(() => Object.entries(timers).find(([, timer]) => timer.running)?.[0] || null, [timers]);

  const elapsedMs = useCallback((taskId: string): number => {
    void tick;
    const timer = timers[taskId];
    if (!timer) return 0;
    return timer.accMs + (timer.running ? Math.max(0, Date.now() - (timer.startedAt || Date.now())) : 0);
  }, [tick, timers]);

  const toggleTimer = useCallback((taskId: string) => {
    setTimers(current => {
      const now = Date.now();
      const target = current[taskId] || { accMs: 0, running: false };
      if (target.running) {
        const elapsed = Math.max(0, now - (target.startedAt || now));
        return { ...current, [taskId]: { accMs: target.accMs + elapsed, running: false } };
      }

      const paused: TaskTimerMap = {};
      for (const [id, timer] of Object.entries(current)) {
        paused[id] = timer.running
          ? { accMs: timer.accMs + Math.max(0, now - (timer.startedAt || now)), running: false }
          : timer;
      }
      return { ...paused, [taskId]: { accMs: target.accMs, running: true, startedAt: now } };
    });
  }, []);

  const clearTimer = useCallback((taskId: string) => {
    setTimers(current => {
      if (!current[taskId]) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }, []);

  return { timers, ready, runningTaskId, elapsedMs, toggleTimer, clearTimer };
}
