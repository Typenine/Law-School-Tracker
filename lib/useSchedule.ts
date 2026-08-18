"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { onScheduleChanged, onAvailabilityChanged, notifyScheduleChanged, notifyAvailabilityChanged } from '@/lib/scheduleBus';
import { apiFetch } from '@/lib/apiClient';

export type ScheduledBlock = {
  id: string;
  taskId: string;
  day: string;
  plannedMinutes: number;
  guessed?: boolean;
  title: string;
  course: string;
  pages?: number | null;
  priority?: number | null;
  catchup?: boolean;
};

export type AvailabilityTemplate = Record<number, number>;

const LS_SCHEDULE = 'weekScheduleV1';
const LS_AVAIL = 'availabilityTemplateV1';
export const LS_SCHEDULE_DIRTY = 'weekScheduleDirtyV1';
const DEFAULT_AVAIL: AvailabilityTemplate = { 0:120,1:240,2:240,3:240,4:240,5:240,6:120 };

function normalizeAvailability(value: unknown): AvailabilityTemplate {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AVAIL };
  const raw = value as Record<string | number, unknown>;
  const next: AvailabilityTemplate = { ...DEFAULT_AVAIL };
  let hasPositiveCapacity = false;
  for (let day = 0; day < 7; day++) {
    const parsed = Number(raw[day] ?? raw[String(day)]);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    next[day] = parsed;
    if (parsed > 0) hasPositiveCapacity = true;
  }
  // A historical all-zero template means availability was never configured in
  // the old planner. Do not let it override the usable defaults forever. Once
  // any day has a positive capacity, explicit zero-capacity days are respected.
  return hasPositiveCapacity ? next : { ...DEFAULT_AVAIL };
}

// localStorage is now a read-through cache only. Postgres/server settings are
// authoritative. These helpers remain exported so older pages can keep their
// cache fallback without being able to make the cache outrank the server.
export function readLocalSchedule(): ScheduledBlock[] {
  if (typeof window === 'undefined') return [];
  try {
    const arr = JSON.parse(window.localStorage.getItem(LS_SCHEDULE) || '[]');
    return Array.isArray(arr) ? arr as ScheduledBlock[] : [];
  } catch { return []; }
}

export function writeLocalSchedule(blocks: ScheduledBlock[]): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LS_SCHEDULE, JSON.stringify(blocks)); } catch {}
}

// Dirty-state arbitration is intentionally retired. A local copy never wins
// over a reachable server anymore.
export function markScheduleDirty(): void {
  try { if (typeof window !== 'undefined') window.localStorage.removeItem(LS_SCHEDULE_DIRTY); } catch {}
}
export function clearScheduleDirty(): void {
  try { if (typeof window !== 'undefined') window.localStorage.removeItem(LS_SCHEDULE_DIRTY); } catch {}
}
export function isScheduleDirty(): boolean { return false; }

export function useSchedule() {
  const [blocks, setBlocksState] = useState<ScheduledBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const blocksRef = useRef<ScheduledBlock[]>([]);
  const saveSeq = useRef(0);

  const apply = useCallback((next: ScheduledBlock[]) => {
    blocksRef.current = next;
    setBlocksState(next);
    writeLocalSchedule(next);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ blocks: ScheduledBlock[] }>('/api/schedule');
      const next = Array.isArray(data?.blocks) ? data.blocks : [];
      apply(next);
      clearScheduleDirty();
    } catch {
      // Offline fallback only. Once the server is available refresh() replaces it.
      apply(readLocalSchedule());
    } finally { setLoading(false); }
  }, [apply]);

  useEffect(() => {
    void refresh();
    const off = onScheduleChanged(() => { void refresh(); });
    return off;
  }, [refresh]);

  const save = useCallback((updater: ScheduledBlock[] | ((prev: ScheduledBlock[]) => ScheduledBlock[])) => {
    const next = typeof updater === 'function'
      ? (updater as (prev: ScheduledBlock[]) => ScheduledBlock[])(blocksRef.current)
      : updater;
    const previous = blocksRef.current;
    apply(next);
    const seq = ++saveSeq.current;
    void apiFetch('/api/schedule', { method: 'PUT', body: { blocks: next } })
      .then(() => {
        if (seq !== saveSeq.current) return;
        clearScheduleDirty();
        try { notifyScheduleChanged(); } catch {}
      })
      .catch(() => {
        if (seq !== saveSeq.current) return;
        // The service worker now returns failure for offline writes; revert the
        // optimistic state rather than pretending a local mutation is durable.
        apply(previous);
        try { notifyScheduleChanged(); } catch {}
      });
  }, [apply]);

  const hydrate = useCallback((next: ScheduledBlock[]) => {
    apply(next);
    clearScheduleDirty();
  }, [apply]);

  return { blocks, setBlocks: save, hydrate, loading, refresh };
}

export function useAvailability() {
  const [availability, setAvailabilityState] = useState<AvailabilityTemplate>(DEFAULT_AVAIL);
  const [loading, setLoading] = useState(true);
  const availabilityRef = useRef<AvailabilityTemplate>(DEFAULT_AVAIL);
  const saveSeq = useRef(0);

  const apply = useCallback((value: unknown) => {
    const next = normalizeAvailability(value);
    availabilityRef.current = next;
    setAvailabilityState(next);
    try { if (typeof window !== 'undefined') window.localStorage.setItem(LS_AVAIL, JSON.stringify(next)); } catch {}
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ settings: Record<string, unknown> }>('/api/settings?keys=availabilityTemplateV1');
      apply(data?.settings?.availabilityTemplateV1);
    } catch {
      try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem(LS_AVAIL) : null;
        apply(raw ? JSON.parse(raw) : DEFAULT_AVAIL);
      } catch { apply(DEFAULT_AVAIL); }
    } finally { setLoading(false); }
  }, [apply]);

  useEffect(() => {
    void refresh();
    const off = onAvailabilityChanged(() => { void refresh(); });
    return off;
  }, [refresh]);

  const save = useCallback((updater: AvailabilityTemplate | ((prev: AvailabilityTemplate) => AvailabilityTemplate)) => {
    const rawNext = typeof updater === 'function'
      ? (updater as (prev: AvailabilityTemplate) => AvailabilityTemplate)(availabilityRef.current)
      : updater;
    const next = normalizeAvailability(rawNext);
    if (JSON.stringify(next) === JSON.stringify(availabilityRef.current)) return;
    const previous = availabilityRef.current;
    apply(next);
    const seq = ++saveSeq.current;
    void apiFetch('/api/settings', { method: 'PATCH', body: { availabilityTemplateV1: next } })
      .then(() => {
        if (seq !== saveSeq.current) return;
        try { notifyAvailabilityChanged(); } catch {}
      })
      .catch(() => {
        if (seq !== saveSeq.current) return;
        apply(previous);
        try { notifyAvailabilityChanged(); } catch {}
      });
  }, [apply]);

  return { availability, setAvailability: save, loading, refresh };
}
