"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { onScheduleChanged, onAvailabilityChanged, notifyScheduleChanged, notifyAvailabilityChanged } from '@/lib/scheduleBus';

export type ScheduledBlock = {
  id: string;
  taskId: string;
  day: string; // YYYY-MM-DD
  plannedMinutes: number;
  guessed?: boolean;
  title: string;
  course: string;
  pages?: number | null;
  priority?: number | null;
  catchup?: boolean;
};

export type AvailabilityTemplate = Record<number, number>; // 0..6 => minutes

const LS_SCHEDULE = 'weekScheduleV1';
const LS_AVAIL = 'availabilityTemplateV1';
/** Set while local schedule edits have not been confirmed by the server yet. */
export const LS_SCHEDULE_DIRTY = 'weekScheduleDirtyV1';

export function readLocalSchedule(): ScheduledBlock[] {
  if (typeof window === 'undefined') return [];
  try {
    const arr = JSON.parse(window.localStorage.getItem(LS_SCHEDULE) || '[]');
    return Array.isArray(arr) ? (arr as ScheduledBlock[]) : [];
  } catch {
    return [];
  }
}

export function writeLocalSchedule(blocks: ScheduledBlock[]): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LS_SCHEDULE, JSON.stringify(blocks)); } catch {}
}

export function markScheduleDirty(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LS_SCHEDULE_DIRTY, '1'); } catch {}
}

export function clearScheduleDirty(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(LS_SCHEDULE_DIRTY); } catch {}
}

export function isScheduleDirty(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(LS_SCHEDULE_DIRTY) === '1'; } catch { return false; }
}

export function useSchedule() {
  const [blocks, setBlocksState] = useState<ScheduledBlock[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  // Mirrors `blocks` so `save` can compute the next value without nesting a
  // state update inside another state updater.
  const blocksRef = useRef<ScheduledBlock[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = readLocalSchedule();
      // Skip the re-render when the notification came from our own save.
      if (JSON.stringify(next) !== JSON.stringify(blocksRef.current)) {
        blocksRef.current = next;
        setBlocksState(next);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and subscriptions
  useEffect(() => {
    void refresh();
    const off = onScheduleChanged(() => { void refresh(); });
    return off;
  }, [refresh]);

  const save = useCallback((updater: ScheduledBlock[] | ((prev: ScheduledBlock[]) => ScheduledBlock[])) => {
    const next = typeof updater === 'function'
      ? (updater as (p: ScheduledBlock[]) => ScheduledBlock[])(blocksRef.current)
      : updater;
    blocksRef.current = next;
    writeLocalSchedule(next);
    markScheduleDirty();
    setBlocksState(next);
    try { notifyScheduleChanged(); } catch {}
  }, []);

  /** Replace state from the server without marking the schedule dirty. */
  const hydrate = useCallback((next: ScheduledBlock[]) => {
    blocksRef.current = next;
    writeLocalSchedule(next);
    setBlocksState(next);
    try { notifyScheduleChanged(); } catch {}
  }, []);

  return { blocks, setBlocks: save, hydrate, loading, refresh };
}

export function useAvailability() {
  const [availability, setAvailabilityState] = useState<AvailabilityTemplate>({ 0:120,1:240,2:240,3:240,4:240,5:240,6:120 });
  const [loading, setLoading] = useState<boolean>(true);
  const availabilityRef = useRef<AvailabilityTemplate>({ 0:120,1:240,2:240,3:240,4:240,5:240,6:120 });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (typeof window !== 'undefined') {
        try {
          const obj = JSON.parse(window.localStorage.getItem(LS_AVAIL) || '{}') || {};
          if (JSON.stringify(obj) !== JSON.stringify(availabilityRef.current)) {
            availabilityRef.current = obj as AvailabilityTemplate;
            setAvailabilityState(obj as AvailabilityTemplate);
          }
        } catch {}
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const off = onAvailabilityChanged(() => { void refresh(); });
    return off;
  }, [refresh]);

  const save = useCallback((updater: AvailabilityTemplate | ((prev: AvailabilityTemplate) => AvailabilityTemplate)) => {
    const next = typeof updater === 'function'
      ? (updater as (p: AvailabilityTemplate) => AvailabilityTemplate)(availabilityRef.current)
      : updater;
    if (JSON.stringify(next) === JSON.stringify(availabilityRef.current)) return;
    availabilityRef.current = next;
    try { if (typeof window !== 'undefined') window.localStorage.setItem(LS_AVAIL, JSON.stringify(next)); } catch {}
    setAvailabilityState(next);
    try { notifyAvailabilityChanged(); } catch {}
  }, []);

  return { availability, setAvailability: save, loading, refresh };
}
