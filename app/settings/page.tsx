"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { tasksClient } from '@/lib/tasksClient';
import { useSemester } from '@/lib/useSemester';

const SETTINGS = [
  'remindersEnabled',
  'remindersLeadHours',
  'dailyReminderTime',
  'minutesPerPage',
  'icsToken',
  'legacyMigrationV1',
].join(',');

export default function SettingsPage() {
  const { activeSemester } = useSemester();
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [leadHours, setLeadHours] = useState(24);
  const [dailyReminderTime, setDailyReminderTime] = useState('20:00');
  const [minutesPerPage, setMinutesPerPage] = useState(3);
  const [icsToken, setIcsToken] = useState('');
  const [legacyStatus, setLegacyStatus] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${SETTINGS}`);
        const settings = data.settings || {};
        setRemindersEnabled(Boolean(settings.remindersEnabled));
        setLeadHours(Number(settings.remindersLeadHours) || 24);
        setDailyReminderTime(settings.dailyReminderTime || '20:00');
        setMinutesPerPage(Number(settings.minutesPerPage) || 3);
        setIcsToken(settings.icsToken || '');
        setLegacyStatus(settings.legacyMigrationV1 || null);
      } catch {}
    })();
  }, []);

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH',
        body: {
          remindersEnabled,
          remindersLeadHours: Math.max(1, Math.min(168, leadHours)),
          dailyReminderTime,
          minutesPerPage: Math.max(0.5, Math.min(10, minutesPerPage)),
          icsToken: icsToken.trim() || null,
        },
      });
      try {
        window.localStorage.setItem('remindersEnabled', String(remindersEnabled));
        window.localStorage.setItem('remindersLeadHours', String(leadHours));
        window.localStorage.setItem('dailyReminderTime', dailyReminderTime);
        window.localStorage.setItem('minutesPerPage', String(minutesPerPage));
      } catch {}
      setMessage('Settings saved.');
    } catch {
      setMessage('Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function migrateLegacyData() {
    setSaving(true);
    setMessage('');
    try {
      const raw = window.localStorage.getItem('backlogItemsV1');
      const backlog = raw ? JSON.parse(raw) : [];
      const items = Array.isArray(backlog) ? backlog : [];
      let migrated = 0;
      for (const item of items) {
        if (!item?.title) continue;
        const due = item.dueDate ? new Date(`${item.dueDate}T23:59:59`) : new Date();
        await tasksClient.create({
          title: String(item.title),
          course: item.course || null,
          dueDate: due.toISOString(),
          status: 'todo',
          term: activeSemester?.id || null,
          estimatedMinutes: Number(item.estimatedMinutes) || null,
          priority: Number(item.priority) || null,
          tags: Array.isArray(item.tags) ? item.tags : ['legacy-import'],
          activity: 'other',
        }, { silent: true });
        migrated++;
      }

      const backup = {
        migratedAt: new Date().toISOString(),
        backlogItems: items,
        weekSchedule: window.localStorage.getItem('weekScheduleV1'),
        availabilityTemplate: window.localStorage.getItem('availabilityTemplateV1'),
      };
      window.localStorage.setItem('legacyTrackerBackupV1', JSON.stringify(backup));
      window.localStorage.removeItem('backlogItemsV1');
      window.localStorage.removeItem('weekScheduleV1');
      window.localStorage.removeItem('availabilityTemplateV1');

      const status = { migratedAt: backup.migratedAt, migratedTasks: migrated, backupStored: true };
      await apiFetch('/api/settings', { method: 'PATCH', body: { legacyMigrationV1: status } });
      setLegacyStatus(status);
      setMessage(`Migrated ${migrated} legacy task${migrated === 1 ? '' : 's'} and saved a browser backup.`);
    } catch {
      setMessage('Legacy data could not be migrated. No browser data was deleted.');
    } finally {
      setSaving(false);
    }
  }

  const exportUrl = icsToken ? `/api/export/ics?token=${encodeURIComponent(icsToken)}` : '/api/export/ics';

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
        <p className="text-sm font-medium text-slate-300">Settings</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-100">Only settings that affect the workflow</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Semester setup, course colors, Drive links, class schedules, and weekly availability now live where they are actually used.</p>
      </section>

      {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
          <h2 className="font-semibold text-slate-100">Notifications</h2>
          <p className="mt-1 text-sm text-slate-400">Use reminders for deadlines, not constant productivity nudges.</p>
          <div className="mt-4 space-y-4">
            <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-950/35 p-3">
              <input type="checkbox" checked={remindersEnabled} onChange={(event) => setRemindersEnabled(event.target.checked)} className="mt-1" />
              <span><span className="block text-sm font-medium text-slate-200">Enable task reminders</span><span className="block text-xs text-slate-500">Show reminders for upcoming assignments and exams.</span></span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-300"><span>Lead time in hours</span><input type="number" min={1} max={168} value={leadHours} onChange={(event) => setLeadHours(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /></label>
              <label className="text-sm text-slate-300"><span>Daily check time</span><input type="time" value={dailyReminderTime} onChange={(event) => setDailyReminderTime(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /></label>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
          <h2 className="font-semibold text-slate-100">Calendar and data</h2>
          <p className="mt-1 text-sm text-slate-400">Export remains simple and one-way. The tracker does not require a live calendar sync.</p>
          <div className="mt-4 space-y-3">
            <label className="block text-sm text-slate-300"><span>Private calendar token</span><input value={icsToken} onChange={(event) => setIcsToken(event.target.value)} placeholder="Optional" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600" /></label>
            <div className="flex flex-wrap gap-2">
              <a href={exportUrl} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Download calendar file</a>
              <a href="/api/tasks/export.csv" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Export tasks CSV</a>
              <Link href="/settings/import" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Import old data</Link>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
          <h2 className="font-semibold text-slate-100">Workflow shortcuts</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link href="/semester" className="rounded-lg border border-slate-700 bg-slate-950/35 p-4 hover:bg-slate-800"><p className="font-medium text-slate-200">Term Setup</p><p className="mt-1 text-xs text-slate-500">Active semester and rollover</p></Link>
            <Link href="/courses" className="rounded-lg border border-slate-700 bg-slate-950/35 p-4 hover:bg-slate-800"><p className="font-medium text-slate-200">Course Setup</p><p className="mt-1 text-xs text-slate-500">Schedule, color, documents, and exams</p></Link>
            <Link href="/week-plan" className="rounded-lg border border-slate-700 bg-slate-950/35 p-4 hover:bg-slate-800"><p className="font-medium text-slate-200">Plan My Week</p><p className="mt-1 text-xs text-slate-500">Availability and proposed study blocks</p></Link>
            <Link href="/help" className="rounded-lg border border-slate-700 bg-slate-950/35 p-4 hover:bg-slate-800"><p className="font-medium text-slate-200">Setup Guide</p><p className="mt-1 text-xs text-slate-500">Daily, weekly, and exam workflows</p></Link>
          </div>
        </section>

        <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
          <h2 className="font-semibold text-slate-100">Legacy cleanup</h2>
          <p className="mt-1 text-sm text-slate-400">Move browser-only backlog items into the real task system and retire the duplicate planner storage.</p>
          <div className="mt-4 rounded-lg bg-slate-950/35 p-3 text-sm text-slate-400">
            {legacyStatus ? <p>Migration completed on {new Date(legacyStatus.migratedAt).toLocaleDateString()}. {legacyStatus.migratedTasks || 0} tasks migrated.</p> : <p>Legacy browser data has not been migrated on this device.</p>}
          </div>
          <button disabled={saving || Boolean(legacyStatus)} onClick={migrateLegacyData} className="mt-3 rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">{legacyStatus ? 'Legacy migration complete' : 'Migrate legacy browser data'}</button>
        </section>
      </div>

      <details className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
        <summary className="cursor-pointer font-semibold text-slate-200">Advanced estimate setting</summary>
        <p className="mt-2 text-sm text-slate-400">The tracker learns from Study History. This fallback is used only when no better estimate exists.</p>
        <label className="mt-4 block max-w-xs text-sm text-slate-300"><span>Fallback minutes per page</span><input type="number" min={0.5} max={10} step={0.25} value={minutesPerPage} onChange={(event) => setMinutesPerPage(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /></label>
      </details>

      <button disabled={saving} onClick={save} className="rounded-lg bg-emerald-500 px-5 py-2.5 font-semibold text-slate-950 disabled:opacity-50">{saving ? 'Saving…' : 'Save settings'}</button>
    </main>
  );
}
