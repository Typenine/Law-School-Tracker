"use client";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [remindersEnabled, setRemindersEnabled] = useState<boolean>(false);
  const [remindersLeadHours, setRemindersLeadHours] = useState<string>("24");
  const [minutesPerPage, setMinutesPerPage] = useState<string>("3");
  const [defaultFocus, setDefaultFocus] = useState<string>("5");
  const [icsToken, setIcsToken] = useState<string>("");

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
    } catch {}
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
            <h3 className="text-sm font-medium">Minutes per Page</h3>
            <div className="flex items-center gap-2">
              <label htmlFor="mpp" className="text-xs text-slate-300/70">Default</label>
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
        </div>
        <div>
          <a href="/settings/import" className="inline-flex items-center px-3 py-2 rounded border border-[#1b2344] hover:bg-[#0b1020] text-sm">Import Data (CSV)</a>
        </div>
      </section>
    </main>
  );
}
