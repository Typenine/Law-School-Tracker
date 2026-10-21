"use client";

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { onSessionsChanged } from '@/lib/sessionsBus';
import type { StudySession } from '@/lib/types';
// Share concurrent session requests, but never persist stale study totals.
let request: Promise<StudySession[]> | null = null;
async function readSessions(): Promise<StudySession[]> {
  if (!request) request = apiFetch<{ sessions: StudySession[] }>('/api/sessions')
    .then(result => Array.isArray(result.sessions) ? result.sessions : [])
    .finally(() => { request = null; });
  return request;
}

/** Shared session consumers use the canonical storage/API type, including
 * outline pages and practice-question counts used by the analytics view. */
export function useSessions() {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await readSessions());
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
