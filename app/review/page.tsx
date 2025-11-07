"use client";
import { useEffect, useMemo, useState } from "react";

// Minimal shapes matching our APIs
type Task = {
  id: string;
  title: string;
  course?: string | null;
  dueDate: string;
  status: "todo" | "done";
  estimatedMinutes?: number | null;
  actualMinutes?: number | null;
};

type StudySession = {
  id: string;
  taskId?: string | null;
  when: string; // ISO
  minutes: number;
  focus?: number | null;
  notes?: string | null;
};

type PlannedBlock = {
  id: string;
  taskId?: string | null;
  day: string; // YYYY-MM-DD
  plannedMinutes: number;
  guessed?: boolean;
  title?: string;
  course?: string | null;
};

export default function ReviewPage() {
  // Data
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);

  // Fetch tasks and sessions (no spinners; render zeros by default)
  useEffect(() => {
    (async () => {
      try {
        const [tRes, sRes] = await Promise.all([
          fetch("/api/tasks", { cache: "no-store" }).catch(() => null),
          fetch("/api/sessions", { cache: "no-store" }).catch(() => null),
        ]);
        if (tRes && tRes.ok) {
          const tj = await tRes.json();
          setTasks(Array.isArray(tj?.tasks) ? tj.tasks : []);
        }
        if (sRes && sRes.ok) {
          const sj = await sRes.json();
          setSessions(Array.isArray(sj?.sessions) ? sj.sessions : []);
        }
      } catch {}
    })();
  }, []);

  // Local planned schedule from Week Plan board
  const plannedBlocks: PlannedBlock[] = useMemo(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("weekScheduleV1") || "[]";
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter((b) => b && typeof b === "object");
    } catch {
      return [];
    }
  }, []);

  // Chicago timezone helpers
  function chicagoParts(d: Date) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const s = fmt.format(d); // YYYY-MM-DD
    const [y, m, da] = s.split("-").map((x) => parseInt(x, 10));
    return { y, m, d: da };
  }
  function ymdFromParts(y: number, m: number, d: number) {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  function chicagoYMD(d: Date) {
    const p = chicagoParts(d);
    return ymdFromParts(p.y, p.m, p.d);
  }
  function addDays(y: number, m: number, d: number, delta: number) {
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    const p = { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
    return p;
  }
  function weekRangeChicago(today: Date) {
    const p = chicagoParts(today);
    const asDate = new Date(p.y, p.m - 1, p.d);
    const dow = asDate.getDay(); // 0=Sun..6=Sat
    const mondayOffset = ((dow + 6) % 7) * -1; // back to Monday
    const startP = addDays(p.y, p.m, p.d, mondayOffset);
    const endP = addDays(startP.y, startP.m, startP.d, 6);
    return { startYMD: ymdFromParts(startP.y, startP.m, startP.d), endYMD: ymdFromParts(endP.y, endP.m, endP.d) };
  }
  const { startYMD, endYMD } = useMemo(() => weekRangeChicago(new Date()), []);

  // Helper to compare YMD range inclusive
  function inYmdRange(ymd: string, start: string, end: string) {
    return ymd >= start && ymd <= end;
  }

  // Extract course from notes like "[Course] ..."
  function extractCourseFromNotes(notes?: string | null): string | null {
    if (!notes) return null;
    const m = notes.match(/^\s*\[([^\]]+)\]/);
    return m ? m[1].trim() : null;
  }

  const tasksById = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  // Planned vs Actual (current week) by course
  const plannedVsActual = useMemo(() => {
    const plannedByCourse = new Map<string, number>();
    for (const b of plannedBlocks) {
      if (!b || typeof b !== "object") continue;
      const course = (b.course || "Unassigned") as string;
      if (b.day && inYmdRange(b.day, startYMD, endYMD)) {
        plannedByCourse.set(course, (plannedByCourse.get(course) || 0) + Math.max(0, Number(b.plannedMinutes) || 0));
      }
    }
    const actualByCourse = new Map<string, number>();
    for (const s of sessions) {
      const ymd = chicagoYMD(new Date(s.when));
      if (!inYmdRange(ymd, startYMD, endYMD)) continue;
      const task = s.taskId ? tasksById.get(s.taskId) : undefined;
      const course = (task?.course || extractCourseFromNotes(s.notes) || "Unassigned") as string;
      actualByCourse.set(course, (actualByCourse.get(course) || 0) + Math.max(0, Number(s.minutes) || 0));
    }
    const courses = Array.from(new Set([...plannedByCourse.keys(), ...actualByCourse.keys()])).sort((a, b) => (a || "").localeCompare(b || ""));
    const rows = courses.map((c) => {
      const planned = plannedByCourse.get(c) || 0;
      const actual = actualByCourse.get(c) || 0;
      const delta = actual - planned;
      return { course: c, planned, actual, delta };
    });
    const totals = rows.reduce(
      (acc, r) => ({ planned: acc.planned + r.planned, actual: acc.actual + r.actual, delta: acc.delta + r.delta }),
      { planned: 0, actual: 0, delta: 0 }
    );
    return { rows, totals };
  }, [plannedBlocks, sessions, tasksById, startYMD, endYMD]);

  // Estimation Error by Course: average (Actual−Estimated)/Estimated, count
  const estimationByCourse = useMemo(() => {
    // Sum sessions by taskId for actuals
    const actualByTask = new Map<string, number>();
    for (const s of sessions) {
      const id = s.taskId || "";
      if (!id) continue;
      actualByTask.set(id, (actualByTask.get(id) || 0) + Math.max(0, Number(s.minutes) || 0));
    }
    const agg = new Map<string, { sumRatio: number; count: number }>();
    for (const t of tasks) {
      const est = Number(t.estimatedMinutes) || 0;
      const actual = (t.actualMinutes && t.actualMinutes > 0 ? t.actualMinutes : (actualByTask.get(t.id) || 0)) || 0;
      if (est > 0 && actual > 0) {
        const ratio = (actual - est) / est; // positive => underestimated
        const c = t.course || "Unassigned";
        const cur = agg.get(c) || { sumRatio: 0, count: 0 };
        cur.sumRatio += ratio;
        cur.count += 1;
        agg.set(c, cur);
      }
    }
    const rows = Array.from(agg.entries())
      .map(([course, v]) => ({ course, avgRatio: v.count ? v.sumRatio / v.count : 0, count: v.count }))
      .sort((a, b) => (a.course || "").localeCompare(b.course || ""));
    return { rows };
  }, [tasks, sessions]);

  // Focus Averages: 7/14/30-day (sessions with non-null focus)
  function avgFocusSince(days: number) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const vals: number[] = [];
    for (const s of sessions) {
      if (s.focus == null) continue;
      const ts = new Date(s.when).getTime();
      if (ts >= cutoff) vals.push(s.focus);
    }
    if (vals.length === 0) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const focus7 = useMemo(() => avgFocusSince(7), [sessions]);
  const focus14 = useMemo(() => avgFocusSince(14), [sessions]);
  const focus30 = useMemo(() => avgFocusSince(30), [sessions]);

  // Summary (2–3 bullets)
  const summaryBullets = useMemo(() => {
    const bullets: string[] = [];
    // Week total delta
    const tot = plannedVsActual.totals;
    if (tot.planned > 0 || tot.actual > 0) {
      const diff = Math.round(Math.abs(tot.actual - tot.planned));
      const dir = tot.actual >= tot.planned ? "over" : "under";
      bullets.push(`Week ${dir} plan ~${diff}m`);
    }
    // Biggest underestimation course
    if (estimationByCourse.rows.length > 0) {
      const mostUnder = [...estimationByCourse.rows].sort((a, b) => b.avgRatio - a.avgRatio)[0];
      if (mostUnder && mostUnder.count > 0 && mostUnder.avgRatio > 0) {
        bullets.push(`${mostUnder.course} underestimates ~${Math.round(mostUnder.avgRatio * 100)}%`);
      }
    }
    // Focus 7d
    if (focus7 > 0) bullets.push(`Avg focus 7d: ${focus7.toFixed(1)}`);
    return bullets.slice(0, 3);
  }, [plannedVsActual, estimationByCourse, focus7]);

  function fmtPct(n: number) {
    if (!isFinite(n)) return "0%";
    return `${(n * 100).toFixed(1)}%`;
  }

  return (
    <main className="space-y-6">
      <section className="card p-5">
        <h2 className="text-xl font-semibold mb-2">Review</h2>
        <ul className="list-disc list-inside text-sm text-slate-300/90">
          {summaryBullets.length === 0 ? (
            <li>No data yet. Start planning and logging to see insights.</li>
          ) : (
            summaryBullets.map((b, i) => <li key={i}>{b}</li>)
          )}
        </ul>
      </section>

      {/* 1) Planned vs Actual (current week) */}
      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Planned vs Actual (This Week)</h3>
        <div className="text-xs text-slate-300/60">Week: {startYMD} → {endYMD} (America/Chicago)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-1 pr-2">Course</th>
                <th className="py-1 pr-2">Planned Minutes</th>
                <th className="py-1 pr-2">Actual Minutes</th>
                <th className="py-1 pr-2">Delta</th>
              </tr>
            </thead>
            <tbody>
              {plannedVsActual.rows.length === 0 ? (
                <tr className="border-t border-[#1b2344]"><td className="py-1 pr-2">—</td><td className="py-1 pr-2">0</td><td className="py-1 pr-2">0</td><td className="py-1 pr-2">0</td></tr>
              ) : (
                plannedVsActual.rows.map((r) => (
                  <tr key={r.course} className="border-t border-[#1b2344]">
                    <td className="py-1 pr-2">{r.course || 'Unassigned'}</td>
                    <td className="py-1 pr-2">{Math.round(r.planned)}</td>
                    <td className="py-1 pr-2">{Math.round(r.actual)}</td>
                    <td className="py-1 pr-2">{Math.round(r.delta)}</td>
                  </tr>
                ))
              )}
              <tr className="border-t border-[#1b2344] font-medium">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 pr-2">{Math.round(plannedVsActual.totals.planned)}</td>
                <td className="py-1 pr-2">{Math.round(plannedVsActual.totals.actual)}</td>
                <td className="py-1 pr-2">{Math.round(plannedVsActual.totals.delta)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 2) Estimation Error by Course */}
      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Estimation Error by Course</h3>
        <div className="text-xs text-slate-300/60">Average of (Actual−Estimated)/Estimated per completed task</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-1 pr-2">Course</th>
                <th className="py-1 pr-2">Avg Error</th>
                <th className="py-1 pr-2">Count</th>
              </tr>
            </thead>
            <tbody>
              {estimationByCourse.rows.length === 0 ? (
                <tr className="border-t border-[#1b2344]"><td className="py-1 pr-2">—</td><td className="py-1 pr-2">0%</td><td className="py-1 pr-2">0</td></tr>
              ) : (
                estimationByCourse.rows.map((r) => (
                  <tr key={r.course} className="border-t border-[#1b2344]">
                    <td className="py-1 pr-2">{r.course || 'Unassigned'}</td>
                    <td className="py-1 pr-2">{fmtPct(r.avgRatio)}</td>
                    <td className="py-1 pr-2">{r.count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3) Focus Averages */}
      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Focus Averages</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-1 pr-2">Window</th>
                <th className="py-1 pr-2">Avg Focus</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[#1b2344]"><td className="py-1 pr-2">7-day</td><td className="py-1 pr-2">{focus7 ? focus7.toFixed(1) : "0.0"}</td></tr>
              <tr className="border-t border-[#1b2344]"><td className="py-1 pr-2">14-day</td><td className="py-1 pr-2">{focus14 ? focus14.toFixed(1) : "0.0"}</td></tr>
              <tr className="border-t border-[#1b2344]"><td className="py-1 pr-2">30-day</td><td className="py-1 pr-2">{focus30 ? focus30.toFixed(1) : "0.0"}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
