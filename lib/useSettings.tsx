"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { onSettingsChanged, notifySettingsChanged } from '@/lib/settingsBus';

export type SettingsMap = Record<string, any>;

type Ctx = {
  settings: SettingsMap;
  get: <T = any>(key: string, fallback?: T) => T;
  set: (patch: SettingsMap) => Promise<void>;
  refresh: () => Promise<void>;
  loading: boolean;
  error: string | null;
};

const SettingsContext = createContext<Ctx | null>(null);

const DEFAULT_KEYS = [
  'minutesPerPage',
  'calendarDensity',
  'icsToken',
  'taskTimersV1',
];

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const qs = `?keys=${encodeURIComponent(DEFAULT_KEYS.join(','))}`;
      const data = await apiFetch<{ settings: SettingsMap }>(`/api/settings${qs}`);
      setSettings(data?.settings || {});
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = onSettingsChanged(() => { void refresh(); });
    return off;
  }, [refresh]);

  const set = useCallback(async (patch: SettingsMap) => {
    try {
      await apiFetch('/api/settings', { method: 'PATCH', body: patch });
      setSettings(prev => ({ ...prev, ...patch }));
      try { notifySettingsChanged(); } catch {}
    } catch (e) {
      // keep previous settings on error
      throw e;
    }
  }, []);

  const get = useCallback(<T = any,>(key: string, fallback?: T) => {
    const v = settings[key];
    return (v === undefined ? (fallback as any) : v) as T;
  }, [settings]);

  const value = useMemo<Ctx>(() => ({ settings, get, set, refresh, loading, error }), [settings, get, set, refresh, loading, error]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
