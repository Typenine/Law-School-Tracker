"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CalendarEvent, Course, StudySession, Task } from "@/lib/types";
import { apiFetch } from "@/lib/apiClient";
import LogModal, { type LogSubmitData } from "@/components/LogModal";
import { countPages, parsePageRanges } from "@/lib/pageRanges";
import { notifyTasksChanged, onTasksChanged } from "@/lib/taskBus";
import { notifySessionsChanged } from "@/lib/sessionsBus";
import { notifyScheduleChanged, onScheduleChanged } from "@/lib/scheduleBus";
import { clearScheduleDirty, markScheduleDirty, writeLocalSchedule } from "@/lib/useSchedule";
import { setPageSubtitle } from "@/lib/chromeBus";

type PlanItem = { id: string; title: string; course: string; minutes: number; guessed?: boolean };
type TodayPlan = { dateKey: string; locked?: boolean; items: PlanItem[] };
type ScheduledBlock = {
  id: string;
  taskId: string;
  day: string;
  plannedMinutes: number;
  guessed?: boolean;
  title: string;
  course: string;
  pages?: number | null;
  priority?: number | null;
};
type TimerState = { accMs: number; running: boolean; startedAt?: number };
type PlannedTask = { task: Task; minutes: number };
type SettingsMap = Record<string, any>;

const LS_TODAY = "todayPlanV1";
const LS_SCHEDULE = "weekScheduleV1";
const LS_TIMERS = "taskTimersV1";

function chicagoYmd(value: Date | string = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function chicagoDateParts(value: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).formatToParts(value);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(year, month - 1, day + days, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeekYmd(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return chicagoYmd(date);
}

function minutesLabel(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours && mins) return `${hours}h ${String(mins).padStart(2, "0")}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function compactMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

function clockLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours) return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatTime(value?: string | null): string {
  if (!value) return "";
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw || 0);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function dayLabel(ymd: string, today: string): string {
  const diff = Math.round((new Date(`${ymd}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(`${ymd}T12:00:00`));
}

function daysUntil(ymd?: string | null, today = chicagoYmd()): number | null {
  if (!ymd) return null;
  const a = new Date(`${today}T12:00:00`).getTime();
  const b = new Date(`${ymd.slice(0, 10)}T12:00:00`).getTime();
  return Math.max(0, Math.ceil((b - a) / 86400000));
}

function activityLabel(task: Task): string {
  const activity = (task.activity || "").trim().toLowerCase();
  if (activity) return activity;
  const title = (task.title || "").toLowerCase();
  if (/read|pages?|pp\.?\s*\d/.test(title)) return "reading";
  if (/outline/.test(title)) return "outlining";
  if (/practice|problem|question|hypo/.test(title)) return "practice";
  if (/review/.test(title)) return "review";
  return "assignment";
}

function titlePageRanges(task: Task): string {
  const stored = task.remainingPageRanges || task.originalPageRanges;
  if (stored) return stored;
  const match = (task.title || "").match(/(?:p(?:ages?)?\.?\s*)(\d[\d\s,–—-]*)/i);
  return match?.[1]?.trim() || "";
}

function safePageCount(value: string): number {
  if (!value) return 0;
  try { return countPages(parsePageRanges(value)); } catch { return 0; }
}

