'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { notifyToast } from '@/lib/toastBus';

type Semester = { id: string; name: string; isActive?: boolean };
type Archive = { id: string; semesterId: string | null; name: string; createdAt: string; exportedAt: string };

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ArchivePage() {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [semesterId, setSemesterId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  async function refresh() {
    const [semesterData, archiveData] = await Promise.all([
      apiFetch<{ semesters: Semester[] }>('/api/semesters'),
      apiFetch<{ archives: Archive[] }>('/api/workspace/archives'),
    ]);
    const list = Array.isArray(semesterData?.semesters) ? semesterData.semesters : [];
    setSemesters(list);
    setArchives(Array.isArray(archiveData?.archives) ? archiveData.archives : []);
    const active = list.find(item => item.isActive);
    if (!semesterId && active) {
      setSemesterId(active.id);
      if (!name) setName(`${active.name} archive`);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function exportBackup() {
    setBusy(true);
    try {
      const res = await fetch('/api/workspace/backup', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      downloadJson(data, `law-school-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`);
      notifyToast({ kind: 'success', message: 'Workspace backup downloaded.' });
    } catch {
      notifyToast({ kind: 'error', message: 'Unable to create the workspace backup.' });
    } finally { setBusy(false); }
  }

  async function createArchive() {
    const label = name.trim();
    if (!label) return;
    setBusy(true);
    try {
      await apiFetch('/api/workspace/archives', { method: 'POST', body: { name: label, semesterId: semesterId || null } });
      await refresh();
      notifyToast({ kind: 'success', message: 'Semester archive created.' });
    } catch {
      notifyToast({ kind: 'error', message: 'Unable to create the archive.' });
    } finally { setBusy(false); }
  }

  async function restoreUpload() {
    if (!restoreFile) return;
    if (!confirm('Restore this backup into the current workspace? Existing records with the same IDs will be updated.')) return;
    setBusy(true);
    try {
      const json = JSON.parse(await restoreFile.text());
      await apiFetch('/api/workspace/backup', { method: 'POST', body: { backup: json } });
      notifyToast({ kind: 'success', message: 'Workspace backup restored.' });
      setRestoreFile(null);
      await refresh();
    } catch {
      notifyToast({ kind: 'error', message: 'The backup could not be restored.' });
    } finally { setBusy(false); }
  }

  async function restoreArchive(archive: Archive) {
    if (!confirm(`Restore “${archive.name}” into the current workspace? Existing records with the same IDs will be updated.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/workspace/archives/${archive.id}`, { method: 'POST' });
      notifyToast({ kind: 'success', message: 'Archive restored.' });
    } catch {
      notifyToast({ kind: 'error', message: 'Unable to restore the archive.' });
    } finally { setBusy(false); }
  }

  async function removeArchive(archive: Archive) {
    if (!confirm(`Delete the saved archive “${archive.name}”?`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/workspace/archives/${archive.id}`, { method: 'DELETE' });
      await refresh();
      notifyToast({ kind: 'success', message: 'Archive deleted.' });
    } catch {
      notifyToast({ kind: 'error', message: 'Unable to delete the archive.' });
    } finally { setBusy(false); }
  }

  return (
    <main className="space-y-5">
      <section className="card p-5">
        <h2 className="text-xl font-medium">Workspace backup</h2>
        <p className="mt-1 text-sm text-slate-400">Download the durable tracker data as JSON. Restores merge by record ID, so the backup can repair or recreate missing data without requiring a database reset.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button disabled={busy} onClick={exportBackup} className="px-3 py-2 rounded bg-blue-600 disabled:opacity-50">Download full backup</button>
          <label className="px-3 py-2 rounded border border-white/10 cursor-pointer">
            Choose backup
            <input type="file" accept="application/json,.json" className="hidden" onChange={e => setRestoreFile(e.target.files?.[0] || null)} />
          </label>
          {restoreFile ? <button disabled={busy} onClick={restoreUpload} className="px-3 py-2 rounded border border-amber-500/40 text-amber-200">Restore {restoreFile.name}</button> : null}
        </div>
      </section>

      <section className="card p-5 space-y-4">
        <div>
          <h2 className="text-xl font-medium">Semester archives</h2>
          <p className="mt-1 text-sm text-slate-400">Freeze a labeled snapshot before moving on to the next semester. Archives stay available independently of the active-semester view.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-end">
          <label className="text-sm">Semester
            <select value={semesterId} onChange={e => {
              const id = e.target.value;
              setSemesterId(id);
              const sem = semesters.find(item => item.id === id);
              if (sem) setName(`${sem.name} archive`);
            }} className="mt-1 w-full px-3 py-2">
              <option value="">Unlabeled snapshot</option>
              {semesters.map(sem => <option key={sem.id} value={sem.id}>{sem.name}{sem.isActive ? ' — active' : ''}</option>)}
            </select>
          </label>
          <label className="text-sm">Archive name
            <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full px-3 py-2" placeholder="Fall 2026 final archive" />
          </label>
          <button disabled={busy || !name.trim()} onClick={createArchive} className="px-3 py-2 rounded bg-blue-600 disabled:opacity-50">Create archive</button>
        </div>

        <div className="divide-y divide-white/10 rounded border border-white/10">
          {archives.length === 0 ? <div className="p-4 text-sm text-slate-400">No saved archives yet.</div> : archives.map(archive => (
            <div key={archive.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium">{archive.name}</div>
                <div className="text-xs text-slate-400">Created {new Date(archive.createdAt).toLocaleString()}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`/api/workspace/archives/${archive.id}`} className="px-2.5 py-1.5 rounded border border-white/10 text-xs">Download</a>
                <button disabled={busy} onClick={() => restoreArchive(archive)} className="px-2.5 py-1.5 rounded border border-white/10 text-xs">Restore</button>
                <button disabled={busy} onClick={() => removeArchive(archive)} className="px-2.5 py-1.5 rounded border border-rose-500/30 text-rose-300 text-xs">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
