"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Course } from "@/lib/types";
import { apiFetch } from "@/lib/apiClient";
import { notifySessionsChanged } from "@/lib/sessionsBus";
import { notifyToast } from "@/lib/toastBus";

type Action = "pause" | "partial" | "finish";
type Timer = {
  elapsedMs: number;
  creditedMinutes: number;
  running: boolean;
  startedAt?: number;
  subject?: string;
  description?: string;
};
const STORAGE_KEY = "quickStudyTimerV1";
const EMPTY: Timer = { elapsedMs: 0, creditedMinutes: 0, running: false };

function restore(): Timer {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return { ...EMPTY };
    const startedAt = Number(saved.startedAt);
    return {
      elapsedMs: Math.max(0, Number(saved.elapsedMs) || 0),
      creditedMinutes: Math.max(0, Number(saved.creditedMinutes) || 0),
      running: saved.running === true && Number.isFinite(startedAt) && startedAt > 0,
      startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : undefined,
      subject: typeof saved.subject === "string" ? saved.subject : "",
      description: typeof saved.description === "string" ? saved.description : "",
    };
  } catch {
    return { ...EMPTY };
  }
}
function elapsed(t: Timer): number {
  return t.elapsedMs + (t.running ? Math.max(0, Date.now() - (t.startedAt || Date.now())) : 0);
}
function stopped(t: Timer): Timer {
  return { ...t, elapsedMs: elapsed(t), running: false, startedAt: undefined };
}
function clock(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0") :
    String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
}

