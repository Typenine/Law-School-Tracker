"use client";

import { useCallback, useEffect, useState } from 'react';
import type { ResolvedTerm } from '@/lib/semester';
import { onSemesterChanged } from '@/lib/semesterBus';

/**
 * The current academic term, resolved server-side from the configured
 * semesters (or the calendar when none are set up). Refreshes when semesters
 * change and once an hour, so a term that ends overnight rolls over without a
 * reload.
 */
export function useTerm() {
  const [term, setTerm] = useState<ResolvedTerm | null>(null);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/semesters/current', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.term) { setTerm(data.term as ResolvedTerm); setLabel(String(data.label || '')); }
    } catch {
      // Leave the previous value in place; the label is decoration, not data.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = onSemesterChanged(() => { void refresh(); });
    const timer = window.setInterval(() => { void refresh(); }, 3_600_000);
    return () => { off(); window.clearInterval(timer); };
  }, [refresh]);

  return { term, label, loading, refresh };
}
