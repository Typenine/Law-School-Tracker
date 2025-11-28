"use client";
import { useEffect, useMemo, useState } from "react";
import { getSessionCourse, buildTasksById } from "@/lib/courseMatching";

type Task = { id: string; title: string; course?: string | null; };
type Session = { id: string; taskId?: string | null; when: string; minutes: number; focus?: number | null; notes?: string | null; activity?: string | null; pagesRead?: number | null; };

function chicagoYmd(d: Date): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  const p = f.formatToParts(d);
  return p.find(x=>x.type==="year")?.value + "-" + p.find(x=>x.type==="month")?.value + "-" + p.find(x=>x.type==="day")?.value;
}

function fmtHM(min: number): string {
  const n = Math.max(0, Math.round(min || 0));
  const h = Math.floor(n / 60), m = n % 60;
  if (h > 0 && m > 0) return h + "h " + m + "m";
  if (h > 0) return h + "h";
  return m + "m";
}

function focusColor(f: number): string {
  if (f >= 8) return "text-emerald-400";
  if (f >= 6) return "text-blue-400";
  if (f >= 4) return "text-amber-400";
  return "text-rose-400";
}

export default function ReviewPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<7 | 14 | 30>(7);

  useEffect(() => {
    (async () => {
      const [tRes, sRes] = await Promise.all([
        fetch("/api/tasks", { cache: "no-store" }),
        fetch("/api/sessions", { cache: "no-store" }),
      ]);
      if (tRes.ok) setTasks((await tRes.json()).tasks || []);
      if (sRes.ok) setSessions((await sRes.json()).sessions || []);
      setLoading(false);
    })();
  }, []);

  const tasksById = useMemo(() => buildTasksById(tasks), [tasks]);
  const cutoffDate = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - period); return chicagoYmd(d); }, [period]);
  const filteredSessions = useMemo(() => sessions.filter(s => chicagoYmd(new Date(s.when)) >= cutoffDate), [sessions, cutoffDate]);

  const summaryStats = useMemo(() => {
    let totalMinutes = 0, totalSessions = 0, totalPages = 0, focusSum = 0, focusCount = 0;
    for (const s of filteredSessions) {
      totalMinutes += s.minutes || 0; totalSessions++; totalPages += s.pagesRead || 0;
      if (typeof s.focus === "number" && s.focus > 0) { focusSum += s.focus; focusCount++; }
    }
    return { totalMinutes, totalSessions, totalPages, avgFocus: focusCount > 0 ? focusSum / focusCount : 0 };
  }, [filteredSessions]);

  const byCourse = useMemo(() => {
    const map = new Map<string, { minutes: number; sessions: number; pages: number; focusSum: number; focusCount: number }>();
    for (const s of filteredSessions) {
      const c = getSessionCourse(s, tasksById);
      const e = map.get(c) || { minutes: 0, sessions: 0, pages: 0, focusSum: 0, focusCount: 0 };
      e.minutes += s.minutes || 0; e.sessions++; e.pages += s.pagesRead || 0;
      if (typeof s.focus === "number" && s.focus > 0) { e.focusSum += s.focus; e.focusCount++; }
      map.set(c, e);
    }
    return Array.from(map.entries()).map(([course, v]) => ({
      course, minutes: v.minutes, sessions: v.sessions, pages: v.pages,
      avgFocus: v.focusCount > 0 ? v.focusSum / v.focusCount : 0,
      minutesPerPage: v.pages > 0 ? v.minutes / v.pages : 0,
    })).sort((a, b) => b.minutes - a.minutes);
  }, [filteredSessions, tasksById]);

  if (loading) return <main className="p-6"><div className="text-slate-400">Loading...</div></main>;

  return (
    <main className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Review</h1>
        <div className="flex gap-2">
          {([7, 14, 30] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={"px-3 py-1.5 rounded-lg text-sm font-medium transition " + (period === p ? "bg-blue-600 text-white" : "bg-[#1b2344] text-slate-300 hover:bg-[#252d4a]")}>
              {p}d
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4"><div className="text-slate-400 text-xs uppercase mb-1">Total Time</div><div className="text-2xl font-bold">{fmtHM(summaryStats.totalMinutes)}</div></div>
        <div className="card p-4"><div className="text-slate-400 text-xs uppercase mb-1">Sessions</div><div className="text-2xl font-bold">{summaryStats.totalSessions}</div></div>
        <div className="card p-4"><div className="text-slate-400 text-xs uppercase mb-1">Pages Read</div><div className="text-2xl font-bold">{summaryStats.totalPages}</div></div>
        <div className="card p-4"><div className="text-slate-400 text-xs uppercase mb-1">Avg Focus</div><div className={"text-2xl font-bold " + (summaryStats.avgFocus > 0 ? focusColor(summaryStats.avgFocus) : "")}>{summaryStats.avgFocus > 0 ? summaryStats.avgFocus.toFixed(1) + "/10" : "-"}</div></div>
      </div>
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-3">By Course</h2>
        {byCourse.length === 0 ? <div className="text-slate-400 text-sm">No sessions</div> : (
          <div className="space-y-3">
            {byCourse.slice(0, 6).map(c => (
              <div key={c.course} className="space-y-1">
                <div className="flex justify-between"><span className="font-medium truncate max-w-[60%]">{c.course}</span><span className="text-slate-300">{fmtHM(c.minutes)}</span></div>
                <div className="flex gap-4 text-xs text-slate-400"><span>{c.sessions} sessions</span>{c.pages > 0 && <span>{c.pages} pages</span>}{c.avgFocus > 0 && <span className={focusColor(c.avgFocus)}>Focus: {c.avgFocus.toFixed(1)}</span>}</div>
                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: Math.min(100, (c.minutes / (summaryStats.totalMinutes || 1)) * 100) + "%" }} /></div>
              </div>
            ))}
          </div>
        )}
      </div>
      {byCourse.some(c => c.pages > 0) && (
        <div className="card p-4">
          <h2 className="text-lg font-semibold mb-3">Reading Pace</h2>
          <table className="w-full text-sm"><thead className="text-left text-slate-400"><tr><th className="py-2 pr-4">Course</th><th className="py-2 pr-4">Time</th><th className="py-2 pr-4">Pages</th><th className="py-2 pr-4">Min/Page</th></tr></thead>
            <tbody>{byCourse.filter(c => c.pages > 0).map(c => (<tr key={c.course} className="border-t border-[#1b2344]"><td className="py-2 pr-4">{c.course}</td><td className="py-2 pr-4">{fmtHM(c.minutes)}</td><td className="py-2 pr-4">{c.pages}</td><td className="py-2 pr-4 font-medium">{c.minutesPerPage.toFixed(1)}</td></tr>))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