function courseKey(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function hashHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function fallbackColor(value?: string | null): string {
  return `hsl(${hashHue(courseKey(value) || "course")} 58% 56%)`;
}

function readLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function blockMinutes(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0;
  const parse = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  return Math.max(0, parse(end) - parse(start));
}

export default function TodayPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [settings, setSettings] = useState<SettingsMap>({});
  const [todayPlan, setTodayPlan] = useState<TodayPlan | null>(null);
  const [schedule, setSchedule] = useState<ScheduledBlock[]>([]);
  const [timers, setTimers] = useState<Record<string, TimerState>>({});
  const [timerTick, setTimerTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [logTask, setLogTask] = useState<Task | null>(null);
  const [logMode, setLogMode] = useState<"partial" | "finish">("partial");

  const today = chicagoYmd();
  const dayParts = chicagoDateParts();
  const dateHeading = `${dayParts.weekday}, ${dayParts.month} ${dayParts.day}`;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [taskResult, courseResult, sessionResult, eventResult, settingsResult, scheduleResult] = await Promise.all([
        apiFetch<{ tasks: Task[] }>("/api/tasks"),
        apiFetch<{ courses: Course[] }>("/api/courses"),
        apiFetch<{ sessions: StudySession[] }>("/api/sessions"),
        apiFetch<{ events: CalendarEvent[] }>("/api/events"),
        apiFetch<{ settings: SettingsMap }>("/api/settings"),
        apiFetch<{ blocks: ScheduledBlock[] }>("/api/schedule").catch(() => ({ blocks: [] as ScheduledBlock[] })),
      ]);
      setTasks(Array.isArray(taskResult.tasks) ? taskResult.tasks : []);
      setCourses(Array.isArray(courseResult.courses) ? courseResult.courses : []);
      setSessions(Array.isArray(sessionResult.sessions) ? sessionResult.sessions : []);
      setEvents(Array.isArray(eventResult.events) ? eventResult.events : []);
      setSettings(settingsResult.settings || {});
      // Take the week plan from the server so Today matches the plan built on
      // any device, rather than only this browser's cached copy.
      if (Array.isArray(scheduleResult.blocks)) {
        setSchedule(scheduleResult.blocks);
        writeLocalSchedule(scheduleResult.blocks as any);
      }
      const serverTimers = settingsResult.settings?.taskTimersV1;
      setTimers(serverTimers && typeof serverTimers === "object" ? serverTimers : readLocalJson(LS_TIMERS, {}));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setTodayPlan(readLocalJson<TodayPlan | null>(LS_TODAY, null));
    setSchedule(readLocalJson<ScheduledBlock[]>(LS_SCHEDULE, []));
    void refresh();
    // Reflect task and schedule edits made elsewhere in the app straight away.
    const offTasks = onTasksChanged(() => { void refresh(); });
    const offSchedule = onScheduleChanged(() => {
      setSchedule(readLocalJson<ScheduledBlock[]>(LS_SCHEDULE, []));
    });
    return () => { offTasks(); offSchedule(); };
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setTimerTick(value => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_TIMERS, JSON.stringify(timers));
    const id = window.setTimeout(() => {
      void apiFetch("/api/settings", { method: "PATCH", body: { taskTimersV1: timers } }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(id);
  }, [timers]);

  const courseMap = useMemo(() => {
    const map = new Map<string, Course>();
    for (const course of courses) map.set(courseKey(course.title), course);
    return map;
  }, [courses]);

  const sessionMinutesByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of sessions) {
      if (!session.taskId) continue;
      map.set(session.taskId, (map.get(session.taskId) || 0) + Math.max(0, Number(session.minutes) || 0));
    }
    return map;
  }, [sessions]);

  const sessionPagesByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of sessions) {
      if (!session.taskId) continue;
      map.set(session.taskId, (map.get(session.taskId) || 0) + Math.max(0, Number(session.pagesRead) || 0));
    }
    return map;
  }, [sessions]);

  const plannedTasks = useMemo<PlannedTask[]>(() => {
    const taskMap = new Map(tasks.map(task => [task.id, task]));
    const output: PlannedTask[] = [];
    const seen = new Set<string>();
    const add = (task: Task | undefined, minutes?: number | null) => {
      if (!task || task.status === "done" || seen.has(task.id)) return;
      seen.add(task.id);
      output.push({ task, minutes: Math.max(1, Math.round(minutes || task.estimatedMinutes || 30)) });
    };

    if (todayPlan?.dateKey === today) {
      for (const item of todayPlan.items || []) add(taskMap.get(item.id), item.minutes);
    }
    for (const block of schedule.filter(item => item.day === today)) add(taskMap.get(block.taskId), block.plannedMinutes);

    const dueToday = tasks
      .filter(task => task.status === "todo" && chicagoYmd(task.dueDate) === today)
      .sort((a, b) => (a.priority || 9) - (b.priority || 9) || new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    for (const task of dueToday) add(task, task.estimatedMinutes);

    return output;
  }, [schedule, tasks, today, todayPlan]);

  const runningTaskId = useMemo(() => Object.entries(timers).find(([, timer]) => timer?.running)?.[0], [timers]);
  const upNext = useMemo(() => plannedTasks.find(item => item.task.id === runningTaskId) || plannedTasks[0] || null, [plannedTasks, runningTaskId]);
  const thenToday = useMemo(() => plannedTasks.filter(item => item.task.id !== upNext?.task.id).slice(0, 5), [plannedTasks, upNext]);

  const loggedToday = useMemo(() => sessions
    .filter(session => chicagoYmd(session.when || session.createdAt) === today)
    .reduce((sum, session) => sum + Math.max(0, Number(session.minutes) || 0), 0), [sessions, today]);
  const plannedToday = useMemo(() => plannedTasks.reduce((sum, item) => sum + item.minutes, 0), [plannedTasks]);
  const leftToday = Math.max(0, plannedToday - loggedToday);

  const focusAverage = useMemo(() => {
    const values = sessions
      .filter(session => chicagoYmd(session.when || session.createdAt) === today)
      .map(session => Number(session.focus))
      .filter(value => Number.isFinite(value) && value > 0);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }, [sessions, today]);

  const strongestWindow = useMemo(() => {
    const buckets = new Map<number, { sum: number; count: number }>();
    for (const session of sessions) {
      const focus = Number(session.focus);
      if (!Number.isFinite(focus) || focus <= 0) continue;
      const hour = new Date(session.when || session.createdAt).getHours();
      const start = Math.floor(hour / 2) * 2;
      const record = buckets.get(start) || { sum: 0, count: 0 };
      record.sum += focus;
      record.count += 1;
      buckets.set(start, record);
    }
    const best = [...buckets.entries()].sort((a, b) => (b[1].sum / b[1].count) - (a[1].sum / a[1].count))[0];
    if (!best) return "Keep logging sessions";
    const start = best[0];
    const end = (start + 2) % 24;
    const short = (hour: number) => `${hour % 12 || 12}${hour >= 12 ? " PM" : " AM"}`;
    return `Strongest ${short(start)}–${short(end)}`;
  }, [sessions]);

  const availableToday = useMemo(() => {
    const dow = new Date(`${today}T12:00:00`).getDay();
    const windows = settings.availabilityWindowsV1?.[dow] || settings.availabilityWindowsV1?.[String(dow)] || [];
    const breaks = settings.availabilityBreaksV1?.[dow] || settings.availabilityBreaksV1?.[String(dow)] || [];
    if (Array.isArray(windows) && windows.length) {
      const total = windows.reduce((sum: number, item: any) => sum + blockMinutes(item.start, item.end), 0);
      const blocked = Array.isArray(breaks) ? breaks.reduce((sum: number, item: any) => sum + blockMinutes(item.start, item.end), 0) : 0;
      return Math.max(0, total - blocked);
    }
    const template = readLocalJson<Record<number, number>>("availabilityTemplateV1", {} as Record<number, number>);
    return Math.max(0, Number(template[dow]) || plannedToday || 0);
  }, [plannedToday, settings, today]);

  const classesToday = useMemo(() => {
    const dow = new Date(`${today}T12:00:00`).getDay();
    const rows: Array<{ course: Course; start: string; location: string }> = [];
    for (const course of courses) {
      if (course.startDate && today < course.startDate.slice(0, 10)) continue;
      if (course.endDate && today > course.endDate.slice(0, 10)) continue;
      const blocks = Array.isArray(course.meetingBlocks) && course.meetingBlocks.length
        ? course.meetingBlocks
        : (Array.isArray(course.meetingDays) && course.meetingStart
          ? [{ days: course.meetingDays, start: course.meetingStart, end: course.meetingEnd || "", location: course.location || course.room || "" }]
          : []);
      for (const block of blocks) {
        if (!Array.isArray(block.days) || !block.days.includes(dow)) continue;
        rows.push({
          course,
          start: block.start,
          location: block.location || course.room || course.location || "",
        });
      }
    }
    return rows.sort((a, b) => a.start.localeCompare(b.start));
  }, [courses, today]);

  const dueSoon = useMemo(() => tasks
    .filter(task => task.status === "todo" && chicagoYmd(task.dueDate) >= today)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 4), [tasks, today]);

  const countdowns = useMemo(() => {
    const future = events.filter(event => event.date >= today);
    const firstFinal = future
      .filter(event => /\b(final|exam)\b/i.test(event.title))
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const graduation = future
      .filter(event => /graduat/i.test(event.title))
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const fallbackFinal = courses
      .filter(course => course.endDate && course.endDate.slice(0, 10) >= today)
      .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)))[0]?.endDate?.slice(0, 10) || null;
    return {
      firstFinal: daysUntil(firstFinal?.date || fallbackFinal, today),
      graduation: daysUntil(graduation?.date || "2027-05-23", today),
    };
  }, [courses, events, today]);

  // Publish the day's summary to the app header. Writing into the header's DOM
  // directly used to fight React's own rendering of the shell.
  useEffect(() => {
    setPageSubtitle(`${dateHeading} · ${compactMinutes(plannedToday)} planned, ${compactMinutes(leftToday)} left`);
    return () => setPageSubtitle(null);
  }, [dateHeading, leftToday, plannedToday]);

  function elapsedMs(taskId: string): number {
    void timerTick;
    const timer = timers[taskId];
    if (!timer) return 0;
    return timer.accMs + (timer.running ? Math.max(0, Date.now() - (timer.startedAt || Date.now())) : 0);
  }

  function toggleTimer(taskId: string) {
    setTimers(current => {
      const timer = current[taskId] || { accMs: 0, running: false };
      if (timer.running) {
        const elapsed = Math.max(0, Date.now() - (timer.startedAt || Date.now()));
        return { ...current, [taskId]: { accMs: timer.accMs + elapsed, running: false } };
      }
      const paused: Record<string, TimerState> = {};
      for (const [id, value] of Object.entries(current)) {
        paused[id] = value.running
          ? { accMs: value.accMs + Math.max(0, Date.now() - (value.startedAt || Date.now())), running: false }
          : value;
      }
      return { ...paused, [taskId]: { accMs: timer.accMs, running: true, startedAt: Date.now() } };
    });
  }

  function openLog(task: Task, mode: "partial" | "finish") {
    setLogTask(task);
    setLogMode(mode);
  }

  async function submitLog(data: LogSubmitData) {
    if (!logTask) return;
    await apiFetch(`/api/tasks/${logTask.id}/progress`, {
      method: "POST",
      body: {
        mode: data.isPartial ? "partial" : "finish",
        minutes: data.minutes,
        focus: data.focus,
        notes: data.notes || null,
        pagesCompleted: data.pagesCompleted || null,
        moveToDay: data.moveToDay || null,
        completionDate: data.completionDate || null,
      },
    });
    if (!data.isPartial) {
      setTimers(current => {
        const next = { ...current };
        delete next[logTask.id];
        return next;
      });
    }
    setLogTask(null);
    notifySessionsChanged();
    notifyTasksChanged();
    notifyScheduleChanged();
    await refresh();
  }

  async function moveToTomorrow(task: Task) {
    const tomorrow = addDays(today, 1);
    const movedExisting = schedule.some(block => block.taskId === task.id && block.day === today);
    const nextSchedule = schedule.map(block =>
      block.taskId === task.id && block.day === today ? { ...block, day: tomorrow } : block);
    if (!movedExisting) {
      nextSchedule.push({
        id: `moved-${task.id}-${Date.now()}`,
        taskId: task.id,
        day: tomorrow,
        plannedMinutes: task.estimatedMinutes || 30,
        title: task.title,
        course: task.course || "",
        priority: task.priority || null,
      });
    }
    setSchedule(nextSchedule);
    writeLocalSchedule(nextSchedule as any);
    markScheduleDirty();
    notifyScheduleChanged();
    // Persist to the server too, otherwise the move only lived in this tab's
    // localStorage and the block reappeared on today the next time the week
    // plan loaded from the server.
    try {
      await apiFetch("/api/schedule", { method: "PUT", body: { blocks: nextSchedule } });
      clearScheduleDirty();
    } catch {
      // The dirty flag makes the week plan retry this on its next load.
    }

    if (todayPlan?.dateKey === today) {
      const nextPlan = { ...todayPlan, items: todayPlan.items.filter(item => item.id !== task.id) };
      setTodayPlan(nextPlan);
      window.localStorage.setItem(LS_TODAY, JSON.stringify(nextPlan));
    }
  }

  const upTask = upNext?.task || null;
  const upCourse = upTask ? courseMap.get(courseKey(upTask.course)) : undefined;
  const totalPages = upTask ? safePageCount(upTask.originalPageRanges || titlePageRanges(upTask)) : 0;
  const loggedPages = upTask ? sessionPagesByTask.get(upTask.id) || 0 : 0;
  const remainingPages = upTask ? Math.max(0, safePageCount(upTask.remainingPageRanges || "") || (totalPages ? totalPages - loggedPages : 0)) : 0;
  const progressPercent = totalPages ? Math.min(100, Math.round((loggedPages / totalPages) * 100)) : Math.min(100, Math.round(((sessionMinutesByTask.get(upTask?.id || "") || 0) / Math.max(1, upNext?.minutes || 1)) * 100));
  const effectiveMpp = upCourse?.overrideEnabled && upCourse.overrideMpp
    ? upCourse.overrideMpp
    : upCourse?.learnedMpp || Number(settings.minutesPerPage) || 3;

  function nextClassLabel(course?: Course): string {
    if (!course) return "Not scheduled";
    const blocks = Array.isArray(course.meetingBlocks) && course.meetingBlocks.length
      ? course.meetingBlocks
      : (Array.isArray(course.meetingDays) && course.meetingStart ? [{ days: course.meetingDays, start: course.meetingStart }] : []);
    for (let offset = 0; offset < 8; offset++) {
      const ymd = addDays(today, offset);
      const dow = new Date(`${ymd}T12:00:00`).getDay();
      const block = blocks.filter(item => item.days?.includes(dow)).sort((a, b) => a.start.localeCompare(b.start))[0];
      if (block) {
        const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(`${ymd}T12:00:00`));
        return `${weekday}, ${formatTime(block.start)}`;
      }
    }
    return "Not scheduled";
  }

  return (
    <main className="today-dashboard">
      <style jsx global>{`
        .today-dashboard{max-width:1140px!important}.today-grid{display:grid;grid-template-columns:minmax(0,1.85fr) minmax(300px,.95fr);gap:34px}.today-main,.today-rail{min-width:0}.dash-card{border:1px solid #203451;border-radius:13px;background:#0e1c2f}.dash-eyebrow{color:#7695c3;font:500 10px/1.2 'IBM Plex Mono',monospace;letter-spacing:.13em;text-transform:uppercase}.up-card{position:relative;min-height:330px;padding:31px 30px 27px;background:#102342;overflow:hidden}.up-card:before{content:'';position:absolute;inset:0 auto 0 0;width:5px;background:#4e9ee8}.up-line{display:flex;align-items:center;gap:10px;color:#8db3e4;font-size:13px}.up-line strong{color:#ffcc00;font:500 10px/1 'IBM Plex Mono',monospace;letter-spacing:.13em}.up-title{margin:17px 0 24px;font:400 34px/1.15 'Newsreader',Georgia,serif;color:#fff}.up-facts{display:grid;grid-template-columns:1fr 1.25fr 1.1fr;margin-bottom:28px}.up-fact{padding-right:26px}.up-fact+.up-fact{padding-left:27px;border-left:1px solid #29405f}.up-fact label{display:block;margin-bottom:8px;color:#7593bd!important;font:500 10px/1.2 'IBM Plex Mono',monospace!important;letter-spacing:.13em;text-transform:uppercase}.up-fact div{color:#f2f6fb;font-size:17px}.up-actions{display:flex;align-items:center;gap:14px}.dash-primary,.dash-secondary,.row-start,.row-finish{border-radius:8px;font-weight:500;transition:.12s}.dash-primary{min-height:50px;padding:0 26px;border:1px solid #ffcc00;background:#ffcc00;color:#06152b}.dash-primary:hover{background:#ffdb4d}.dash-secondary{min-height:45px;padding:0 19px;border:1px solid #2c4a70;background:transparent;color:#dce8f6}.dash-secondary:hover,.row-start:hover{background:#162d4d}.dash-finish{border-color:#2f6f58;color:#9be3bd;background:#0e2a20}.dash-finish:hover{background:#173b2d}.timer-readout{min-width:146px;color:#fff;font:500 34px/1 'IBM Plex Mono',monospace}.up-progress{height:4px;margin-top:24px;border-radius:4px;background:#223856;overflow:hidden}.up-progress span{display:block;height:100%;background:#54a9ee}.up-progress-copy{margin-top:9px;color:#7697c4;font-size:12px}.section-heading{display:flex;align-items:center;justify-content:space-between;margin:25px 0 13px}.section-heading h2{margin:0;color:#fff;font:600 17px/1.2 'IBM Plex Sans',sans-serif!important}.section-heading span{color:#7797c2;font:400 12px/1 'IBM Plex Mono',monospace}.task-stack{overflow:hidden}.dash-task{display:grid;grid-template-columns:60px 4px minmax(0,1fr) 74px 64px;align-items:center;gap:14px;min-height:82px;padding:13px 20px;border-bottom:1px solid #203451}.dash-task:last-child{border-bottom:0}.row-finish{height:34px;border:1px solid #2f6f58;background:#0e2a20;color:#9be3bd;font-size:12px}.row-finish:hover{background:#173b2d}.course-stripe{width:4px;height:34px;border-radius:3px}.task-title{color:#f3f7fb;font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.task-meta{margin-top:4px;color:#78a4d8;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.task-duration{color:#d9e5f3;font:400 13px/1 'IBM Plex Mono',monospace;text-align:right}.row-start{height:34px;border:1px solid #2c4a70;background:transparent;color:#cfe0f5}.summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:17px;margin-top:26px}.summary-card{min-height:126px;padding:22px 20px}.summary-value{margin-top:11px;color:#f6f9fd;font:500 29px/1 'IBM Plex Mono',monospace}.summary-value.green{color:#55a77f}.summary-copy{margin-top:10px;color:#83a6d2;font-size:12px}.rail-card{padding:24px 20px}.rail-card+.rail-card{margin-top:24px}.class-row{display:grid;grid-template-columns:48px minmax(0,1fr);gap:0;padding:16px 0 0}.class-time{color:#c7dcf5;font:400 12px/1.4 'IBM Plex Mono',monospace}.class-name{color:#fff;font-size:15px;font-weight:500}.class-location{margin-top:3px;color:#769bd0;font-size:12px}.rail-head{display:flex;align-items:center;justify-content:space-between}.rail-links{display:flex;gap:10px}.rail-link{color:#4fa3ef;font-size:12px;text-decoration:none}.due-row{display:grid;grid-template-columns:48px minmax(0,1fr);gap:10px;padding-top:17px}.due-day{color:#90b0d6;font:400 11px/1.4 'IBM Plex Mono',monospace}.due-title{color:#f4f7fb;font-size:14px;font-weight:500;line-height:1.35}.due-course{margin-top:4px;color:#7397c7;font-size:12px}.count-row{display:flex;align-items:center;justify-content:space-between;margin-top:17px;color:#dce8f7}.count-row strong{font:500 14px/1 'IBM Plex Mono',monospace}.count-row strong.gold{color:#ffdd00}.empty-dash{padding:35px 24px;color:#7e9aba;text-align:center}.loading-dash{display:grid;place-items:center;min-height:420px;color:#7e9aba}.today-dashboard .fixed.inset-0 label{letter-spacing:0!important;text-transform:none!important;font-size:12px!important}.today-dashboard .fixed.inset-0 h2{font-family:'IBM Plex Sans',sans-serif!important}
        @media(max-width:1180px){.today-grid{grid-template-columns:minmax(0,1fr) 300px;gap:22px}.up-title{font-size:30px}.up-actions{flex-wrap:wrap}.timer-readout{min-width:120px}.summary-card{padding-inline:16px}}
        @media(max-width:960px){.today-grid{grid-template-columns:1fr}.today-rail{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.rail-card+.rail-card{margin-top:0}.summary-grid{margin-bottom:4px}}
        @media(max-width:760px){.today-rail{grid-template-columns:1fr}.up-card{padding:25px 21px}.up-title{font-size:27px}.up-facts{grid-template-columns:1fr;gap:16px}.up-fact+.up-fact{padding-left:0;border-left:0}.up-actions{align-items:stretch}.timer-readout{order:5;width:100%;padding-top:5px}.dash-task{grid-template-columns:56px 4px minmax(0,1fr) 56px}.row-start{display:none}.summary-grid{grid-template-columns:1fr}.task-duration{font-size:12px}}
      `}</style>

      {loading ? <div className="loading-dash">Loading today’s plan…</div> : (
        <div className="today-grid">
          <section className="today-main">
            {upTask && upNext ? (
              <article className="dash-card up-card">
                <div className="up-line"><strong>UP NEXT</strong><span>•</span><span>{upTask.course || "Unassigned"} · {activityLabel(upTask)}</span></div>
                <h2 className="up-title">{upTask.title}</h2>
                <div className="up-facts">
                  <div className="up-fact"><label>Remaining</label><div>{remainingPages ? `${remainingPages} pages · est. ${minutesLabel(Math.max(1, remainingPages * effectiveMpp))}` : `est. ${minutesLabel(upNext.minutes)}`}</div></div>
                  <div className="up-fact"><label>Your pace</label><div>{effectiveMpp.toFixed(1)} min / page{upTask.course ? ` in ${upTask.course.length > 18 ? upTask.course.slice(0, 18) : upTask.course}` : ""}</div></div>
                  <div className="up-fact"><label>Class</label><div>{nextClassLabel(upCourse)}</div></div>
                </div>
                <div className="up-actions">
                  <button className="dash-primary" onClick={() => toggleTimer(upTask.id)}>{timers[upTask.id]?.running ? "Pause" : activityLabel(upTask) === "reading" ? "Start reading" : "Start task"}</button>
                  <button className="dash-secondary dash-finish" onClick={() => openLog(upTask, "finish")}>Finish task</button>
                  <div className="timer-readout">{clockLabel(elapsedMs(upTask.id))}</div>
                  <button className="dash-secondary" onClick={() => openLog(upTask, "partial")}>Log progress</button>
                  <button className="dash-secondary" onClick={() => void moveToTomorrow(upTask)}>Move to tomorrow</button>
                </div>
                <div className="up-progress"><span style={{ width: `${progressPercent}%` }} /></div>
                <div className="up-progress-copy">{totalPages ? `${loggedPages} of ${totalPages} pages logged · ${progressPercent}% of this assignment` : `${sessionMinutesByTask.get(upTask.id) || 0} minutes logged · ${progressPercent}% of estimated time`}</div>
              </article>
            ) : <article className="dash-card empty-dash">Nothing is planned for today. Add a task or build the week plan to populate this dashboard.</article>}

            <div className="section-heading"><h2>Then today</h2><span>{thenToday.length} remaining · {compactMinutes(thenToday.reduce((sum, item) => sum + item.minutes, 0))}</span></div>
            <div className="dash-card task-stack">
              {thenToday.length ? thenToday.map(({ task, minutes }) => {
                const course = courseMap.get(courseKey(task.course));
                const color = course?.color || fallbackColor(task.course);
                const due = chicagoYmd(task.dueDate) === today ? "due today" : `due ${dayLabel(chicagoYmd(task.dueDate), today).toLowerCase()}`;
                return <div className="dash-task" key={task.id}>
                  <button className="row-finish" aria-label={`Finish ${task.title}`} onClick={() => openLog(task, "finish")}>Finish</button>
                  <span className="course-stripe" style={{ background: color }} />
                  <div><div className="task-title">{task.title}</div><div className="task-meta">{task.course || "Unassigned"} · {activityLabel(task)} · {due}</div></div>
                  <div className="task-duration">{minutesLabel(minutes)}</div>
                  <button className="row-start" onClick={() => toggleTimer(task.id)}>{timers[task.id]?.running ? "Pause" : "Start"}</button>
                </div>;
              }) : <div className="empty-dash">No other tasks are planned today.</div>}
            </div>

            <div className="summary-grid">
              <article className="dash-card summary-card"><div className="dash-eyebrow">Planned today</div><div className="summary-value">{compactMinutes(plannedToday)}</div><div className="summary-copy">of {compactMinutes(availableToday)} available</div></article>
              <article className="dash-card summary-card"><div className="dash-eyebrow">Logged today</div><div className="summary-value green">{compactMinutes(loggedToday)}</div><div className="summary-copy">{compactMinutes(leftToday)} still planned</div></article>
              <article className="dash-card summary-card"><div className="dash-eyebrow">Focus average</div><div className="summary-value">{focusAverage ? focusAverage.toFixed(1) : "—"}</div><div className="summary-copy">{strongestWindow}</div></article>
            </div>
          </section>

          <aside className="today-rail">
            <article className="dash-card rail-card">
              <div className="dash-eyebrow">Classes today</div>
              {classesToday.length ? classesToday.map((row, index) => <div className="class-row" key={`${row.course.id}-${row.start}-${index}`}><div className="class-time">{row.start}</div><div><div className="class-name">{row.course.title}</div>{row.location ? <div className="class-location">{row.location}</div> : null}</div></div>) : <div className="empty-dash">No classes scheduled today.</div>}
            </article>

            <article className="dash-card rail-card">
              <div className="rail-head"><div className="dash-eyebrow">Due soon</div><div className="rail-links"><a className="rail-link" href="/week-plan">Week →</a><a className="rail-link" href="/tasks/completed">Completed →</a></div></div>
              {dueSoon.length ? dueSoon.map(task => <div className="due-row" key={task.id}><div className="due-day">{dayLabel(chicagoYmd(task.dueDate), today)}</div><div><div className="due-title">{task.title}</div><div className="due-course">{task.course || "Unassigned"}</div></div></div>) : <div className="empty-dash">Nothing due soon.</div>}
            </article>

            <article className="dash-card rail-card">
              <div className="dash-eyebrow">Countdown</div>
              <div className="count-row"><span>First final</span><strong className="gold">{countdowns.firstFinal == null ? "—" : `${countdowns.firstFinal} days`}</strong></div>
              <div className="count-row"><span>Graduation</span><strong>{countdowns.graduation == null ? "—" : `${countdowns.graduation} days`}</strong></div>
            </article>
          </aside>
        </div>
      )}

      <LogModal
        isOpen={!!logTask}
        onClose={() => setLogTask(null)}
        onSubmit={data => void submitLog(data)}
        task={logTask}
        mode={logMode}
        defaultMinutes={logTask && elapsedMs(logTask.id) >= 60000 ? Math.max(1, Math.round(elapsedMs(logTask.id) / 60000)) : undefined}
        coursePph={logTask ? Math.round(60 / Math.max(0.5, courseMap.get(courseKey(logTask.course))?.learnedMpp || Number(settings.minutesPerPage) || 3)) : 18}
      />
    </main>
  );
}