export default function QuickStudyTimer({ courses }: { courses: Course[] }) {
  const [timer, setTimer] = useState<Timer>(EMPTY);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const saved = restore();
    setTimer(saved);
    setSubject(saved.subject || "");
    setDescription(saved.description || "");
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(timer)); } catch {}
  }, [timer, ready]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue || action || saving) return;
      const saved = restore();
      setTimer(saved);
      setSubject(saved.subject || "");
      setDescription(saved.description || "");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [action, saving]);
  useEffect(() => {
    if (!timer.running) return;
    const id = window.setInterval(() => setTick(v => v + 1), 1000);
    return () => clearInterval(id);
  }, [timer.running]);

  void tick;
  const ms = elapsed(timer);
  // Round the overall elapsed time, not each pause, to prevent duplicate minutes.
  const minutesToLog = Math.max(0, Math.round(ms / 60000) - timer.creditedMinutes);
  const hasTime = ms > 0;
  const secondary = "rounded-lg border border-[#2c4a70] px-4 py-2 text-sm text-[#dce8f6] hover:bg-[#162d4d] disabled:opacity-40";
  const field = "w-full rounded-lg border border-[#2c4a70] bg-[#081629] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#59a8ef]";

  function start() {
    if (!ready || action) return;
    setTimer(t => t.running ? t : { ...t, running: true, startedAt: Date.now() });
  }
  function openLog(mode: Action) {
    if (!ready || !hasTime || action) return;
    setTimer(t => stopped(t));
    setAction(mode);
    setError("");
  }
  function discard() {
    if (!window.confirm("Discard this timer? Unlogged study time will be lost.")) return;
    setTimer({ ...EMPTY, subject, description });
  }
  async function saveLog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || saving) return;
    const cleanSubject = subject.trim().replace(/[\[\]\r\n]/g, "").slice(0, 90);
    const cleanDescription = description.trim().slice(0, 600);
    const minutes = Math.max(0, Math.round(timer.elapsedMs / 60000) - timer.creditedMinutes);
    if (!cleanSubject || !cleanDescription) { setError("Enter the subject and what you worked on."); return; }
    if (minutes < 1) { setError("Less than a minute remains to log. Resume the timer to record more time."); return; }
    setSaving(true);
    setError("");
    try {
      const status = action === "pause" ? "Paused" : action === "partial" ? "Partially finished" : "Finished";
      // Existing Study Log recognizes [Course] in notes for sessions with no task.
      await apiFetch("/api/sessions", {
        method: "POST",
        body: { taskId: null, minutes, focus: null, activity: "other",
          notes: "[" + cleanSubject + "] " + cleanDescription + " (" + status + ")" },
      });
      setSubject(cleanSubject);
      setDescription(cleanDescription);
      if (action === "pause") {
        setTimer(t => ({ ...t, running: false, startedAt: undefined,
          creditedMinutes: t.creditedMinutes + minutes, subject: cleanSubject, description: cleanDescription }));
      } else {
        setTimer({ ...EMPTY, subject: cleanSubject, description: cleanDescription });
      }
      notifySessionsChanged();
      notifyToast({ kind: "success", message: action === "pause" ? "Time logged. Resume when ready." :
        action === "partial" ? "Partial study session saved." : "Study session completed." });
      setAction(null);
    } catch (err: any) {
      setError(err?.message || "Could not save your study time. Your timer is preserved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="dash-card mb-5 p-5 sm:p-6" aria-label="Quick study timer">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="dash-eyebrow">Unscheduled study</div>
          <h2 className="mt-1 text-xl font-semibold text-white">Quick study timer</h2>
          <p className="mt-1 text-sm text-[#9bb9dd]">Track study time without a task or scheduled start and end time.</p>
        </div>
        <div className="text-3xl sm:text-4xl font-semibold tabular-nums text-white">{clock(ms)}</div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {!timer.running ? (
          <button type="button" onClick={start} disabled={!ready} className="rounded-lg bg-[#ffcc00] px-5 py-2.5 font-semibold text-[#06152b] hover:bg-[#ffdb4d] disabled:opacity-40">
            {hasTime ? "Resume" : "Start timer"}
          </button>
        ) : <button type="button" onClick={() => openLog("pause")} className={secondary}>Pause</button>}
        {hasTime ? (
          <>
            <button type="button" onClick={() => openLog("partial")} className={secondary}>Partial finish</button>
            <button type="button" onClick={() => openLog("finish")} className="rounded-lg border border-[#2f6f58] bg-[#0e2a20] px-4 py-2 text-sm font-medium text-[#9be3bd] hover:bg-[#173b2d]">Finish task</button>
            {!timer.running ? <button type="button" onClick={discard} className="ml-auto text-xs text-[#8da7c5] underline hover:text-white">Discard timer</button> : null}
          </>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-[#8da7c5]">{timer.running ? "Timer running, including when you leave this page." : hasTime ? "Paused. You can resume or log your remaining time." : "Start whenever you are ready."}{timer.creditedMinutes ? " " + timer.creditedMinutes + " minutes already logged." : ""}</p>
      {action ? (
        <div role="dialog" aria-modal="true" aria-labelledby="quick-study-dialog-title" className="fixed inset-0 z-[20000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/75" onClick={() => { if (!saving) setAction(null); }} />
          <form onSubmit={saveLog} className="relative z-10 w-full max-w-md space-y-4 rounded-xl border border-[#2c4a70] bg-[#0e1c2f] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="quick-study-dialog-title" className="text-lg font-semibold text-white">{action === "pause" ? "Pause and log study time" : action === "partial" ? "Log partial progress" : "Finish and log study time"}</h2>
                <p className="mt-1 text-sm text-[#9bb9dd]">{minutesToLog} minute{minutesToLog === 1 ? "" : "s"} to record. No task will be created.</p>
              </div>
              <button type="button" aria-label="Close" disabled={saving} onClick={() => setAction(null)} className="text-xl text-[#9bb9dd] hover:text-white">×</button>
            </div>
            <div>
              <label htmlFor="quick-study-subject" className="mb-1 block text-sm text-[#dce8f6]">Subject or course</label>
              <input id="quick-study-subject" autoFocus required maxLength={90} list="quick-study-courses" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Evidence" className={field} />
              <datalist id="quick-study-courses">{courses.map(c => <option key={c.id} value={c.title} />)}</datalist>
            </div>
            <div>
              <label htmlFor="quick-study-description" className="mb-1 block text-sm text-[#dce8f6]">What did you work on?</label>
              <textarea id="quick-study-description" required maxLength={600} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Hearsay practice questions" className={field} />
            </div>
            {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
            <div className="flex justify-end gap-3">
              <button type="button" disabled={saving} onClick={() => setAction(null)} className={secondary}>Cancel</button>
              <button type="submit" disabled={saving || minutesToLog < 1} className="rounded-lg bg-[#ffcc00] px-4 py-2 text-sm font-semibold text-[#06152b] disabled:opacity-40">{saving ? "Saving..." : "Save " + minutesToLog + "m"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
