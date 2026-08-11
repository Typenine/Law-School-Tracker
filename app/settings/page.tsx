"use client";
import { useEffect, useState, useMemo } from "react";
import type { WindowsByDow, BreaksByDow, SemesterInfo } from '@/lib/types';
import { notifySemesterChanged } from '@/lib/semesterBus';
import { apiFetch } from '@/lib/apiClient';
import { notifyToast } from '@/lib/toastBus';
import { fallbackCourseColor } from '@/lib/colors';

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

export default function SettingsPage() {
  const [remindersEnabled, setRemindersEnabled] = useState<boolean>(false);
  const [remindersLeadHours, setRemindersLeadHours] = useState<string>("24");
  const [minutesPerPage, setMinutesPerPage] = useState<string>("3");
  const [defaultFocus, setDefaultFocus] = useState<string>("5");
  const [icsToken, setIcsToken] = useState<string>("");
  // Nudges
  const [nudgesEnabled, setNudgesEnabled] = useState<boolean>(false);
  const [dailyReminderTime, setDailyReminderTime] = useState<string>("20:00");
  const [quietStart, setQuietStart] = useState<string>("22:00");
  const [quietEnd, setQuietEnd] = useState<string>("07:00");
  const [maxNudgesPerWeek, setMaxNudgesPerWeek] = useState<string>("3");
  const [courses, setCourses] = useState<any[]>([]);
  const [localColors, setLocalColors] = useState<Record<string,string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [internshipColor, setInternshipColor] = useState<string>('');
  const [sportsLawReviewColor, setSportsLawReviewColor] = useState<string>('');
  
  // Availability settings
  const [windowsByDow, setWindowsByDow] = useState<WindowsByDow>({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] });
  const [breaksByDow, setBreaksByDow] = useState<BreaksByDow>({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] });
  const [semesters, setSemesters] = useState<SemesterInfo[]>([]);
  const [activeSemesterId, setActiveSemesterId] = useState<string | null>(null);
  const [availSaving, setAvailSaving] = useState(false);
  const [newSemester, setNewSemester] = useState<{
    name: string; season: 'Spring' | 'Summer' | 'Fall' | 'Winter'; year: string;
    startDate: string; endDate: string; makeActive: boolean;
  }>({ name: '', season: 'Fall', year: String(new Date().getFullYear()), startDate: '', endDate: '', makeActive: true });
  const [creatingSemester, setCreatingSemester] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setRemindersEnabled((window.localStorage.getItem("remindersEnabled") || "false") === "true");
      const lead = window.localStorage.getItem("remindersLeadHours");
      if (lead) setRemindersLeadHours(String(Math.max(1, parseFloat(lead) || 24)));
      const mpp = window.localStorage.getItem("minutesPerPage");
      if (mpp) setMinutesPerPage(String(Math.max(1, Math.round(parseFloat(mpp) || 3))));
      const df = window.localStorage.getItem("defaultFocus");
      if (df) setDefaultFocus(String(Math.min(10, Math.max(1, Math.round(parseFloat(df) || 5)))));
      setIcsToken(window.localStorage.getItem("icsToken") || "");
      // Nudges
      setNudgesEnabled((window.localStorage.getItem('nudgesEnabled') || 'false') === 'true');
      const drt = window.localStorage.getItem('nudgesReminderTime'); if (drt && /^(\d{2}):(\d{2})$/.test(drt)) setDailyReminderTime(drt);
      const qs = window.localStorage.getItem('nudgesQuietStart'); if (qs && /^(\d{2}):(\d{2})$/.test(qs)) setQuietStart(qs);
      const qe = window.localStorage.getItem('nudgesQuietEnd'); if (qe && /^(\d{2}):(\d{2})$/.test(qe)) setQuietEnd(qe);
      const mx = window.localStorage.getItem('nudgesMaxPerWeek'); if (mx) setMaxNudgesPerWeek(String(Math.max(0, parseInt(mx,10)||3)));
    } catch {}
  }, []);
  // Server settings load (override local if present)
  useEffect(() => {
    (async () => {
      try {
        const j = await apiFetch<{ settings: Record<string, any> }>('/api/settings');
        const s = ((j as any)?.settings || {}) as Record<string, any>;
        if (typeof s.remindersEnabled === 'boolean') setRemindersEnabled(!!s.remindersEnabled);
        if (typeof s.remindersLeadHours !== 'undefined') setRemindersLeadHours(String(Math.max(1, parseFloat(String(s.remindersLeadHours)) || 24)));
        if (typeof s.minutesPerPage !== 'undefined') setMinutesPerPage(String(Math.max(1, Math.round(parseFloat(String(s.minutesPerPage)) || 3))));
        if (typeof s.defaultFocus !== 'undefined') setDefaultFocus(String(Math.min(10, Math.max(1, Math.round(parseFloat(String(s.defaultFocus)) || 5)))));
        if (typeof s.icsToken === 'string') setIcsToken(s.icsToken);
        if (typeof s.nudgesEnabled === 'boolean') setNudgesEnabled(!!s.nudgesEnabled);
        if (typeof s.nudgesReminderTime === 'string' && /^\d{2}:\d{2}$/.test(s.nudgesReminderTime)) setDailyReminderTime(s.nudgesReminderTime);
        if (typeof s.nudgesQuietStart === 'string' && /^\d{2}:\d{2}$/.test(s.nudgesQuietStart)) setQuietStart(s.nudgesQuietStart);
        if (typeof s.nudgesQuietEnd === 'string' && /^\d{2}:\d{2}$/.test(s.nudgesQuietEnd)) setQuietEnd(s.nudgesQuietEnd);
        if (typeof s.nudgesMaxPerWeek !== 'undefined') setMaxNudgesPerWeek(String(Math.max(0, parseInt(String(s.nudgesMaxPerWeek),10)||3)));
        if (typeof s.internshipColor === 'string') setInternshipColor(s.internshipColor);
        if (typeof s.sportsLawReviewColor === 'string') setSportsLawReviewColor(s.sportsLawReviewColor);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try { const d = await apiFetch<{ courses: any[] }>('/api/courses'); const list = Array.isArray((d as any)?.courses) ? (d as any).courses : []; setCourses(list); const init: Record<string,string> = {}; for (const c of list) init[c.id] = c.color || fallbackCourseColor(c.title); setLocalColors(init); } catch {}
    })();
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ls = window.localStorage.getItem('internshipColor');
      setInternshipColor(ls || fallbackCourseColor('Internship'));
    }
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ls = window.localStorage.getItem('sportsLawReviewColor');
      setSportsLawReviewColor(ls || fallbackCourseColor('Sports Law Review'));
    }
  }, []);

  // Load availability settings
  useEffect(() => {
    (async () => {
      try {
        const j = await apiFetch<{ settings: any }>('/api/settings?keys=availabilityWindowsV1,availabilityBreaksV1');
        const s = (j as any)?.settings || {};
        if (s.availabilityWindowsV1) setWindowsByDow(s.availabilityWindowsV1);
        if (s.availabilityBreaksV1) setBreaksByDow(s.availabilityBreaksV1);
      } catch {}
      // Load semesters
      try {
        const j = await apiFetch<{ semesters: SemesterInfo[] }>('/api/semesters');
        setSemesters(((j as any)?.semesters) || []);
        const active = (((j as any)?.semesters) || []).find((s: SemesterInfo) => s.isActive);
        if (active) setActiveSemesterId(active.id);
      } catch {}
    })();
  }, []);

  // Smart defaults: compute class times from courses
  const classTimesByDow = useMemo(() => {
    const result: Record<number, Array<{ start: string; end: string; course: string }>> = { 0:[],1:[],2:[],3:[],4:[],5:[],6:[] };
    for (const c of courses) {
      const blocks = (Array.isArray(c.meetingBlocks) && c.meetingBlocks.length)
        ? c.meetingBlocks
        : ((Array.isArray(c.meetingDays) && c.meetingStart && c.meetingEnd) 
            ? [{ days: c.meetingDays, start: c.meetingStart, end: c.meetingEnd }] 
            : []);
      for (const b of blocks) {
        if (!Array.isArray(b.days)) continue;
        for (const dow of b.days) {
          if (b.start && b.end) {
            result[dow].push({ start: b.start, end: b.end, course: c.title || c.code || 'Class' });
          }
        }
      }
    }
    return result;
  }, [courses]);

  async function saveAvailability() {
    setAvailSaving(true);
    try {
      await apiFetch('/api/settings', { method: 'PATCH', body: { availabilityWindowsV1: windowsByDow, availabilityBreaksV1: breaksByDow } });
      try { notifyToast({ kind: 'success', message: 'Availability saved.' }); } catch {}
    } catch {}
    setAvailSaving(false);
  }

  async function createSemester() {
    const name = newSemester.name.trim() || `${newSemester.season} ${newSemester.year}`;
    const year = parseInt(newSemester.year, 10);
    if (!newSemester.startDate || !newSemester.endDate) {
      try { notifyToast({ kind: 'error', message: 'Start and end dates are required.' }); } catch {}
      return;
    }
    if (newSemester.endDate < newSemester.startDate) {
      try { notifyToast({ kind: 'error', message: 'End date must be after the start date.' }); } catch {}
      return;
    }
    setCreatingSemester(true);
    try {
      const res = await apiFetch<{ semester: SemesterInfo }>('/api/semesters', {
        method: 'POST',
        body: {
          name, season: newSemester.season, year,
          startDate: newSemester.startDate, endDate: newSemester.endDate,
          isActive: newSemester.makeActive,
        },
      });
      const created = (res as any)?.semester as SemesterInfo | undefined;
      if (created) {
        setSemesters(prev => {
          const next = newSemester.makeActive ? prev.map(s => ({ ...s, isActive: false })) : prev.slice();
          return [...next, created];
        });
        if (newSemester.makeActive) {
          setActiveSemesterId(created.id);
          try { window.localStorage.setItem('currentTerm', created.id); } catch {}
          try { notifySemesterChanged(); } catch {}
        }
        setNewSemester({ name: '', season: 'Fall', year: String(new Date().getFullYear()), startDate: '', endDate: '', makeActive: true });
        try { notifyToast({ kind: 'success', message: `${created.name} created.` }); } catch {}
      }
    } catch {
      try { notifyToast({ kind: 'error', message: 'Unable to create the semester.' }); } catch {}
    } finally {
      setCreatingSemester(false);
    }
  }

  async function deleteSemester(id: string) {
    try {
      await apiFetch(`/api/semesters?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setSemesters(prev => prev.filter(s => s.id !== id));
      if (activeSemesterId === id) {
        setActiveSemesterId(null);
        try { notifySemesterChanged(); } catch {}
      }
      try { notifyToast({ kind: 'success', message: 'Semester deleted.' }); } catch {}
    } catch {
      try { notifyToast({ kind: 'error', message: 'Unable to delete the semester.' }); } catch {}
    }
  }

  function applyClassTimesAsBreaks() {
    // Add class times as breaks to the current windows
    const newBreaks: BreaksByDow = { 0:[],1:[],2:[],3:[],4:[],5:[],6:[] };
    for (const dow of [0,1,2,3,4,5,6]) {
      const existing = breaksByDow[dow] || [];
      const classes = classTimesByDow[dow] || [];
      const merged = [...existing];
      for (const cls of classes) {
        // Check if already exists
        const exists = merged.some(b => b.start === cls.start && b.end === cls.end);
        if (!exists) {
          merged.push({ id: uid(), start: cls.start, end: cls.end });
        }
      }
      newBreaks[dow] = merged;
    }
    setBreaksByDow(newBreaks);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("remindersEnabled", remindersEnabled ? "true" : "false");
  }, [remindersEnabled]);
  useEffect(() => { try { void apiFetch('/api/settings', { method: 'PATCH', body: { remindersEnabled } }); } catch {} }, [remindersEnabled]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const n = Math.max(1, parseFloat(remindersLeadHours || "24") || 24);
    window.localStorage.setItem("remindersLeadHours", String(n));
  }, [remindersLeadHours]);
  useEffect(() => { const n = Math.max(1, parseFloat(remindersLeadHours || '24') || 24); try { void apiFetch('/api/settings', { method: 'PATCH', body: { remindersLeadHours: n } }); } catch {} }, [remindersLeadHours]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const n = Math.max(1, Math.round(parseFloat(minutesPerPage || "3") || 3));
    window.localStorage.setItem("minutesPerPage", String(n));
  }, [minutesPerPage]);
  useEffect(() => { const n = Math.max(1, Math.round(parseFloat(minutesPerPage || '3') || 3)); try { void apiFetch('/api/settings', { method: 'PATCH', body: { minutesPerPage: n } }); } catch {} }, [minutesPerPage]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const n = Math.min(10, Math.max(1, Math.round(parseFloat(defaultFocus || "5") || 5)));
    window.localStorage.setItem("defaultFocus", String(n));
  }, [defaultFocus]);
  useEffect(() => { const n = Math.min(10, Math.max(1, Math.round(parseFloat(defaultFocus || '5') || 5))); try { void apiFetch('/api/settings', { method: 'PATCH', body: { defaultFocus: n } }); } catch {} }, [defaultFocus]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("icsToken", icsToken || "");
  }, [icsToken]);
  useEffect(() => { try { void apiFetch('/api/settings', { method: 'PATCH', body: { icsToken: icsToken || '' } }); } catch {} }, [icsToken]);
  async function saveCourseColor(id: string, color: string) {
    try { setSavingId(id); const d = await apiFetch<{ course: any }>(`/api/courses/${id}`, { method: 'PATCH', body: { color } }); const updated = (d as any)?.course; if (updated) { setCourses(prev => prev.map((c:any)=>c.id===id?updated:c)); try { notifyToast({ kind: 'success', message: 'Course color saved.' }); } catch {} } } finally { setSavingId(null); }
  }
  async function resetCourseColor(id: string) {
    const c = courses.find((x:any)=>x.id===id); const title = c?.title || '';
    try { setSavingId(id); const d = await apiFetch<{ course: any }>(`/api/courses/${id}`, { method: 'PATCH', body: { color: null } }); const updated = (d as any)?.course; if (updated) { setCourses(prev => prev.map((c:any)=>c.id===id?updated:c)); setLocalColors(prev => ({ ...prev, [id]: fallbackCourseColor(title) })); try { notifyToast({ kind: 'success', message: 'Course color reset.' }); } catch {} } } finally { setSavingId(null); }
  }
  function saveInternColor() { try { if (typeof window !== 'undefined') window.localStorage.setItem('internshipColor', internshipColor || fallbackCourseColor('Internship')); } catch {} }
  function resetInternColor() { const def = fallbackCourseColor('Internship'); setInternshipColor(def); try { if (typeof window !== 'undefined') window.localStorage.removeItem('internshipColor'); } catch {} try { void apiFetch('/api/settings', { method: 'PATCH', body: { internshipColor: null } }); } catch {} }
  function saveSlrColor() { try { if (typeof window !== 'undefined') window.localStorage.setItem('sportsLawReviewColor', sportsLawReviewColor || fallbackCourseColor('Sports Law Review')); } catch {} try { void apiFetch('/api/settings', { method: 'PATCH', body: { sportsLawReviewColor: sportsLawReviewColor || fallbackCourseColor('Sports Law Review') } }); } catch {} }
  function resetSlrColor() { const def = fallbackCourseColor('Sports Law Review'); setSportsLawReviewColor(def); try { if (typeof window !== 'undefined') window.localStorage.removeItem('sportsLawReviewColor'); } catch {} try { void apiFetch('/api/settings', { method: 'PATCH', body: { sportsLawReviewColor: null } }); } catch {} }
  // Persist internship color to server on change via Save button
  useEffect(() => { /* mirror to server only when value is changed via color input + Save */ }, [internshipColor]);
  function saveInternColorServer() { try { if (typeof window !== 'undefined') window.localStorage.setItem('internshipColor', internshipColor || fallbackCourseColor('Internship')); } catch {} try { void apiFetch('/api/settings', { method: 'PATCH', body: { internshipColor: internshipColor || fallbackCourseColor('Internship') } }); } catch {} }
  // Save Nudges
  useEffect(() => { if (typeof window!== 'undefined') window.localStorage.setItem('nudgesEnabled', nudgesEnabled ? 'true':'false'); }, [nudgesEnabled]);
  useEffect(() => { if (typeof window!== 'undefined' && /^(\d{2}):(\d{2})$/.test(dailyReminderTime||'')) window.localStorage.setItem('nudgesReminderTime', dailyReminderTime); }, [dailyReminderTime]);
  useEffect(() => { if (typeof window!== 'undefined' && /^(\d{2}):(\d{2})$/.test(quietStart||'')) window.localStorage.setItem('nudgesQuietStart', quietStart); }, [quietStart]);
  useEffect(() => { if (typeof window!== 'undefined' && /^(\d{2}):(\d{2})$/.test(quietEnd||'')) window.localStorage.setItem('nudgesQuietEnd', quietEnd); }, [quietEnd]);
  useEffect(() => { if (typeof window!== 'undefined') window.localStorage.setItem('nudgesMaxPerWeek', String(Math.max(0, parseInt(maxNudgesPerWeek||'3',10)||3))); }, [maxNudgesPerWeek]);

  return (
    <main className="space-y-6">
      <section className="card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-medium">Settings</h2>
          <p className="text-sm text-slate-300/70">Configure reminders, pacing, focus default, and calendar token.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded border border-[#1b2344] p-4 space-y-2">
            <h3 className="text-sm font-medium">Reminder Preferences</h3>
            <div className="flex items-center gap-2">
              <input id="rem-enabled" type="checkbox" checked={remindersEnabled} onChange={e=>setRemindersEnabled(e.target.checked)} />
              <label htmlFor="rem-enabled" className="text-sm">Enable reminders</label>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="rem-lead" className="text-xs text-slate-300/70">Lead (hours)</label>
              <input id="rem-lead" type="number" min={1} step={1} value={remindersLeadHours} onChange={e=>setRemindersLeadHours(e.target.value)} className="w-24 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
            </div>
          </div>
          <div className="rounded border border-[#1b2344] p-4 space-y-2">
            <h3 className="text-sm font-medium">Minutes per Page (fallback)</h3>
            <div className="flex items-center gap-2">
              <label htmlFor="mpp" className="text-xs text-slate-300/70">Fallback</label>
              <input id="mpp" type="number" min={1} step={1} value={minutesPerPage} onChange={e=>setMinutesPerPage(e.target.value)} className="w-24 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
            </div>
          </div>
          <div className="rounded border border-[#1b2344] p-4 space-y-2">
            <h3 className="text-sm font-medium">Focus Defaults</h3>
            <div className="flex items-center gap-2">
              <label htmlFor="focus" className="text-xs text-slate-300/70">Default focus (1–10)</label>
              <input id="focus" type="number" min={1} max={10} step={1} value={defaultFocus} onChange={e=>setDefaultFocus(e.target.value)} className="w-24 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
            </div>
          </div>
          <div className="rounded border border-[#1b2344] p-4 space-y-2">
            <h3 className="text-sm font-medium">Calendar Token</h3>
            <div className="flex items-center gap-2">
              <label htmlFor="ics" className="text-xs text-slate-300/70">Private token</label>
              <input id="ics" value={icsToken} onChange={e=>setIcsToken(e.target.value)} className="flex-1 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" placeholder="e.g., abc123" />
            </div>
          </div>
          <div className="rounded border border-[#1b2344] p-4 space-y-2">
            <h3 className="text-sm font-medium">Nudges (Honor Code)</h3>
            <div className="flex items-center gap-2">
              <input id="nudges-enabled" type="checkbox" checked={nudgesEnabled} onChange={e=>setNudgesEnabled(e.target.checked)} />
              <label htmlFor="nudges-enabled" className="text-sm">Enable gentle nudges</label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="nudges-reminder" className="text-xs text-slate-300/70">Daily reminder</label>
                <input id="nudges-reminder" type="time" value={dailyReminderTime} onChange={e=>setDailyReminderTime(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
              </div>
              <div>
                <label htmlFor="nudges-max" className="text-xs text-slate-300/70">Max / week</label>
                <input id="nudges-max" type="number" min={0} step={1} value={maxNudgesPerWeek} onChange={e=>setMaxNudgesPerWeek(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="quiet-start" className="text-xs text-slate-300/70">Quiet start</label>
                <input id="quiet-start" type="time" value={quietStart} onChange={e=>setQuietStart(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
              </div>
              <div>
                <label htmlFor="quiet-end" className="text-xs text-slate-300/70">Quiet end</label>
                <input id="quiet-end" type="time" value={quietEnd} onChange={e=>setQuietEnd(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
              </div>
            </div>
            <div className="text-xs text-slate-300/70">In-app banner only; no emails/notifications. Honor code: you control this.</div>
          </div>
          <div className="rounded border border-[#1b2344] p-4 space-y-2 md:col-span-2">
            <h3 className="text-sm font-medium">Course Colors</h3>
            <div className="text-xs text-slate-300/70">Pick custom colors per course. Reset to use the automatic color.</div>
            <div className="space-y-2">
              {/* Internship virtual course */}
              <div className="flex items-center gap-3">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: (internshipColor && /^#?[0-9a-fA-F]{6}$/.test(internshipColor) ? (internshipColor.startsWith('#')? internshipColor : `#${internshipColor}`) : fallbackCourseColor('Internship')) }} />
                <div className="flex-1 truncate text-sm">Internship</div>
                <input type="color" value={/^#?[0-9a-fA-F]{6}$/.test(internshipColor||'') ? (internshipColor.startsWith('#')? internshipColor : `#${internshipColor}`) : fallbackCourseColor('Internship')} onChange={e=>setInternshipColor(e.target.value)} className="h-7 w-12 bg-[#0b1020] border border-[#1b2344] rounded" />
                <button onClick={saveInternColorServer} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Save</button>
                <button onClick={resetInternColor} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Reset</button>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: (sportsLawReviewColor && /^#?[0-9a-fA-F]{6}$/.test(sportsLawReviewColor) ? (sportsLawReviewColor.startsWith('#')? sportsLawReviewColor : `#${sportsLawReviewColor}`) : fallbackCourseColor('Sports Law Review')) }} />
                <div className="flex-1 truncate text-sm">Sports Law Review</div>
                <input type="color" value={/^#?[0-9a-fA-F]{6}$/.test(sportsLawReviewColor||'') ? (sportsLawReviewColor.startsWith('#')? sportsLawReviewColor : `#${sportsLawReviewColor}`) : fallbackCourseColor('Sports Law Review')} onChange={e=>setSportsLawReviewColor(e.target.value)} className="h-7 w-12 bg-[#0b1020] border border-[#1b2344] rounded" />
                <button onClick={saveSlrColor} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Save</button>
                <button onClick={resetSlrColor} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Reset</button>
              </div>
              {courses.length === 0 ? (
                <div className="text-xs text-slate-300/60">No courses found.</div>
              ) : courses.map((c:any) => (
                <div key={c.id} className="flex items-center gap-3">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: (localColors[c.id] || c.color || fallbackCourseColor(c.title)) }} />
                  <div className="flex-1 truncate text-sm">{c.title}</div>
                  <input type="color" value={localColors[c.id] || c.color || fallbackCourseColor(c.title)} onChange={e=>setLocalColors(prev=>({ ...prev, [c.id]: e.target.value }))} className="h-7 w-12 bg-[#0b1020] border border-[#1b2344] rounded" />
                  <button onClick={()=>saveCourseColor(c.id, localColors[c.id] || c.color || fallbackCourseColor(c.title))} className="px-2 py-1 rounded border border-[#1b2344] text-xs" disabled={savingId===c.id}>Save</button>
                  <button onClick={()=>resetCourseColor(c.id)} className="px-2 py-1 rounded border border-[#1b2344] text-xs" disabled={savingId===c.id}>Reset</button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div>
          <a href="/settings/import" className="inline-flex items-center px-3 py-2 rounded border border-[#1b2344] hover:bg-[#0b1020] text-sm">Import Data (CSV)</a>
        </div>
      </section>

      {/* Availability Settings Section */}
      <section className="card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-medium">Weekly Availability</h2>
          <p className="text-sm text-slate-300/70">Set your default study windows. These sync across Week Plan and Today pages.</p>
        </div>
        
        {/* Smart defaults */}
        {courses.some(c => c.meetingDays?.length || c.meetingBlocks?.length) && (
          <div className="rounded border border-emerald-600/30 bg-emerald-900/10 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-emerald-400">Smart Defaults Available</div>
                <div className="text-xs text-slate-300/70">Auto-add your class times as breaks so they don't count as study time.</div>
              </div>
              <button onClick={applyClassTimesAsBreaks} className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm">Apply Class Times as Breaks</button>
            </div>
            <div className="mt-2 text-xs text-slate-300/60">
              Detected classes: {[0,1,2,3,4,5,6].map(dow => {
                const classes = classTimesByDow[dow];
                if (!classes.length) return null;
                return <span key={dow} className="mr-2">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]}: {classes.map(c => c.course).join(', ')}</span>;
              })}
            </div>
          </div>
        )}

        {/* Quick presets */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-slate-400 self-center">Quick setup:</span>
          <button onClick={()=>{ const w = [{ id: uid(), start:'9:00 AM', end:'5:00 PM' }]; setWindowsByDow({ 0:[], 1:w.map(x=>({...x, id:uid()})), 2:w.map(x=>({...x, id:uid()})), 3:w.map(x=>({...x, id:uid()})), 4:w.map(x=>({...x, id:uid()})), 5:w.map(x=>({...x, id:uid()})), 6:[] }); }} className="px-2 py-1 rounded border border-emerald-600/50 text-xs text-emerald-400 hover:bg-emerald-900/20">Weekdays 9–5</button>
          <button onClick={()=>{ const w = [{ id: uid(), start:'8:00 AM', end:'12:00 PM' }, { id: uid(), start:'1:00 PM', end:'6:00 PM' }]; setWindowsByDow({ 0:[], 1:w.map(x=>({...x, id:uid()})), 2:w.map(x=>({...x, id:uid()})), 3:w.map(x=>({...x, id:uid()})), 4:w.map(x=>({...x, id:uid()})), 5:w.map(x=>({...x, id:uid()})), 6:[] }); }} className="px-2 py-1 rounded border border-emerald-600/50 text-xs text-emerald-400 hover:bg-emerald-900/20">Weekdays 8–12, 1–6</button>
          <button onClick={()=>{ const w = [{ id: uid(), start:'6:00 PM', end:'10:00 PM' }]; setWindowsByDow({ 0:w.map(x=>({...x, id:uid()})), 1:w.map(x=>({...x, id:uid()})), 2:w.map(x=>({...x, id:uid()})), 3:w.map(x=>({...x, id:uid()})), 4:w.map(x=>({...x, id:uid()})), 5:w.map(x=>({...x, id:uid()})), 6:w.map(x=>({...x, id:uid()})) }); }} className="px-2 py-1 rounded border border-blue-600/50 text-xs text-blue-400 hover:bg-blue-900/20">Evenings 6–10</button>
          <button onClick={()=>{ setWindowsByDow({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] }); setBreaksByDow({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] }); }} className="px-2 py-1 rounded border border-white/20 text-xs text-slate-400 hover:bg-white/5">Clear all</button>
        </div>

        {/* Day-by-day summary */}
        <div className="grid grid-cols-7 gap-2">
          {[0,1,2,3,4,5,6].map(dow => {
            const wins = windowsByDow[dow] || [];
            const brks = breaksByDow[dow] || [];
            return (
              <div key={dow} className="rounded border border-[#1b2344] p-2 text-center">
                <div className="text-xs font-medium">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]}</div>
                <div className="text-[10px] text-slate-300/70">{wins.length} window{wins.length !== 1 ? 's' : ''}</div>
                <div className="text-[10px] text-slate-300/50">{brks.length} break{brks.length !== 1 ? 's' : ''}</div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={saveAvailability} disabled={availSaving} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm">
            {availSaving ? 'Saving...' : 'Save Availability'}
          </button>
          <span className="text-xs text-slate-300/60">Changes sync to Week Plan automatically</span>
        </div>
      </section>

      {/* Semesters Section */}
      <section className="card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-medium">Semesters</h2>
          <p className="text-sm text-slate-300/70">Manage different semesters with separate schedules and availability.</p>
        </div>
        {semesters.length === 0 ? (
          <div className="text-sm text-slate-300/60">No semesters configured yet.</div>
        ) : (
          <div className="space-y-2">
            {semesters.map(sem => (
              <div key={sem.id} className={`rounded border p-3 flex items-center justify-between ${sem.isActive ? 'border-emerald-500 bg-emerald-900/10' : 'border-[#1b2344]'}`}>
                <div>
                  <div className="text-sm font-medium">{sem.name}</div>
                  <div className="text-xs text-slate-300/60">{sem.startDate} → {sem.endDate}</div>
                </div>
                <div className="flex items-center gap-2">
                  {sem.isActive ? (
                    <span className="text-xs text-emerald-400">Active</span>
                  ) : (
                    <button onClick={async () => {
                      // Set this semester as active
                      const updated = semesters.map(s => ({ ...s, isActive: s.id === sem.id }));
                      setSemesters(updated);
                      setActiveSemesterId(sem.id);
                      await fetch('/api/semesters', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ semesters: updated }) });
                      try { if (typeof window !== 'undefined') window.localStorage.setItem('currentTerm', sem.id); } catch {}
                      try { notifySemesterChanged(); } catch {}
                      // Load this semester's availability if it has any
                      if (sem.windowsByDow) setWindowsByDow(sem.windowsByDow);
                      if (sem.breaksByDow) setBreaksByDow(sem.breaksByDow);
                    }} className="px-2 py-1 rounded border border-[#1b2344] text-xs hover:bg-white/5">Set Active</button>
                  )}
                  <button onClick={() => void deleteSemester(sem.id)} className="px-2 py-1 rounded border border-[#1b2344] text-xs text-rose-400 hover:bg-rose-500/10">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded border border-[#1b2344] p-4 space-y-3">
          <h3 className="text-sm font-medium">New semester</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-300/70 mb-1">Name (optional)</label>
              <input
                value={newSemester.name}
                onChange={e => setNewSemester(prev => ({ ...prev, name: e.target.value }))}
                placeholder={`${newSemester.season} ${newSemester.year}`}
                className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300/70 mb-1">Season</label>
              <select
                value={newSemester.season}
                onChange={e => setNewSemester(prev => ({ ...prev, season: e.target.value as typeof prev.season }))}
                className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2"
              >
                {(['Spring', 'Summer', 'Fall', 'Winter'] as const).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-300/70 mb-1">Year</label>
              <input
                type="number"
                value={newSemester.year}
                onChange={e => setNewSemester(prev => ({ ...prev, year: e.target.value }))}
                className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300/70 mb-1">Start date</label>
              <input
                type="date"
                value={newSemester.startDate}
                onChange={e => setNewSemester(prev => ({ ...prev, startDate: e.target.value }))}
                className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300/70 mb-1">End date</label>
              <input
                type="date"
                value={newSemester.endDate}
                onChange={e => setNewSemester(prev => ({ ...prev, endDate: e.target.value }))}
                className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300/70 self-end pb-2">
              <input
                type="checkbox"
                checked={newSemester.makeActive}
                onChange={e => setNewSemester(prev => ({ ...prev, makeActive: e.target.checked }))}
              />
              Make this the active semester
            </label>
          </div>
          <button
            onClick={() => void createSemester()}
            disabled={creatingSemester}
            className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-sm"
          >
            {creatingSemester ? 'Creating…' : 'Create semester'}
          </button>
          <p className="text-xs text-slate-300/60">
            This sets the exact date range and week numbering Week Plan uses. Without one, the
            app guesses a generic Aug 15 – Dec 20 fall window.
          </p>
        </div>
      </section>
    </main>
  );
}
