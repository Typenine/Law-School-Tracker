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
  activity?: string | null;
  pagesRead?: number | null;
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
  function chicagoHour(d: Date) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).formatToParts(d);
    const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    return isNaN(h) ? 0 : h;
  }
  function fmtHourRange2(startHour: number) {
    const end = (startHour + 2) % 24;
    const to12 = (h: number) => { const ap = h >= 12 ? 'pm' : 'am'; const h12 = ((h + 11) % 12) + 1; return { h12, ap }; };
    const a = to12(startHour), b = to12(end);
    // If both AM or both PM and end != 0 equivalence, keep ap once
    if (a.ap === b.ap) return `${a.h12}–${b.h12}${a.ap}`;
    return `${a.h12}${a.ap}–${b.h12}${b.ap}`;
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

  function fmtHM(min: number): string {
    const n = Math.max(0, Math.round(Number(min) || 0));
    const h = Math.floor(n / 60);
    const m = n % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  // Extract course from notes like "[Course] ..."
  function extractCourseFromNotes(notes?: string | null): string | null {
    if (!notes) return null;
    const m = notes.match(/^\s*\[([^\]]+)\]/);
    return m ? m[1].trim() : null;
  }

  function deriveCourseForSession(s: StudySession, task?: Task): string {
    // 1) Internship overrides to its own bucket
    const act = (s.activity || '').toLowerCase();
    if (act === 'internship') return 'Internship';
    // 2) Base course from task or [Course] in notes
    let base = (task?.course || extractCourseFromNotes(s.notes) || '').toString().trim();
    const notesL = (s.notes || '').toLowerCase();
    const baseL = base.toLowerCase();
    // 3) Sports Law Review detection from course/notes keywords
    if (baseL.includes('sports law review') || notesL.includes('sports law review') || /\bslr\b/i.test(s.notes || '')) {
      return 'Sports Law Review';
    }
    if (act === 'review' && (baseL.includes('amateur sports law') || baseL === 'sports law')) {
      return 'Sports Law Review';
    }
    // 4) Default
    return base || 'Unassigned';
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
      const course = deriveCourseForSession(s, task);
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

  function activityLabel(a?: string | null): string {
    const x = (a || '').toLowerCase();
    if (x === 'reading') return 'Reading';
    if (x === 'review') return 'Review';
    if (x === 'outline') return 'Outline';
    if (x === 'practice') return 'Practice';
    if (x === 'internship') return 'Other';
    if (!x) return 'Other';
    return x[0].toUpperCase() + x.slice(1);
  }

  // 30-day window aggregations
  const { startYMD30 } = useMemo(() => {
    // Last 30 days inclusive ending today in Chicago
    const today = new Date();
    const ymdToday = chicagoYMD(today);
    const parts = ymdToday.split('-').map(v => parseInt(v, 10));
    const d0 = new Date(parts[0], parts[1] - 1, parts[2]);
    const start = new Date(d0);
    start.setDate(start.getDate() - 29); // 30-day span
    return { startYMD30: chicagoYMD(start) };
  }, []);

  type CourseAggRow = { course: string; minutes: number; sessions: number; avgFocus: number };
  const courseAgg30 = useMemo(() => {
    const map = new Map<string, { minutes: number; sessions: number; focusSum: number; focusCount: number }>();
    for (const s of sessions) {
      const ymd = chicagoYMD(new Date(s.when));
      if (ymd < startYMD30) continue;
      const task = s.taskId ? tasksById.get(s.taskId) : undefined;
      const course = deriveCourseForSession(s, task);
      const entry = map.get(course) || { minutes: 0, sessions: 0, focusSum: 0, focusCount: 0 };
      entry.minutes += Math.max(0, Number(s.minutes) || 0);
      entry.sessions += 1;
      if (typeof s.focus === 'number') { entry.focusSum += s.focus; entry.focusCount += 1; }
      map.set(course, entry);
    }
    const rows: CourseAggRow[] = Array.from(map.entries()).map(([course, v]) => ({
      course,
      minutes: v.minutes,
      sessions: v.sessions,
      avgFocus: v.focusCount > 0 ? v.focusSum / v.focusCount : 0,
    })).sort((a, b) => (a.course || '').localeCompare(b.course || ''));
    const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
    const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);
    const focusSum = rows.reduce((s, r) => s + (r.avgFocus * r.sessions), 0);
    const focusCount = totalSessions;
    const weightedAvgFocus = focusCount > 0 ? (focusSum / focusCount) : 0;
    return { rows, totalMinutes, totalSessions, weightedAvgFocus };
  }, [sessions, tasksById, startYMD30]);

  type ActivityAggRow = { activity: string; minutes: number; sessions: number; avgFocus: number };
  const activityAgg30 = useMemo(() => {
    const map = new Map<string, { minutes: number; sessions: number; focusSum: number; focusCount: number }>();
    for (const s of sessions) {
      const ymd = chicagoYMD(new Date(s.when));
      if (ymd < startYMD30) continue;
      const label = activityLabel(s.activity);
      const entry = map.get(label) || { minutes: 0, sessions: 0, focusSum: 0, focusCount: 0 };
      entry.minutes += Math.max(0, Number(s.minutes) || 0);
      entry.sessions += 1;
      if (typeof s.focus === 'number') { entry.focusSum += s.focus; entry.focusCount += 1; }
      map.set(label, entry);
    }
    const rows: ActivityAggRow[] = Array.from(map.entries()).map(([activity, v]) => ({
      activity,
      minutes: v.minutes,
      sessions: v.sessions,
      avgFocus: v.focusCount > 0 ? v.focusSum / v.focusCount : 0,
    })).sort((a, b) => (a.activity || '').localeCompare(b.activity || ''));
    const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
    const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);
    const focusSum = rows.reduce((s, r) => s + (r.avgFocus * r.sessions), 0);
    const focusCount = totalSessions;
    const weightedAvgFocus = focusCount > 0 ? (focusSum / focusCount) : 0;
    return { rows, totalMinutes, totalSessions, weightedAvgFocus };
  }, [sessions, startYMD30]);

  // Reading Pace by Course (Last 30 days)
  type PaceRow = { course: string; minutes: number; pages: number; sessions: number; mpp: number };
  const paceByCourse30 = useMemo(() => {
    const map = new Map<string, { minutes: number; pages: number; sessions: number }>();
    for (const s of sessions) {
      const ymd = chicagoYMD(new Date(s.when));
      if (ymd < startYMD30) continue;
      const pages = Math.max(0, Number((s as any).pagesRead) || 0);
      if (pages <= 0) continue;
      const isReading = (s.activity || '').toLowerCase() === 'reading';
      if (!isReading) continue;
      const task = s.taskId ? tasksById.get(s.taskId) : undefined;
      const course = deriveCourseForSession(s, task);
      const entry = map.get(course) || { minutes: 0, pages: 0, sessions: 0 };
      entry.minutes += Math.max(0, Number(s.minutes) || 0);
      entry.pages += pages;
      entry.sessions += 1;
      map.set(course, entry);
    }
    const rows: PaceRow[] = Array.from(map.entries()).map(([course, v]) => ({
      course,
      minutes: v.minutes,
      pages: v.pages,
      sessions: v.sessions,
      mpp: v.pages > 0 ? v.minutes / v.pages : 0,
    })).sort((a, b) => (a.course || '').localeCompare(b.course || ''));
    return { rows };
  }, [sessions, tasksById, startYMD30]);

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

  // Best time-of-day window (last 30 days), 2-hour block, >= 3 sessions
  const bestWindow = useMemo(() => {
    const hour = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));
    for (const s of sessions) {
      if (s.focus == null) continue;
      const ymd = chicagoYMD(new Date(s.when));
      if (ymd < startYMD30) continue;
      const h = chicagoHour(new Date(s.when));
      hour[h].sum += s.focus;
      hour[h].count += 1;
    }
    let best: { start: number; avg: number; n: number } | null = null;
    for (let h = 0; h < 24; h++) {
      const h2 = (h + 1) % 24;
      const sum = hour[h].sum + hour[h2].sum;
      const n = hour[h].count + hour[h2].count;
      if (n >= 3) {
        const avg = sum / Math.max(n, 1);
        if (!best || avg > best.avg) best = { start: h, avg, n };
      }
    }
    return best; // null if not enough data
  }, [sessions, startYMD30]);

  // Slump detector: 14d < 30d - 1.0 and >= 10 sessions last 30 days
  const slump = useMemo(() => {
    let n30 = 0;
    for (const s of sessions) {
      if (s.focus == null) continue;
      const ymd = chicagoYMD(new Date(s.when));
      if (ymd >= startYMD30) n30 += 1;
    }
    const falling = focus14 < (focus30 - 1.0);
    return { isSlump: falling && n30 >= 10, n30 };
  }, [sessions, focus14, focus30, startYMD30]);

  // Weekly Burndown selectors
  const LS_AVAIL = 'availabilityTemplateV1';
  const LS_GOALS = 'weeklyGoalsV1';
  function loadGoals(): Array<{ id: string; scope: 'global'|'course'; weeklyMinutes: number; course?: string|null }>{
    if (typeof window === 'undefined') return [];
    try { const raw = window.localStorage.getItem(LS_GOALS) || '[]'; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; } catch { return []; }
  }
  const weeklyGoalMinutes = useMemo(() => {
    const list = loadGoals();
    const g = list.find(x => x && x.scope === 'global');
    return Math.max(0, Number(g?.weeklyMinutes) || 0);
  }, []);
  const availabilityByDow = useMemo(() => {
    if (typeof window === 'undefined') return {} as Record<number, number>;
    try { const raw = window.localStorage.getItem(LS_AVAIL) || '{}'; const obj = JSON.parse(raw) || {}; return obj as Record<number, number>; } catch { return {} as Record<number, number>; }
  }, []);
  const weekDays = useMemo(() => {
    const [y, m, d] = startYMD.split('-').map(v => parseInt(v, 10));
    const base = new Date(y, (m as number) - 1, d);
    const arr: string[] = [];
    for (let i = 0; i < 7; i++) { const dt = new Date(base); dt.setDate(dt.getDate() + i); arr.push(chicagoYMD(dt)); }
    return arr;
  }, [startYMD]);
  const plannedByDayY = useMemo(() => {
    const map = new Map<string, number>();
    for (const day of weekDays) map.set(day, 0);
    for (const b of plannedBlocks) {
      if (!b?.day) continue;
      if (!inYmdRange(b.day, startYMD, endYMD)) continue;
      map.set(b.day, (map.get(b.day) || 0) + Math.max(0, Number(b.plannedMinutes) || 0));
    }
    return map;
  }, [plannedBlocks, weekDays, startYMD, endYMD]);
  const actualByDayY = useMemo(() => {
    const map = new Map<string, number>();
    for (const day of weekDays) map.set(day, 0);
    for (const s of sessions) {
      const k = chicagoYMD(new Date(s.when));
      if (!inYmdRange(k, startYMD, endYMD)) continue;
      map.set(k, (map.get(k) || 0) + Math.max(0, Number(s.minutes) || 0));
    }
    return map;
  }, [sessions, weekDays, startYMD, endYMD]);
  const burndownRows = useMemo(() => {
    let cumActual = 0;
    return weekDays.map((day) => {
      const planned = Math.round(plannedByDayY.get(day) || 0);
      const actual = Math.round(actualByDayY.get(day) || 0);
      cumActual += actual;
      const remainingGoal = Math.max(0, Math.round(weeklyGoalMinutes - cumActual));
      const dow = new Date(day).toLocaleDateString(undefined, { weekday: 'short' });
      return { day, dow, planned, actual, remainingGoal };
    });
  }, [weekDays, plannedByDayY, actualByDayY, weeklyGoalMinutes]);
  const burndownSummary = useMemo(() => {
    if (weeklyGoalMinutes <= 0) return { text: 'No weekly goal set.', delta: 0 } as const;
    const todayY = chicagoYMD(new Date());
    const todayIdx = weekDays.findIndex(d => d === todayY);
    const idx = todayIdx === -1 ? Math.min(6, weekDays.length - 1) : todayIdx;
    const workdays = weekDays.filter(d => (availabilityByDow[new Date(d).getDay()] || 0) > 0);
    const totalWork = workdays.length || 7;
    const completedWork = workdays.filter(d => d <= weekDays[idx]).length;
    const cumActualToDate = burndownRows.filter(r => r.day <= weekDays[idx]).reduce((s, r) => s + r.actual, 0);
    const expectedByNow = Math.round(weeklyGoalMinutes * (completedWork / Math.max(totalWork, 1)));
    const delta = cumActualToDate - expectedByNow; // >0 ahead
    const aheadBehind = delta >= 0 ? 'ahead' : 'behind';
    // Finish day at current pace
    const avgPerWorkday = completedWork > 0 ? cumActualToDate / completedWork : 0;
    let finishDay = '—';
    if (avgPerWorkday > 0) {
      const remain = Math.max(0, weeklyGoalMinutes - cumActualToDate);
      const needDays = Math.ceil(remain / avgPerWorkday);
      const futureWork = workdays.filter(d => d >= weekDays[idx]);
      const pick = futureWork[Math.min(Math.max(needDays - 1, 0), futureWork.length - 1)] || workdays[workdays.length - 1];
      if (pick) finishDay = new Date(pick).toLocaleDateString(undefined, { weekday: 'long' });
    }
    const text = `You are ${aheadBehind} by ${Math.abs(delta)} min vs pace; at this pace you finish by ${finishDay}.`;
    return { text, delta } as const;
  }, [weeklyGoalMinutes, weekDays, availabilityByDow, burndownRows]);

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
      {/* Focus Insights */}
      <section className="card p-5 space-y-2">
        <h3 className="text-lg font-medium">Focus Insights</h3>
        <div className="text-sm text-slate-300/80">Averages: 7d <span className="text-slate-100 font-medium">{(focus7||0).toFixed(1)}</span> · 14d <span className="text-slate-100 font-medium">{(focus14||0).toFixed(1)}</span> · 30d <span className="text-slate-100 font-medium">{(focus30||0).toFixed(1)}</span></div>
        {bestWindow ? (
          <div className="text-sm text-slate-300/80">Best window: <span className="text-slate-100 font-medium">{fmtHourRange2(bestWindow.start)}</span> (avg {(bestWindow.avg||0).toFixed(1)} over {bestWindow.n} sessions)</div>
        ) : (
          <div className="text-sm text-slate-300/60">Best window: —</div>
        )}
        <div className="text-sm text-slate-300/80">
          {slump.isSlump ? (
            <span className="text-amber-400">Slump detected.</span>
          ) : (
            <span className="text-slate-300/60">Slump: —</span>
          )}
        </div>
        <div className="text-xs text-slate-300/70">
          {bestWindow && <div>Suggestion: schedule 45–60m blocks in your best window.</div>}
          {slump.isSlump && <div>Suggestion: shorten sessions (30–45m), add breaks, and prioritize high-focus work in best window.</div>}
          {!bestWindow && !slump.isSlump && <div>Suggestion: keep logging focus; we’ll surface patterns as you accumulate sessions.</div>}
        </div>
      </section>
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

      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Reading Pace by Course (Last 30 days)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-1 pr-2">Course</th>
                <th className="py-1 pr-2">Minutes</th>
                <th className="py-1 pr-2">Pages</th>
                <th className="py-1 pr-2">Sessions</th>
                <th className="py-1 pr-2">Min/Page</th>
              </tr>
            </thead>
            <tbody>
              {paceByCourse30.rows.length === 0 ? (
                <tr className="border-t border-[#1b2344]"><td className="py-1 pr-2">—</td><td className="py-1 pr-2">0m</td><td className="py-1 pr-2">0</td><td className="py-1 pr-2">0</td><td className="py-1 pr-2">—</td></tr>
              ) : (
                paceByCourse30.rows.map((r) => (
                  <tr key={r.course} className="border-t border-[#1b2344]">
                    <td className="py-1 pr-2">{r.course || 'Unassigned'}</td>
                    <td className="py-1 pr-2">{fmtHM(r.minutes)}</td>
                    <td className="py-1 pr-2">{r.pages}</td>
                    <td className="py-1 pr-2">{r.sessions}</td>
                    <td className="py-1 pr-2">{r.mpp > 0 ? r.mpp.toFixed(2) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Weekly Burndown */}
      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Weekly Burndown</h3>
        <div className="text-sm text-slate-300/80">{burndownSummary.text}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-1 pr-2">Day</th>
                <th className="py-1 pr-2">Planned</th>
                <th className="py-1 pr-2">Actual</th>
                <th className="py-1 pr-2">Remaining Goal</th>
              </tr>
            </thead>
            <tbody>
              {burndownRows.length === 0 ? (
                <tr className="border-t border-[#1b2344]"><td className="py-1 pr-2">—</td><td className="py-1 pr-2">0m</td><td className="py-1 pr-2">0m</td><td className="py-1 pr-2">0m</td></tr>
              ) : (
                burndownRows.map(r => (
                  <tr key={r.day} className="border-t border-[#1b2344]">
                    <td className="py-1 pr-2">{r.dow}</td>
                    <td className="py-1 pr-2">{r.planned}m</td>
                    <td className="py-1 pr-2">{r.actual}m</td>
                    <td className="py-1 pr-2">{r.remainingGoal}m</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
                <th className="py-1 pr-2">Planned</th>
                <th className="py-1 pr-2">Actual</th>
                <th className="py-1 pr-2">Delta</th>
              </tr>
            </thead>
            <tbody>
              {plannedVsActual.rows.length === 0 ? (
                <tr className="border-t border-[#1b2344]"><td className="py-1 pr-2">—</td><td className="py-1 pr-2">0m</td><td className="py-1 pr-2">0m</td><td className="py-1 pr-2">0m</td></tr>
              ) : (
                plannedVsActual.rows.map((r) => (
                  <tr key={r.course} className="border-t border-[#1b2344]">
                    <td className="py-1 pr-2">{r.course || 'Unassigned'}</td>
                    <td className="py-1 pr-2">{fmtHM(r.planned)}</td>
                    <td className="py-1 pr-2">{fmtHM(r.actual)}</td>
                    <td className="py-1 pr-2">{fmtHM(r.delta)}</td>
                  </tr>
                ))
              )}
              <tr className="border-t border-[#1b2344] font-medium">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 pr-2">{fmtHM(plannedVsActual.totals.planned)}</td>
                <td className="py-1 pr-2">{fmtHM(plannedVsActual.totals.actual)}</td>
                <td className="py-1 pr-2">{fmtHM(plannedVsActual.totals.delta)}</td>
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

      {/* 2b) Totals by Course (Last 30 days) */}
      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Totals by Course (Last 30 days)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-1 pr-2">Course</th>
                <th className="py-1 pr-2">Time</th>
                <th className="py-1 pr-2">Sessions</th>
                <th className="py-1 pr-2">Avg Focus</th>
              </tr>
            </thead>
            <tbody>
              {courseAgg30.rows.length === 0 ? (
                <tr className="border-t border-[#1b2344]"><td className="py-1 pr-2">—</td><td className="py-1 pr-2">0m</td><td className="py-1 pr-2">0</td><td className="py-1 pr-2">0.0</td></tr>
              ) : (
                courseAgg30.rows.map((r: CourseAggRow) => (
                  <tr key={r.course} className="border-t border-[#1b2344]">
                    <td className="py-1 pr-2">{r.course || 'Unassigned'}</td>
                    <td className="py-1 pr-2">{fmtHM(r.minutes)}</td>
                    <td className="py-1 pr-2">{r.sessions}</td>
                    <td className="py-1 pr-2">{r.avgFocus > 0 ? r.avgFocus.toFixed(1) : '—'}</td>
                  </tr>
                ))
              )}
              <tr className="border-t border-[#1b2344] font-medium">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 pr-2">{fmtHM(courseAgg30.totalMinutes)}</td>
                <td className="py-1 pr-2">{courseAgg30.totalSessions}</td>
                <td className="py-1 pr-2">{courseAgg30.weightedAvgFocus > 0 ? courseAgg30.weightedAvgFocus.toFixed(1) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 4) Totals by Activity Type (Last 30 days) */}
      <section className="card p-5 space-y-3">
        <h3 className="text-lg font-medium">Totals by Activity (Last 30 days)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-1 pr-2">Activity</th>
                <th className="py-1 pr-2">Time</th>
                <th className="py-1 pr-2">Sessions</th>
                <th className="py-1 pr-2">Avg Focus</th>
              </tr>
            </thead>
            <tbody>
              {activityAgg30.rows.length === 0 ? (
                <tr className="border-t border-[#1b2344]"><td className="py-1 pr-2">—</td><td className="py-1 pr-2">0m</td><td className="py-1 pr-2">0</td><td className="py-1 pr-2">0.0</td></tr>
              ) : (
                activityAgg30.rows.map((r: ActivityAggRow) => (
                  <tr key={r.activity} className="border-t border-[#1b2344]">
                    <td className="py-1 pr-2">{r.activity}</td>
                    <td className="py-1 pr-2">{fmtHM(r.minutes)}</td>
                    <td className="py-1 pr-2">{r.sessions}</td>
                    <td className="py-1 pr-2">{r.avgFocus > 0 ? r.avgFocus.toFixed(1) : '—'}</td>
                  </tr>
                ))
              )}
              <tr className="border-t border-[#1b2344] font-medium">
                <td className="py-1 pr-2">Total</td>
                <td className="py-1 pr-2">{fmtHM(activityAgg30.totalMinutes)}</td>
                <td className="py-1 pr-2">{activityAgg30.totalSessions}</td>
                <td className="py-1 pr-2">{activityAgg30.weightedAvgFocus > 0 ? activityAgg30.weightedAvgFocus.toFixed(1) : '—'}</td>
              </tr>
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
