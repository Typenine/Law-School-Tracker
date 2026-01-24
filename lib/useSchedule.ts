"use client";

import { useCallback, useEffect, useState } from 'react';
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

export function useSchedule() {
  const [blocks, setBlocksState] = useState<ScheduledBlock[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // LocalStorage is the source of truth
      if (typeof window !== 'undefined') {
        try { const raw = window.localStorage.getItem(LS_SCHEDULE) || '[]'; const arr = JSON.parse(raw); if (Array.isArray(arr)) setBlocksState(arr as ScheduledBlock[]); } catch {}
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
    setBlocksState(prev => {
      const next = typeof updater === 'function' ? (updater as (p: ScheduledBlock[]) => ScheduledBlock[])(prev) : updater;
      try { if (typeof window !== 'undefined') window.localStorage.setItem(LS_SCHEDULE, JSON.stringify(next)); } catch {}
      try { notifyScheduleChanged(); } catch {}
      return next;
    });
  }, []);

  return { blocks, setBlocks: save, loading, refresh };
}

export function useAvailability() {
  const [availability, setAvailabilityState] = useState<AvailabilityTemplate>({ 0:120,1:240,2:240,3:240,4:240,5:240,6:120 });
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (typeof window !== 'undefined') {
        try { const raw = window.localStorage.getItem(LS_AVAIL) || '{}'; const obj = JSON.parse(raw) || {}; setAvailabilityState(obj as AvailabilityTemplate); } catch {}
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const off = onAvailabilityChanged(() => { void refresh(); });
    return off;
  }, [refresh]);

  const save = useCallback((updater: AvailabilityTemplate | ((prev: AvailabilityTemplate) => AvailabilityTemplate)) => {
    setAvailabilityState(prev => {
      const next = typeof updater === 'function' ? (updater as (p: AvailabilityTemplate) => AvailabilityTemplate)(prev) : updater;
      try { if (typeof window !== 'undefined') window.localStorage.setItem(LS_AVAIL, JSON.stringify(next)); } catch {}
      try { notifyAvailabilityChanged(); } catch {}
      return next;
    });
  }, []);

  return { availability, setAvailability: save, loading, refresh };
}
