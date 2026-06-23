"use client";

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { onSessionsChanged } from '@/lib/sessionsBus';

export type Session = {
  id: string;
  taskId?: string | null;
  when: string;
  minutes: number;
  focus?: number | null;
  notes?: string | null;
  pagesRead?: number | null;
  outlinePages?: number | null;
  practiceQs?: number | null;
  activity?: string | null;
  createdAt?: string | null;
};

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ sessions: Session[] }>('/api/sessions');
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = onSessionsChanged(() => { void refresh(); });
    return off;
  }, [refresh]);

  return { sessions, loading, error, refresh };
}
