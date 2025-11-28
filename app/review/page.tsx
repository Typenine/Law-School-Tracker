"use client";
import { useEffect, useMemo, useState } from "react";
import { getSessionCourse, buildTasksById } from "@/lib/courseMatching";

type Task = { id: string; title: string; course?: string | null };
type Session = { id: string; taskId?: string | null; when: string; minutes: number; focus?: number | null; notes?: string | null; activity?: string | null; pagesRead?: number | null };
type Course = { id: string; title: string; semester?: string | null; year?: number | null; startDate?: string | null; endDate?: string | null };

function chicagoYmd(d: Date): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  const p = f.formatToParts(d);
  return (p.find(x => x.type === "year")?.value || "") + "-" + (p.find(x => x.type === "month")?.value || "") + "-" + (p.find(x => x.type === "day")?.value || "");
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
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>("7d");

  useEffect(() => {
    (async () => {
      const [tRes, sRes, cRes] = await Promise.all([
        fetch("/api/tasks", { cache: "no-store" }),
        fetch("/api/sessions", { cache: "no-store" }),
        fetch("/api/courses", { cache: "no-store" }),
      ]);
      if (tRes.ok) setTasks((await tRes.json()).tasks || []);
      if (sRes.ok) setSessions((await sRes.json()).sessions || []);
      if (cRes.ok) setCourses((await cRes.json()).courses || []);
      setLoading(false);
    })();
  }, []);

  const semesters = useMemo(() => {
    const set = new Set<string>();
    for (const c of courses) if (c.semester && c.year) set.add(c.semester + " " + c.year);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [courses]);

  const tasksById = useMemo(() => buildTasksById(tasks), [tasks]);

  const filteredSessions = useMemo(() => {
    if (period === "all") return sessions;
    if (period.includes(" ")) {
      const semCourses = courses.filter(c => (c.semester + " " + c.year) === period);
      if (semCourses.length > 0) {
        let minD = "9999-12-31", maxD = "0000-01-01";
        for (const c of semCourses) { if (c.startDate && c.startDate < minD) minD = c.startDate; if (c.endDate && c.endDate > maxD) maxD = c.endDate; }
        return sessions.filter(s => { const ymd = chicagoYmd(new Date(s.when)); return ymd >= minD && ymd <= maxD; });
      }
    }
    const days = period === "7d" ? 7 : period === "14d" ? 14 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    return sessions.filter(s => chicagoYmd(new Date(s.when)) >= chicagoYmd(cutoff));
  }, [sessions, period, courses]);

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
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Review</h1>
        <div className="flex flex-wrap gap-2 items-center">
          {["7d", "14d", "30d", "90d", "all"].map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={"px-3 py-1.5 rounded-lg text-sm font-medium transition " + (period === p ? "bg-blue-600 text-white" : "bg-[#1b2344] text-slate-300 hover:bg-[#252d4a]")}>{p === "all" ? "All" : p}</button>
          ))}
          {semesters.length > 0 && (
            <select value={period.includes(" ") ? period : ""} onChange={e => { if (e.target.value) setPeriod(e.target.value); }} className="px-3 py-1.5 rounded-lg text-sm bg-[#1b2344] text-slate-300 border-0 cursor-pointer">
              <option value="">Semester</option>
              {semesters.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
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
            {byCourse.slice(0, 8).map(c => (
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
