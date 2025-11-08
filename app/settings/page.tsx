"use client";
import { useEffect, useState } from "react";
function hueFromString(s: string): number { let h = 0; for (let i=0;i<s.length;i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h % 360; }
function fallbackCourseHsl(name?: string | null): string { const key=(name||'').toString().trim().toLowerCase(); if (!key) return 'hsl(215 16% 47%)'; const h=hueFromString(key); return `hsl(${h} 70% 55%)`; }
function hslToHex(h: number, s: number, l: number): string { s/=100; l/=100; const c=(1-Math.abs(2*l-1))*s; const x=c*(1-Math.abs(((h/60)%2)-1)); const m=l-c/2; let r=0,g=0,b=0; if (0<=h&&h<60){r=c;g=x;b=0;} else if (60<=h&&h<120){r=x;g=c;b=0;} else if (120<=h&&h<180){r=0;g=c;b=x;} else if (180<=h&&h<240){r=0;g=x;b=c;} else if (240<=h&&h<300){r=x;g=0;b=c;} else {r=c;g=0;b=x;} const R=Math.round((r+m)*255); const G=Math.round((g+m)*255); const B=Math.round((b+m)*255); const toHex=(n:number)=>n.toString(16).padStart(2,'0'); return `#${toHex(R)}${toHex(G)}${toHex(B)}`; }
function fallbackHex(name?: string | null): string { const hsl=fallbackCourseHsl(name); const m=hsl.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/i); if (!m) return '#6b7280'; const h=parseInt(m[1],10), s=parseInt(m[2],10), l=parseInt(m[3],10); return hslToHex(h,s,l); }

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

  useEffect(() => {
    (async () => {
      try { const r = await fetch('/api/courses', { cache: 'no-store' }); const d = await r.json(); const list = Array.isArray(d?.courses) ? d.courses : []; setCourses(list); const init: Record<string,string> = {}; for (const c of list) init[c.id] = c.color || fallbackHex(c.title); setLocalColors(init); } catch {}
    })();
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ls = window.localStorage.getItem('internshipColor');
      setInternshipColor(ls || fallbackHex('Internship'));
    }
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ls = window.localStorage.getItem('sportsLawReviewColor');
      setSportsLawReviewColor(ls || fallbackHex('Sports Law Review'));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("remindersEnabled", remindersEnabled ? "true" : "false");
  }, [remindersEnabled]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const n = Math.max(1, parseFloat(remindersLeadHours || "24") || 24);
    window.localStorage.setItem("remindersLeadHours", String(n));
  }, [remindersLeadHours]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const n = Math.max(1, Math.round(parseFloat(minutesPerPage || "3") || 3));
    window.localStorage.setItem("minutesPerPage", String(n));
  }, [minutesPerPage]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const n = Math.min(10, Math.max(1, Math.round(parseFloat(defaultFocus || "5") || 5)));
    window.localStorage.setItem("defaultFocus", String(n));
  }, [defaultFocus]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("icsToken", icsToken || "");
  }, [icsToken]);
  async function saveCourseColor(id: string, color: string) {
    try { setSavingId(id); const r = await fetch(`/api/courses/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }) }); if (r.ok) { const d = await r.json(); const updated = d?.course; if (updated) { setCourses(prev => prev.map((c:any)=>c.id===id?updated:c)); } } } finally { setSavingId(null); }
  }
  async function resetCourseColor(id: string) {
    const c = courses.find((x:any)=>x.id===id); const title = c?.title || '';
    try { setSavingId(id); const r = await fetch(`/api/courses/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color: null }) }); if (r.ok) { const d = await r.json(); const updated = d?.course; if (updated) { setCourses(prev => prev.map((c:any)=>c.id===id?updated:c)); setLocalColors(prev => ({ ...prev, [id]: fallbackHex(title) })); } } } finally { setSavingId(null); }
  }
  function saveInternColor() { try { if (typeof window !== 'undefined') window.localStorage.setItem('internshipColor', internshipColor || fallbackHex('Internship')); } catch {} }
  function resetInternColor() { const def = fallbackHex('Internship'); setInternshipColor(def); try { if (typeof window !== 'undefined') window.localStorage.removeItem('internshipColor'); } catch {} }
  function saveSlrColor() { try { if (typeof window !== 'undefined') window.localStorage.setItem('sportsLawReviewColor', sportsLawReviewColor || fallbackHex('Sports Law Review')); } catch {} }
  function resetSlrColor() { const def = fallbackHex('Sports Law Review'); setSportsLawReviewColor(def); try { if (typeof window !== 'undefined') window.localStorage.removeItem('sportsLawReviewColor'); } catch {} }
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
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: (internshipColor && /^#?[0-9a-fA-F]{6}$/.test(internshipColor) ? (internshipColor.startsWith('#')? internshipColor : `#${internshipColor}`) : fallbackHex('Internship')) }} />
                <div className="flex-1 truncate text-sm">Internship</div>
                <input type="color" value={/^#?[0-9a-fA-F]{6}$/.test(internshipColor||'') ? (internshipColor.startsWith('#')? internshipColor : `#${internshipColor}`) : fallbackHex('Internship')} onChange={e=>setInternshipColor(e.target.value)} className="h-7 w-12 bg-[#0b1020] border border-[#1b2344] rounded" />
                <button onClick={saveInternColor} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Save</button>
                <button onClick={resetInternColor} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Reset</button>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: (sportsLawReviewColor && /^#?[0-9a-fA-F]{6}$/.test(sportsLawReviewColor) ? (sportsLawReviewColor.startsWith('#')? sportsLawReviewColor : `#${sportsLawReviewColor}`) : fallbackHex('Sports Law Review')) }} />
                <div className="flex-1 truncate text-sm">Sports Law Review</div>
                <input type="color" value={/^#?[0-9a-fA-F]{6}$/.test(sportsLawReviewColor||'') ? (sportsLawReviewColor.startsWith('#')? sportsLawReviewColor : `#${sportsLawReviewColor}`) : fallbackHex('Sports Law Review')} onChange={e=>setSportsLawReviewColor(e.target.value)} className="h-7 w-12 bg-[#0b1020] border border-[#1b2344] rounded" />
                <button onClick={saveSlrColor} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Save</button>
                <button onClick={resetSlrColor} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Reset</button>
              </div>
              {courses.length === 0 ? (
                <div className="text-xs text-slate-300/60">No courses found.</div>
              ) : courses.map((c:any) => (
                <div key={c.id} className="flex items-center gap-3">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: (localColors[c.id] || c.color || fallbackHex(c.title)) }} />
                  <div className="flex-1 truncate text-sm">{c.title}</div>
                  <input type="color" value={localColors[c.id] || c.color || fallbackHex(c.title)} onChange={e=>setLocalColors(prev=>({ ...prev, [c.id]: e.target.value }))} className="h-7 w-12 bg-[#0b1020] border border-[#1b2344] rounded" />
                  <button onClick={()=>saveCourseColor(c.id, localColors[c.id] || c.color || fallbackHex(c.title))} className="px-2 py-1 rounded border border-[#1b2344] text-xs" disabled={savingId===c.id}>Save</button>
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
    </main>
  );
}
