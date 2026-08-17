"use client";

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { onSessionsChanged } from '@/lib/sessionsBus';
import type { StudySession } from '@/lib/types';

/** Shared session consumers use the canonical storage/API type, including
 * outline pages and practice-question counts used by the analytics view. */
export function useSessions() {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ sessions: StudySession[] }>(`/api/sessions`);
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load sessions');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const off = onSessionsChanged(() => { void refresh(); });
    return off;
  }, [refresh]);

  return { sessions, loading, error, refresh };
}
