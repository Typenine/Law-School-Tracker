"use client";

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { useSemester } from '@/lib/useSemester';

type Status = {
  configured: boolean;
  connected: boolean;
  calendarId?: string;
  calendarName?: string;
  lastSyncedAt?: string;
  lastSyncSummary?: { created?: number; updated?: number; removed?: number; imported?: number };
  error?: string;
};

export default function GoogleCalendarPanel({ onSynced }: { onSynced?: () => void | Promise<void> }) {
  const { activeSemester } = useSemester();
  const [status, setStatus] = useState<Status | null>(null);
  const [timezone, setTimezone] = useState('America/Chicago');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');

  async function loadStatus() {
    try {
      setStatus(await apiFetch<Status>('/api/google-calendar/status'));
    } catch (error: any) {
      setStatus({ configured: false, connected: false, error: error?.message || 'Unable to read Google Calendar status.' });
    }
  }

  useEffect(() => {
    void loadStatus();
    const result = new URLSearchParams(window.location.search).get('calendar');
    if (result === 'connected') setMessage('Google Calendar connected. Run the first sync below.');
    if (result === 'denied') setMessage('Google Calendar access was not granted.');
    if (result === 'invalid_state') setMessage('The Google authorization response could not be verified. Try connecting again.');
    if (result === 'error') setMessage('Google Calendar could not be connected. Check the OAuth configuration.');
  }, []);

  async function sync() {
    setWorking(true);
    setMessage('');
    try {
      const response = await apiFetch<{ result: { created: number; updated: number; removed: number; imported: number } }>('/api/google-calendar/sync', {
        method: 'POST',
        body: {
          timezone,
          timeMin: activeSemester ? new Date(`${activeSemester.startDate}T00:00:00`).toISOString() : undefined,
          timeMax: activeSemester ? new Date(`${activeSemester.endDate}T23:59:59`).toISOString() : undefined,
        },
      });
      const result = response.result;
      setMessage(`Sync complete: ${result.created} created, ${result.updated} updated, ${result.removed} removed, and ${result.imported} Google events imported.`);
      await loadStatus();
      await onSynced?.();
    } catch (error: any) {
      setMessage(error?.message || 'Google Calendar sync failed.');
    } finally {
      setWorking(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Google Calendar? Existing Google events will remain, but future syncs will stop.')) return;
    setWorking(true);
    try {
      await apiFetch('/api/google-calendar/disconnect', { method: 'POST' });
      setMessage('Google Calendar disconnected.');
      await loadStatus();
    } finally {
      setWorking(false);
    }
  }

  if (!status) return <div className="rounded-xl border border-slate-700 p-4 text-sm text-slate-400">Checking Google Calendar…</div>;

  return (
    <section className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-sky-300">Google Calendar</p>
          <h2 className="mt-1 font-semibold text-slate-100">Two-way calendar sync</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Tracker tasks, course meetings, and commitments are pushed to Google. Outside Google events are imported into this agenda. Unrelated Google events are never deleted.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{status.connected ? 'Connected' : status.configured ? 'Not connected' : 'Setup required'}</span>
      </div>

      {message ? <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950/45 p-3 text-sm text-slate-300">{message}</div> : null}

      {!status.configured ? (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI, and GOOGLE_CALENDAR_TOKEN_KEY to the deployment environment before connecting.
        </div>
      ) : null}

      {status.connected ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs uppercase text-slate-500">Calendar</p><p className="mt-1 text-sm text-slate-200">{status.calendarName || status.calendarId || 'Primary calendar'}</p></div>
            <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs uppercase text-slate-500">Last sync</p><p className="mt-1 text-sm text-slate-200">{status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'Not synced yet'}</p></div>
          </div>
          <label className="block max-w-sm text-sm text-slate-300">Academic timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /></label>
          <div className="flex flex-wrap gap-2"><button disabled={working} onClick={sync} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{working ? 'Syncing…' : 'Sync now'}</button><button disabled={working} onClick={disconnect} className="rounded-lg border border-rose-500/40 px-4 py-2 text-sm text-rose-300 disabled:opacity-50">Disconnect</button></div>
        </div>
      ) : status.configured ? (
        <a href="/api/google-calendar/auth" className="mt-4 inline-flex rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950">Connect Google Calendar</a>
      ) : null}
    </section>
  );
}
