"use client";

import { useEffect, useMemo, useState } from "react";
import type { WindowsByDow, BreaksByDow, SemesterInfo } from '@/lib/types';
import { notifySemesterChanged } from '@/lib/semesterBus';
import { apiFetch } from '@/lib/apiClient';
import { notifyToast } from '@/lib/toastBus';
import { fallbackCourseColor } from '@/lib/colors';

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
const emptyWindows = (): WindowsByDow => ({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] });
const emptyBreaks = (): BreaksByDow => ({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] });

export default function SettingsPage() {
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [remindersLeadHours, setRemindersLeadHours] = useState("24");
  const [minutesPerPage, setMinutesPerPage] = useState("3");
  const [defaultFocus, setDefaultFocus] = useState("5");
  const [icsToken, setIcsToken] = useState("");
  const [nudgesEnabled, setNudgesEnabled] = useState(false);
  const [dailyReminderTime, setDailyReminderTime] = useState("20:00");
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("07:00");
  const [maxNudgesPerWeek, setMaxNudgesPerWeek] = useState("3");
  const [preferencesSaving, setPreferencesSaving] = useState(false);

  const [courses, setCourses] = useState<any[]>([]);
  const [courseColors, setCourseColors] = useState<Record<string,string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [internshipColor, setInternshipColor] = useState(fallbackCourseColor('Internship'));
  const [sportsLawReviewColor, setSportsLawReviewColor] = useState(fallbackCourseColor('Sports Law Review'));

  const [windowsByDow, setWindowsByDow] = useState<WindowsByDow>(emptyWindows);
  const [breaksByDow, setBreaksByDow] = useState<BreaksByDow>(emptyBreaks);
  const [availSaving, setAvailSaving] = useState(false);

  const [semesters, setSemesters] = useState<SemesterInfo[]>([]);
  const [activeSemesterId, setActiveSemesterId] = useState<string | null>(null);
  const [newSemester, setNewSemester] = useState<{
    name: string; season: 'Spring' | 'Summer' | 'Fall' | 'Winter'; year: string;
    startDate: string; endDate: string; makeActive: boolean;
  }>({ name: '', season: 'Fall', year: String(new Date().getFullYear()), startDate: '', endDate: '', makeActive: true });
  const [creatingSemester, setCreatingSemester] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [settingsData, courseData, semesterData] = await Promise.all([
          apiFetch<{ settings: Record<string, any> }>('/api/settings'),
          apiFetch<{ courses: any[] }>('/api/courses'),
          apiFetch<{ semesters: SemesterInfo[] }>('/api/semesters'),
        ]);
        if (cancelled) return;
        const s = settingsData?.settings || {};
        if (typeof s.remindersEnabled === 'boolean') setRemindersEnabled(s.remindersEnabled);
        if (s.remindersLeadHours != null) setRemindersLeadHours(String(Math.max(1, Number(s.remindersLeadHours) || 24)));
        if (s.minutesPerPage != null) setMinutesPerPage(String(Math.max(1, Math.round(Number(s.minutesPerPage) || 3))));
        if (s.defaultFocus != null) setDefaultFocus(String(Math.min(10, Math.max(1, Math.round(Number(s.defaultFocus) || 5)))));
        if (typeof s.icsToken === 'string') setIcsToken(s.icsToken);
        if (typeof s.nudgesEnabled === 'boolean') setNudgesEnabled(s.nudgesEnabled);
        if (typeof s.nudgesReminderTime === 'string') setDailyReminderTime(s.nudgesReminderTime);
        if (typeof s.nudgesQuietStart === 'string') setQuietStart(s.nudgesQuietStart);
        if (typeof s.nudgesQuietEnd === 'string') setQuietEnd(s.nudgesQuietEnd);
        if (s.nudgesMaxPerWeek != null) setMaxNudgesPerWeek(String(Math.max(0, Number(s.nudgesMaxPerWeek) || 0)));
        if (typeof s.internshipColor === 'string' && s.internshipColor) setInternshipColor(s.internshipColor);
        if (typeof s.sportsLawReviewColor === 'string' && s.sportsLawReviewColor) setSportsLawReviewColor(s.sportsLawReviewColor);
        if (s.availabilityWindowsV1) setWindowsByDow(s.availabilityWindowsV1);
        if (s.availabilityBreaksV1) setBreaksByDow(s.availabilityBreaksV1);

        const list = Array.isArray(courseData?.courses) ? courseData.courses : [];
        setCourses(list);
        const colors: Record<string,string> = {};
        for (const course of list) colors[course.id] = course.color || fallbackCourseColor(course.title);
        setCourseColors(colors);

        const semesterList = Array.isArray(semesterData?.semesters) ? semesterData.semesters : [];
        setSemesters(semesterList);
        setActiveSemesterId(semesterList.find(item => item.isActive)?.id || null);
      } catch (error: any) {
        notifyToast({ kind: 'error', message: error?.message || 'Unable to load settings.' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const classTimesByDow = useMemo(() => {
    const result: Record<number, Array<{ start: string; end: string; course: string }>> = { 0:[],1:[],2:[],3:[],4:[],5:[],6:[] };
    for (const course of courses) {
      const blocks = Array.isArray(course.meetingBlocks) && course.meetingBlocks.length
        ? course.meetingBlocks
        : (Array.isArray(course.meetingDays) && course.meetingStart && course.meetingEnd
          ? [{ days: course.meetingDays, start: course.meetingStart, end: course.meetingEnd }]
          : []);
      for (const block of blocks) {
        if (!Array.isArray(block.days)) continue;
        for (const dow of block.days) {
          if (block.start && block.end) result[dow].push({ start: block.start, end: block.end, course: course.title || course.code || 'Class' });
        }
      }
    }
    return result;
  }, [courses]);

  async function savePreferences() {
    setPreferencesSaving(true);
    try {
      await apiFetch('/api/settings', { method: 'PATCH', body: {
        remindersEnabled,
        remindersLeadHours: Math.max(1, Number(remindersLeadHours) || 24),
        minutesPerPage: Math.max(1, Math.round(Number(minutesPerPage) || 3)),
        defaultFocus: Math.min(10, Math.max(1, Math.round(Number(defaultFocus) || 5))),
        icsToken: icsToken || '',
        nudgesEnabled,
        nudgesReminderTime: dailyReminderTime,
        nudgesQuietStart: quietStart,
        nudgesQuietEnd: quietEnd,
        nudgesMaxPerWeek: Math.max(0, Math.round(Number(maxNudgesPerWeek) || 0)),
      }});
      notifyToast({ kind: 'success', message: 'Preferences saved.' });
    } catch {} finally { setPreferencesSaving(false); }
  }

  async function saveCourseColor(id: string, color: string) {
    setSavingId(id);
    try {
      const data = await apiFetch<{ course: any }>(`/api/courses/${id}`, { method: 'PATCH', body: { color } });
      if (data?.course) setCourses(prev => prev.map(course => course.id === id ? data.course : course));
      notifyToast({ kind: 'success', message: 'Course color saved.' });
    } finally { setSavingId(null); }
  }

  async function resetCourseColor(id: string) {
    const course = courses.find(item => item.id === id);
    setSavingId(id);
    try {
      const data = await apiFetch<{ course: any }>(`/api/courses/${id}`, { method: 'PATCH', body: { color: null } });
      if (data?.course) setCourses(prev => prev.map(item => item.id === id ? data.course : item));
      setCourseColors(prev => ({ ...prev, [id]: fallbackCourseColor(course?.title || '') }));
      notifyToast({ kind: 'success', message: 'Course color reset.' });
    } finally { setSavingId(null); }
  }

  async function saveVirtualColor(key: 'internshipColor' | 'sportsLawReviewColor', value: string) {
    try {
      await apiFetch('/api/settings', { method: 'PATCH', body: { [key]: value } });
      notifyToast({ kind: 'success', message: 'Color saved.' });
    } catch {}
  }

  async function resetVirtualColor(key: 'internshipColor' | 'sportsLawReviewColor') {
    const fallback = fallbackCourseColor(key === 'internshipColor' ? 'Internship' : 'Sports Law Review');
    if (key === 'internshipColor') setInternshipColor(fallback); else setSportsLawReviewColor(fallback);
    try {
      await apiFetch('/api/settings', { method: 'PATCH', body: { [key]: null } });
      notifyToast({ kind: 'success', message: 'Color reset.' });
    } catch {}
  }

  async function saveAvailability() {
    setAvailSaving(true);
    try {
      await apiFetch('/api/settings', { method: 'PATCH', body: { availabilityWindowsV1: windowsByDow, availabilityBreaksV1: breaksByDow } });
      notifyToast({ kind: 'success', message: 'Availability saved.' });
    } catch {} finally { setAvailSaving(false); }
  }

  function applyClassTimesAsBreaks() {
    const next: BreaksByDow = emptyBreaks();
    for (const dow of [0,1,2,3,4,5,6]) {
      const merged = [...(breaksByDow[dow] || [])];
      for (const cls of classTimesByDow[dow] || []) {
        if (!merged.some(block => block.start === cls.start && block.end === cls.end)) merged.push({ id: uid(), start: cls.start, end: cls.end });
      }
      next[dow] = merged;
    }
    setBreaksByDow(next);
  }

  async function createSemester() {
    const name = newSemester.name.trim() || `${newSemester.season} ${newSemester.year}`;
    const year = parseInt(newSemester.year, 10);
    if (!newSemester.startDate || !newSemester.endDate) {
      notifyToast({ kind: 'error', message: 'Start and end dates are required.' }); return;
    }
    if (newSemester.endDate < newSemester.startDate) {
      notifyToast({ kind: 'error', message: 'End date must be after the start date.' }); return;
    }
    setCreatingSemester(true);
    try {
      const data = await apiFetch<{ semester: SemesterInfo }>('/api/semesters', { method: 'POST', body: {
        name, season: newSemester.season, year, startDate: newSemester.startDate, endDate: newSemester.endDate, isActive: newSemester.makeActive,
      }});
      if (data?.semester) {
        setSemesters(prev => [...(newSemester.makeActive ? prev.map(s => ({ ...s, isActive: false })) : prev), data.semester]);
        if (newSemester.makeActive) { setActiveSemesterId(data.semester.id); notifySemesterChanged(); }
        setNewSemester({ name: '', season: 'Fall', year: String(new Date().getFullYear()), startDate: '', endDate: '', makeActive: true });
        notifyToast({ kind: 'success', message: `${data.semester.name} created.` });
      }
    } catch {} finally { setCreatingSemester(false); }
  }

  async function setActiveSemester(id: string) {
    const updated = semesters.map(item => ({ ...item, isActive: item.id === id }));
    try {
      await apiFetch('/api/semesters', { method: 'PUT', body: { semesters: updated } });
      setSemesters(updated);
      setActiveSemesterId(id);
      const active = updated.find(item => item.id === id);
      if (active?.windowsByDow) setWindowsByDow(active.windowsByDow);
      if (active?.breaksByDow) setBreaksByDow(active.breaksByDow);
      notifySemesterChanged();
      notifyToast({ kind: 'success', message: 'Active semester updated.' });
    } catch {}
  }

  async function deleteSemester(id: string) {
    try {
      await apiFetch(`/api/semesters?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setSemesters(prev => prev.filter(item => item.id !== id));
      if (activeSemesterId === id) { setActiveSemesterId(null); notifySemesterChanged(); }
      notifyToast({ kind: 'success', message: 'Semester deleted.' });
    } catch {}
  }

  return <main className="space-y-6">
    <section className="card p-6 space-y-4">
      <div><h2 className="text-lg font-medium">Settings</h2><p className="text-sm text-slate-300/70">Durable preferences are stored in the tracker database and follow you across devices.</p></div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SettingCard title="Reminder Preferences">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remindersEnabled} onChange={e => setRemindersEnabled(e.target.checked)} />Enable reminders</label>
          <label className="text-xs text-slate-300/70">Lead (hours)<input type="number" min={1} value={remindersLeadHours} onChange={e => setRemindersLeadHours(e.target.value)} className="mt-1 block w-24 px-2 py-1" /></label>
        </SettingCard>
        <SettingCard title="Minutes per Page (fallback)"><label className="text-xs text-slate-300/70">Fallback<input type="number" min={1} value={minutesPerPage} onChange={e => setMinutesPerPage(e.target.value)} className="mt-1 block w-24 px-2 py-1" /></label></SettingCard>
        <SettingCard title="Focus Defaults"><label className="text-xs text-slate-300/70">Default focus (1–10)<input type="number" min={1} max={10} value={defaultFocus} onChange={e => setDefaultFocus(e.target.value)} className="mt-1 block w-24 px-2 py-1" /></label></SettingCard>
        <SettingCard title="Calendar Token"><label className="text-xs text-slate-300/70">Private token<input value={icsToken} onChange={e => setIcsToken(e.target.value)} className="mt-1 block w-full px-2 py-1" placeholder="e.g., abc123" /></label></SettingCard>
        <SettingCard title="Nudges (Honor Code)" wide>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={nudgesEnabled} onChange={e => setNudgesEnabled(e.target.checked)} />Enable gentle nudges</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <label className="text-xs text-slate-300/70">Daily reminder<input type="time" value={dailyReminderTime} onChange={e => setDailyReminderTime(e.target.value)} className="mt-1 w-full px-2 py-1" /></label>
            <label className="text-xs text-slate-300/70">Max / week<input type="number" min={0} value={maxNudgesPerWeek} onChange={e => setMaxNudgesPerWeek(e.target.value)} className="mt-1 w-full px-2 py-1" /></label>
            <label className="text-xs text-slate-300/70">Quiet start<input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)} className="mt-1 w-full px-2 py-1" /></label>
            <label className="text-xs text-slate-300/70">Quiet end<input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} className="mt-1 w-full px-2 py-1" /></label>
          </div>
        </SettingCard>
      </div>
      <button onClick={() => void savePreferences()} disabled={preferencesSaving} className="px-4 py-2 rounded bg-blue-600 disabled:opacity-50 text-sm">{preferencesSaving ? 'Saving…' : 'Save preferences'}</button>

      <div className="rounded border border-[#1b2344] p-4 space-y-3">
        <div><h3 className="text-sm font-medium">Course Colors</h3><p className="text-xs text-slate-300/70 mt-1">Colors are stored on the server so every device uses the same palette.</p></div>
        <ColorRow label="Internship" value={internshipColor} onChange={setInternshipColor} onSave={() => void saveVirtualColor('internshipColor', internshipColor)} onReset={() => void resetVirtualColor('internshipColor')} />
        <ColorRow label="Sports Law Review" value={sportsLawReviewColor} onChange={setSportsLawReviewColor} onSave={() => void saveVirtualColor('sportsLawReviewColor', sportsLawReviewColor)} onReset={() => void resetVirtualColor('sportsLawReviewColor')} />
        {courses.map(course => <div key={course.id} className="flex items-center gap-3">
          <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: courseColors[course.id] || course.color || fallbackCourseColor(course.title) }} />
          <div className="flex-1 truncate text-sm">{course.title}</div>
          <input type="color" value={courseColors[course.id] || course.color || fallbackCourseColor(course.title)} onChange={e => setCourseColors(prev => ({ ...prev, [course.id]: e.target.value }))} className="h-7 w-12" />
          <button disabled={savingId === course.id} onClick={() => void saveCourseColor(course.id, courseColors[course.id] || fallbackCourseColor(course.title))} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Save</button>
          <button disabled={savingId === course.id} onClick={() => void resetCourseColor(course.id)} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Reset</button>
        </div>)}
      </div>
      <a href="/settings/import" className="inline-flex items-center px-3 py-2 rounded border border-[#1b2344] hover:bg-[#0b1020] text-sm">Import Data (CSV)</a>
    </section>

    <section className="card p-6 space-y-4">
      <div><h2 className="text-lg font-medium">Weekly Availability</h2><p className="text-sm text-slate-300/70">Set the study windows used by Week Plan and Today. The server copy is authoritative.</p></div>
      {courses.some(course => course.meetingDays?.length || course.meetingBlocks?.length) ? <div className="rounded border border-emerald-600/30 bg-emerald-900/10 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-medium text-emerald-400">Smart defaults available</div><div className="text-xs text-slate-300/70">Add class times as breaks so they are not treated as study time.</div></div><button onClick={applyClassTimesAsBreaks} className="px-3 py-1.5 rounded bg-emerald-600 text-sm">Apply class times as breaks</button></div>
      </div> : null}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-slate-400 self-center">Quick setup:</span>
        <button onClick={() => { const row = () => [{ id: uid(), start:'9:00 AM', end:'5:00 PM' }]; setWindowsByDow({0:[],1:row(),2:row(),3:row(),4:row(),5:row(),6:[]}); }} className="px-2 py-1 rounded border border-emerald-600/50 text-xs text-emerald-400">Weekdays 9–5</button>
        <button onClick={() => { const row = () => [{ id: uid(), start:'8:00 AM', end:'12:00 PM' }, { id: uid(), start:'1:00 PM', end:'6:00 PM' }]; setWindowsByDow({0:[],1:row(),2:row(),3:row(),4:row(),5:row(),6:[]}); }} className="px-2 py-1 rounded border border-emerald-600/50 text-xs text-emerald-400">Weekdays 8–12, 1–6</button>
        <button onClick={() => { const row = () => [{ id: uid(), start:'6:00 PM', end:'10:00 PM' }]; setWindowsByDow({0:row(),1:row(),2:row(),3:row(),4:row(),5:row(),6:row()}); }} className="px-2 py-1 rounded border border-blue-600/50 text-xs text-blue-400">Evenings 6–10</button>
        <button onClick={() => { setWindowsByDow(emptyWindows()); setBreaksByDow(emptyBreaks()); }} className="px-2 py-1 rounded border border-white/20 text-xs text-slate-400">Clear all</button>
      </div>
      <div className="grid grid-cols-7 gap-2">{[0,1,2,3,4,5,6].map(dow => <div key={dow} className="rounded border border-[#1b2344] p-2 text-center"><div className="text-xs font-medium">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]}</div><div className="text-[10px] text-slate-300/70">{(windowsByDow[dow] || []).length} window{(windowsByDow[dow] || []).length === 1 ? '' : 's'}</div><div className="text-[10px] text-slate-300/50">{(breaksByDow[dow] || []).length} break{(breaksByDow[dow] || []).length === 1 ? '' : 's'}</div></div>)}</div>
      <button onClick={() => void saveAvailability()} disabled={availSaving} className="px-4 py-2 rounded bg-blue-600 disabled:opacity-50 text-sm">{availSaving ? 'Saving…' : 'Save availability'}</button>
    </section>

    <section className="card p-6 space-y-4">
      <div><h2 className="text-lg font-medium">Semesters</h2><p className="text-sm text-slate-300/70">The active semester is stored on the server and drives the tracker across devices.</p></div>
      {semesters.length === 0 ? <div className="text-sm text-slate-300/60">No semesters configured yet.</div> : <div className="space-y-2">{semesters.map(semester => <div key={semester.id} className={`rounded border p-3 flex items-center justify-between gap-3 ${semester.isActive ? 'border-emerald-500 bg-emerald-900/10' : 'border-[#1b2344]'}`}>
        <div><div className="text-sm font-medium">{semester.name}</div><div className="text-xs text-slate-300/60">{semester.startDate} to {semester.endDate}</div></div>
        <div className="flex items-center gap-2">{semester.isActive ? <span className="text-xs text-emerald-400">Active</span> : <button onClick={() => void setActiveSemester(semester.id)} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Set active</button>}<button onClick={() => void deleteSemester(semester.id)} className="px-2 py-1 rounded border border-[#1b2344] text-xs text-rose-400">Delete</button></div>
      </div>)}</div>}

      <div className="rounded border border-[#1b2344] p-4 space-y-3">
        <h3 className="text-sm font-medium">New semester</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Name (optional)"><input value={newSemester.name} onChange={e => setNewSemester(prev => ({ ...prev, name: e.target.value }))} placeholder={`${newSemester.season} ${newSemester.year}`} className="w-full px-3 py-2" /></Field>
          <Field label="Season"><select value={newSemester.season} onChange={e => setNewSemester(prev => ({ ...prev, season: e.target.value as typeof prev.season }))} className="w-full px-3 py-2">{(['Spring','Summer','Fall','Winter'] as const).map(value => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Year"><input type="number" value={newSemester.year} onChange={e => setNewSemester(prev => ({ ...prev, year: e.target.value }))} className="w-full px-3 py-2" /></Field>
          <Field label="Start date"><input type="date" value={newSemester.startDate} onChange={e => setNewSemester(prev => ({ ...prev, startDate: e.target.value }))} className="w-full px-3 py-2" /></Field>
          <Field label="End date"><input type="date" value={newSemester.endDate} onChange={e => setNewSemester(prev => ({ ...prev, endDate: e.target.value }))} className="w-full px-3 py-2" /></Field>
          <label className="flex items-center gap-2 text-xs text-slate-300/70 self-end pb-2"><input type="checkbox" checked={newSemester.makeActive} onChange={e => setNewSemester(prev => ({ ...prev, makeActive: e.target.checked }))} />Make this the active semester</label>
        </div>
        <button onClick={() => void createSemester()} disabled={creatingSemester} className="px-3 py-2 rounded bg-emerald-600 disabled:opacity-60 text-sm">{creatingSemester ? 'Creating…' : 'Create semester'}</button>
      </div>
    </section>
  </main>;
}

function SettingCard({ title, wide, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={`rounded border border-[#1b2344] p-4 space-y-2 ${wide ? 'md:col-span-2' : ''}`}><h3 className="text-sm font-medium">{title}</h3>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs text-slate-300/70"><span className="block mb-1">{label}</span>{children}</label>;
}
function ColorRow({ label, value, onChange, onSave, onReset }: { label: string; value: string; onChange: (value: string) => void; onSave: () => void; onReset: () => void }) {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallbackCourseColor(label);
  return <div className="flex items-center gap-3"><span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: normalized }} /><div className="flex-1 truncate text-sm">{label}</div><input type="color" value={normalized} onChange={e => onChange(e.target.value)} className="h-7 w-12" /><button onClick={onSave} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Save</button><button onClick={onReset} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Reset</button></div>;
}
