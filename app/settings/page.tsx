"use client";
import { useEffect, useMemo, useState } from 'react';

function getLocalNumber(key: string, fallback: number) {
  if (typeof window === 'undefined') return fallback;
  const s = window.localStorage.getItem(key);
  const n = s ? parseFloat(s) : NaN;
  return !isNaN(n) ? n : fallback;
}

function getLocalBool(key: string, fallback: boolean) {
  if (typeof window === 'undefined') return fallback;
  const s = window.localStorage.getItem(key);
  return s === null ? fallback : s === 'true';
}

function getCourseMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const s = window.localStorage.getItem('courseMppMap');
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

export default function SettingsPage() {
  const [minutesPerPage, setMinutesPerPage] = useState<number>(3);
  const [defaultFocus, setDefaultFocus] = useState<number>(5);
  const [remindersEnabled, setRemindersEnabled] = useState<boolean>(false);
  const [remindersLeadHours, setRemindersLeadHours] = useState<number>(24);
  const [heavyDayThreshold, setHeavyDayThreshold] = useState<number>(240);
  const [currentTerm, setCurrentTerm] = useState<string>('');
  const [icsToken, setIcsToken] = useState<string>('');
  const [map, setMap] = useState<Record<string, number>>({});
  const [courseKey, setCourseKey] = useState('');
  const [courseMpp, setCourseMpp] = useState<string>('');

  useEffect(() => {
    setMinutesPerPage(getLocalNumber('minutesPerPage', 3));
    setDefaultFocus(getLocalNumber('defaultFocus', 5));
    setRemindersEnabled(getLocalBool('remindersEnabled', false));
    setRemindersLeadHours(getLocalNumber('remindersLeadHours', 24));
    setHeavyDayThreshold(getLocalNumber('heavyDayThreshold', 240));
    if (typeof window !== 'undefined') setCurrentTerm(window.localStorage.getItem('currentTerm') || '');
    if (typeof window !== 'undefined') setIcsToken(window.localStorage.getItem('icsToken') || '');
    setMap(getCourseMap());
  }, []);

  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem('minutesPerPage', String(minutesPerPage)); }, [minutesPerPage]);
  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem('defaultFocus', String(defaultFocus)); }, [defaultFocus]);
  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem('remindersEnabled', String(remindersEnabled)); }, [remindersEnabled]);
  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem('remindersLeadHours', String(remindersLeadHours)); }, [remindersLeadHours]);
  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem('heavyDayThreshold', String(heavyDayThreshold)); }, [heavyDayThreshold]);
  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem('currentTerm', currentTerm); }, [currentTerm]);
  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem('icsToken', icsToken); }, [icsToken]);
  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem('courseMppMap', JSON.stringify(map)); }, [map]);

  function addCourseMap() {
    const key = courseKey.trim();
    const n = parseInt(courseMpp, 10);
    if (!key || isNaN(n) || n <= 0) return;
    setMap(prev => ({ ...prev, [key]: n }));
    setCourseKey('');
    setCourseMpp('');
  }

  function removeCourseKey(k: string) {
    const next = { ...map };
    delete next[k];
    setMap(next);
  }

  const entries = useMemo(() => Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])), [map]);

  return (
    <main className="space-y-6">
      <section className="card p-5">
        <h2 className="text-lg font-medium mb-3">Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Default minutes per page</label>
            <input type="number" min={1} step={1} value={minutesPerPage} onChange={e => setMinutesPerPage(parseInt(e.target.value || '1', 10))} className="w-40 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            <p className="text-xs text-slate-300/70 mt-1">Used by the syllabus parser when estimating reading time.</p>
          </div>
          <div>
            <label className="block text-sm mb-1">Default focus (1-10)</label>
            <input type="number" min={1} max={10} step={1} value={defaultFocus} onChange={e => setDefaultFocus(parseInt(e.target.value || '1', 10))} className="w-40 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            <p className="text-xs text-slate-300/70 mt-1">Used by Focus Timer and Session Logger.</p>
          </div>
          <div>
            <label className="block text-sm mb-1">Heavy day threshold (minutes)</label>
            <input type="number" min={60} step={30} value={heavyDayThreshold} onChange={e => setHeavyDayThreshold(parseInt(e.target.value || '240', 10))} className="w-40 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            <p className="text-xs text-slate-300/70 mt-1">Used to color bars in the weekly forecast and count heavy days. Date-only; no times.</p>
          </div>
          <div>
            <label className="block text-sm mb-1">Current term (e.g., Fall 2025)</label>
            <input value={currentTerm} onChange={e => setCurrentTerm(e.target.value)} placeholder="e.g., Fall 2025" className="w-60 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            <p className="text-xs text-slate-300/70 mt-1">Views can filter by this term. Tasks can store a term field.</p>
          </div>
          <div>
            <label className="block text-sm mb-1">Reminders</label>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={remindersEnabled} onChange={e => setRemindersEnabled(e.target.checked)} /> Enable reminders</label>
              <div className="inline-flex items-center gap-2">
                <span className="text-sm text-slate-300/80">Lead (hours)</span>
                <input type="number" min={1} step={1} value={remindersLeadHours} onChange={e => setRemindersLeadHours(parseInt(e.target.value || '1', 10))} className="w-24 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
              </div>
            </div>
            <p className="text-xs text-slate-300/70 mt-1">Show in-app reminders for tasks due within the lead time.</p>
          </div>
          <div>
            <label className="block text-sm mb-1">ICS token (optional)</label>
            <input value={icsToken} onChange={e => setIcsToken(e.target.value)} placeholder="Token used to validate /api/export/ics" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            <p className="text-xs text-slate-300/70 mt-1">If your server requires a token (ICS_PRIVATE_TOKEN), this is appended to the download link.</p>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h3 className="font-medium mb-3">Per-course minutes per page</h3>
        <div className="flex flex-col md:flex-row gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm mb-1">Course name</label>
            <input value={courseKey} onChange={e => setCourseKey(e.target.value)} placeholder="e.g., Contracts" className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm mb-1">Minutes per page</label>
            <input type="number" min={1} step={1} value={courseMpp} onChange={e => setCourseMpp(e.target.value)} className="w-40 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
          </div>
          <button onClick={addCourseMap} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500">Add/Update</button>
        </div>
        <div className="mt-4 space-y-2">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-300/70">No course-specific overrides.</p>
          ) : entries.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between border border-[#1b2344] rounded px-3 py-2">
              <div className="text-sm">{k} → {v} min/page</div>
              <button onClick={() => removeCourseKey(k)} className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500">Remove</button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
