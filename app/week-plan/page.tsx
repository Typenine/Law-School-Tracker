"use client";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import type { Task } from "@/lib/types";
import { useTasks } from "@/lib/useTasks";
import { estimateMinutesForTask } from "@/lib/taskEstimate";
import { useSessions } from "@/lib/useSessions";
import { useCourses } from "@/lib/useCourses";
import { useSchedule, useAvailability, clearScheduleDirty, isScheduleDirty } from "@/lib/useSchedule";
import { apiFetch } from "@/lib/apiClient";
import { notifyToast } from '@/lib/toastBus';
import { fallbackCourseColor } from '@/lib/colors';
import { summarizeStudyDays, addPlannedStudyMinutes, remainingEstimates, dailyStudyCapacity, conflictsForDay } from '@/lib/studyCapacity';
type BacklogItem = {
  id: string;
  title: string;
  course: string;
  dueDate?: string | null; // YYYY-MM-DD
  pages?: number | null;
  estimatedMinutes?: number | null;
  priority?: number | null; // 1-5
  tags?: string[] | null;
};

type AvailabilityTemplate = Record<number, number>; // 0..6 => minutes

type ScheduledBlock = {
  id: string;
  taskId: string; // BacklogItem.id or Task.id
  day: string; // YYYY-MM-DD
  plannedMinutes: number;
  guessed?: boolean;
  title: string;
  course: string;
  pages?: number | null;
  priority?: number | null;
  catchup?: boolean;
};

const LS_BACKLOG = "backlogItemsV1";
const LS_AVAIL = "availabilityTemplateV1";
const LS_SCHEDULE = "weekScheduleV1";
const LS_GOALS = "weeklyGoalsV1";
const LS_WEEK_START = "weekPlanWeekStartYmd";
const LS_TWO_WEEKS = "weekPlanTwoWeeksOnly";
const LS_AVAIL_BREAKS = "availabilityBreaksV1";
const LS_AVAIL_WINDOWS = "availabilityWindowsV1";

type WeeklyGoal = { id: string; scope: 'global'|'course'; weeklyMinutes: number; course?: string | null };

function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function loadGoals(): WeeklyGoal[] { if (typeof window==='undefined') return []; try { const raw=window.localStorage.getItem(LS_GOALS); const arr=raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; } catch { return []; } }
function chicagoYmd(d: Date): string { const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }); const parts = f.formatToParts(d); const y=parts.find(p=>p.type==='year')?.value||'0000'; const m=parts.find(p=>p.type==='month')?.value||'01'; const da=parts.find(p=>p.type==='day')?.value||'01'; return `${y}-${m}-${da}`; }
function mondayOfChicago(d: Date): Date { const ymd = chicagoYmd(d); const [yy,mm,dd]=ymd.split('-').map(x=>parseInt(x,10)); const local = new Date(yy,(mm as number)-1,dd); const dow = local.getDay(); const delta = (dow + 1) % 7; local.setDate(local.getDate()-delta); return local; }
function weekKeysChicago(d: Date): string[] { const start = mondayOfChicago(d); return Array.from({length:7},(_,i)=>{const x=new Date(start); x.setDate(x.getDate()+i); return chicagoYmd(x);}); }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function saturdayOf(d: Date) { const x = startOfDay(d); const dow = x.getDay(); const delta = (dow - 6 + 7) % 7; x.setDate(x.getDate() - delta); return x; }
/**
 * Calendar date of a local Date, in local terms.
 *
 * The selected week is built from local Date arithmetic and read back with
 * `new Date(year, month, day)`, so it has to be written the same way. It used
 * to be stored with `ymd()`, which formats in America/Chicago: for any browser
 * running ahead of Chicago that rendered the previous day, so each visit
 * restored a date one day earlier, `saturdayOf` snapped it back another week,
 * and the planner walked steadily into the past - taking the week's plan out
 * of view with it.
 */
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Restore a saved week only when it is not already behind us. */
function restorableWeek(stored: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stored)) return null;
  const [y, m, da] = stored.split('-').map(x => parseInt(x, 10));
  const candidate = saturdayOf(new Date(y, m - 1, da));
  return candidate >= saturdayOf(new Date()) ? candidate : null;
}
function ymd(d: Date) { return chicagoYmd(d); }
function dayLabel(d: Date) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
function endOfDayIso(ymdStr: string) { const [y,m,da]=ymdStr.split('-').map(n=>parseInt(n,10)); const x=new Date(y,(m as number)-1,da,23,59,59,999); return x.toISOString(); }
function minutesPerPage(): number { if (typeof window==='undefined') return 3; const s=window.localStorage.getItem('minutesPerPage'); const n=s?parseFloat(s):NaN; return !isNaN(n)&&n>0?n:3; }
function normHHMM(s?: string | null): string | null {
  const raw = (s||'').trim().toLowerCase(); if (!raw) return null;
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*([ap]m?)?$/.exec(raw);
  if (!m) return null; let hh = parseInt(m[1],10); const mm = Math.min(59, Math.max(0, parseInt(m[2]||'0',10)));
  const apRaw = (m[3]||'').toLowerCase(); const ap = apRaw === 'a' ? 'am' : (apRaw === 'p' ? 'pm' : apRaw);
  if (ap) { if (hh === 12) hh = 0; if (ap==='pm') hh += 12; }
  if (hh<0||hh>23) return null; return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}
function fmt12Input(s?: string | null): string {
  const n = normHHMM(s || '');
  if (!n) return (s || '');
  const [hStr, mStr] = n.split(':');
  let h = parseInt(hStr, 10);
  const ap = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${mStr} ${ap}`;
}
function minutesToHM(min: number): string { const n = Math.max(0, Math.round(Number(min)||0)); const h = Math.floor(n/60); const m = n % 60; return `${h}:${String(m).padStart(2,'0')}`; }

function normCourseKey(name?: string | null): string {
  let x = (name || '').toString().toLowerCase().trim();
  if (!x) return '';
  x = x.replace(/&/g, 'and');
  x = x.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (/\blaw$/.test(x)) x = x.replace(/\s*law$/, '');
  return x;
}

function loadBacklog(): BacklogItem[] {
  if (typeof window === 'undefined') return [];
  try { const raw = window.localStorage.getItem(LS_BACKLOG); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch { return []; }
}
function loadAvailability(): AvailabilityTemplate {
  if (typeof window === 'undefined') return { 0:120,1:240,2:240,3:240,4:240,5:240,6:120 } as any;
  try { const raw = window.localStorage.getItem(LS_AVAIL); if (raw) return JSON.parse(raw); } catch {}
  return { 0:120,1:240,2:240,3:240,4:240,5:240,6:120 };
}
function saveAvailability(t: AvailabilityTemplate) { if (typeof window!=='undefined') window.localStorage.setItem(LS_AVAIL, JSON.stringify(t)); }
function loadSchedule(): ScheduledBlock[] { if (typeof window==='undefined') return []; try { const raw=window.localStorage.getItem(LS_SCHEDULE); const arr=raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; } catch { return []; } }
function blockFingerprint(blocks: ScheduledBlock[]): string {
  return blocks
    .map(b => `${b.id}|${b.day}|${b.plannedMinutes}|${b.taskId}`)
    .sort()
    .join('\n');
}
function hasUnsyncedEdits(local: ScheduledBlock[], remote: ScheduledBlock[]): boolean {
  return blockFingerprint(local) !== blockFingerprint(remote);
}

// Use shared helper for estimate calculations
function estimateMinutesFor(item: BacklogItem): { minutes: number; guessed: boolean } {
  return estimateMinutesForTask(item);
}

export default function WeekPlanPage() {
  const [sortBy, setSortBy] = useState<'due'|'course'|'priority'|'estimate'>('due');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');
  // Read on the client only. Deriving this during render made the server and
  // the browser disagree about which week to show, so hydration failed and
  // React re-rendered the whole document - which is why the planner could come
  // back showing a different week than the one the blocks were placed in.
  const [mounted, setMounted] = useState(false);
  const [weekStart, setWeekStart] = useState<Date>(() => {
    if (typeof window === 'undefined') return saturdayOf(new Date());
    try {
      const stored = window.localStorage.getItem(LS_WEEK_START);
      if (stored) return restorableWeek(stored) || saturdayOf(new Date());
    } catch {}
    return saturdayOf(new Date());
  });
  const { blocks, setBlocks, hydrate, saveStatus } = useSchedule();
  const { availability, setAvailability } = useAvailability();
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const { tasks, loading: tasksLoading, error: tasksError } = useTasks();
  const { sessions } = useSessions();
  const [goals, setGoals] = useState<WeeklyGoal[]>([]);
  const [breaksByDow, setBreaksByDow] = useState<Record<number, Array<{ start?: string; end?: string }>>>({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] });
  const [windowsByDow, setWindowsByDow] = useState<Record<number, Array<{ start?: string; end?: string }>>>({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] });
  const [rowMenu, setRowMenu] = useState<{ kind: 'win'|'br'; dow: number; index: number } | null>(null);
  const [toolbarMenu, setToolbarMenu] = useState<{ dow: number } | null>(null);
  const { courses } = useCourses();
  const [twoWeeksOnly, setTwoWeeksOnly] = useState<boolean>(false);
  const [undoSnapshot, setUndoSnapshot] = useState<ScheduledBlock[] | null>(null);
  const [undoLabel, setUndoLabel] = useState('');
  const [availabilityExpanded, setAvailabilityExpanded] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  function snapshot(label: string) { setUndoSnapshot(blocks.slice()); setUndoLabel(label); }
  const [showCatchup, setShowCatchup] = useState(false);
  const [settingsReady, setSettingsReady] = useState<boolean>(false);
  const [blocksLoaded, setBlocksLoaded] = useState<boolean>(false);
  const [catchupPreview, setCatchupPreview] = useState<{
    days: Array<{ day: string; total: number; usedBefore: number; usedAfter: number; items: Array<{ taskId: string; title: string; course: string; minutes: number; guessed: boolean }> }>;
    unschedulable: Array<{ taskId: string; title: string; remaining: number; dueYmd: string }>;
  } | null>(null);

  // Initial load. The server is the durable copy of the schedule; localStorage
  // is a cache that only wins when it holds edits the server has not confirmed
  // yet (tracked by the dirty flag). Blindly re-pushing localStorage on every
  // load is what used to bring deleted and moved blocks back.
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setBacklog(loadBacklog());
    // Load windows and breaks from localStorage
    try {
      if (typeof window!=='undefined') {
        const winsRaw = window.localStorage.getItem(LS_AVAIL_WINDOWS);
        const brsRaw = window.localStorage.getItem(LS_AVAIL_BREAKS);
        if (winsRaw) { try { const w = JSON.parse(winsRaw); if (w && typeof w === 'object') setWindowsByDow(w); } catch {} }
        if (brsRaw) { try { const b = JSON.parse(brsRaw); if (b && typeof b === 'object') setBreaksByDow(b); } catch {} }
      }
    } catch {}
    let canceled = false;
    (async () => {
      try {
        const [bj, sj] = await Promise.all([
          apiFetch<{ blocks: any[] }>("/api/schedule"),
          apiFetch<{ settings: Record<string, any> }>("/api/settings?keys=availabilityTemplateV1,weeklyGoalsV1,weekPlanShowConflicts,weekPlanWeekStartYmd,weekPlanTwoWeeksOnly,internshipColor,sportsLawReviewColor,availabilityBreaksV1,availabilityWindowsV1")
        ]);
        if (canceled) return;
        {
          const settings = (sj?.settings || {}) as Record<string, any>;
          if (settings.availabilityTemplateV1 && typeof settings.availabilityTemplateV1 === 'object') {
            setAvailability(settings.availabilityTemplateV1 as any);
          }
          if (Array.isArray(settings.weeklyGoalsV1)) setGoals(settings.weeklyGoalsV1 as any[]);
          if (typeof settings.weekPlanTwoWeeksOnly === 'boolean') setTwoWeeksOnly(settings.weekPlanTwoWeeksOnly as boolean);
          const wk = settings.weekPlanWeekStartYmd;
          if (typeof wk === 'string') {
            const restored = restorableWeek(wk);
            if (restored) setWeekStart(restored);
          }
          // Load windows and breaks from server settings
          const readLocalJson = (key: string) => { try { if (typeof window!=='undefined') { const raw = window.localStorage.getItem(key); return raw?JSON.parse(raw):null; } } catch {} return null; };
          const localWins = readLocalJson(LS_AVAIL_WINDOWS);
          const localBr = readLocalJson(LS_AVAIL_BREAKS);
          const serverWins = (settings as any).availabilityWindowsV1;
          const serverBr = (settings as any).availabilityBreaksV1;
          const ts = (o:any) => { try { return Date.parse(o?.updatedAt||''); } catch { return 0; } };
          const bestWins = (ts(localWins) > ts(serverWins)) ? localWins : serverWins;
          const bestBr = (ts(localBr) > ts(serverBr)) ? localBr : serverBr;
          if (bestWins && typeof bestWins === 'object') setWindowsByDow(bestWins as Record<number, Array<{ start?: string; end?: string }>>);
          if (bestBr && typeof bestBr === 'object') setBreaksByDow(bestBr as Record<number, Array<{ start?: string; end?: string }>>);
          setSettingsReady(true);
        }
        {
          const remote = (Array.isArray(bj?.blocks) ? bj.blocks : []) as ScheduledBlock[];
          const local = loadSchedule();
          if (isScheduleDirty() && local.length >= 0 && hasUnsyncedEdits(local, remote)) {
            // We have local edits the server never acknowledged (offline, or the
            // tab closed before the save landed). Push them, then trust the
            // server again.
            try {
              await apiFetch('/api/schedule', { method: 'PUT', body: { blocks: local } });
              clearScheduleDirty();
            } catch {
              // Keep the flag so the next load retries.
            }
          } else {
            // Normal path: the server copy wins, so deletions and moves made
            // anywhere stay deleted and moved.
            clearScheduleDirty();
            hydrate(remote);
          }
        }
        // Mark blocks as loaded AFTER all loading logic is complete
        setBlocksLoaded(true);
      } catch {
        // Even if loading fails, mark as loaded so user changes can still be saved
        setBlocksLoaded(true);
      }
    })();
    return () => { canceled = true; };
  }, []);
  
  
  // useSchedule owns the only schedule write path. Duplicate writes and
  // unmount beacons previously raced with newer scheduling changes.
    useEffect(() => {
    const stored = localYmd(weekStart);
    try { if (typeof window !== 'undefined') window.localStorage.setItem(LS_WEEK_START, stored); } catch {}
    try { void apiFetch('/api/settings', { method: 'PATCH', body: { weekPlanWeekStartYmd: stored } }); } catch {}
  }, [weekStart]);
  useEffect(() => { try { void apiFetch('/api/settings', { method: 'PATCH', body: { availabilityTemplateV1: availability } }); } catch {} }, [availability]);
  useEffect(() => { try { void apiFetch('/api/settings', { method: 'PATCH', body: { weeklyGoalsV1: goals } }); } catch {} }, [goals]);
  // Persist windows and breaks
  useEffect(() => { try { const nowIso=new Date().toISOString(); if (typeof window!=='undefined') window.localStorage.setItem(LS_AVAIL_WINDOWS, JSON.stringify({ ...windowsByDow, updatedAt: nowIso })); if (settingsReady) void apiFetch('/api/settings', { method:'PATCH', body: { availabilityWindowsV1: { ...windowsByDow, updatedAt: nowIso } } }); } catch {} }, [windowsByDow, settingsReady]);
  useEffect(() => { try { const nowIso=new Date().toISOString(); if (typeof window!=='undefined') window.localStorage.setItem(LS_AVAIL_BREAKS, JSON.stringify({ ...breaksByDow, updatedAt: nowIso })); if (settingsReady) void apiFetch('/api/settings', { method:'PATCH', body: { availabilityBreaksV1: { ...breaksByDow, updatedAt: nowIso } } }); } catch {} }, [breaksByDow, settingsReady]);

  // Derive availability minutes from Windows minus Breaks (always active now)
  useEffect(() => {
    setAvailability(prev => {
      const next: Record<number, number> = { ...prev } as any;
      let changed = false;
      for (const dow of [0,1,2,3,4,5,6]) {
        const wins = (windowsByDow[dow]||[]) as Array<{ start?: string; end?: string }>;
        const winIntervals: Array<[number,number]> = wins
          .map(w => [toMin(normHHMM(w.start||''))??-1, toMin(normHHMM(w.end||''))??-1])
          .filter(([a,b]) => a>=0 && b>=0 && b>a) as Array<[number,number]>;
        winIntervals.sort((a,b)=>a[0]-b[0]);
        const mergedWins: Array<[number,number]> = [];
        for (const iv of winIntervals) {
          if (!mergedWins.length || iv[0] > mergedWins[mergedWins.length-1][1]) mergedWins.push([iv[0], iv[1]]);
          else mergedWins[mergedWins.length-1][1] = Math.max(mergedWins[mergedWins.length-1][1], iv[1]);
        }
        const brs = (breaksByDow[dow]||[]) as Array<{ start?: string; end?: string }>;
        const brIntervals: Array<[number,number]> = brs
          .map(b => [toMin(normHHMM(b.start||''))??-1, toMin(normHHMM(b.end||''))??-1])
          .filter(([a,b]) => a>=0 && b>=0 && b>a) as Array<[number,number]>;
        brIntervals.sort((a,b)=>a[0]-b[0]);
        const mergedBr: Array<[number,number]> = [];
        for (const iv of brIntervals) {
          if (!mergedBr.length || iv[0] > mergedBr[mergedBr.length-1][1]) mergedBr.push([iv[0], iv[1]]);
          else mergedBr[mergedBr.length-1][1] = Math.max(mergedBr[mergedBr.length-1][1], iv[1]);
        }
        let total = 0;
        for (const [ws,we] of mergedWins) {
          const base = Math.max(0, we - ws);
          let over = 0;
          for (const [bs,be] of mergedBr) { const sC = Math.max(ws, bs); const eC = Math.min(we, be); if (eC>sC) over += (eC - sC); }
          total += Math.max(0, base - over);
        }
        if ((next as any)[dow] !== total) { (next as any)[dow] = total; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [windowsByDow, breaksByDow]);

  // Tasks for catch-up and unscheduled lists come from shared useTasks hook
  // Load goals and twoWeeksOnly flag from localStorage
  useEffect(() => { setGoals(loadGoals()); }, []);
  useEffect(() => { try { if (typeof window!=='undefined') setTwoWeeksOnly((window.localStorage.getItem(LS_TWO_WEEKS)||'false')==='true'); } catch {} }, []);
  useEffect(() => { if (typeof window!=='undefined') window.localStorage.setItem(LS_TWO_WEEKS, twoWeeksOnly ? 'true':'false'); try { void apiFetch('/api/settings', { method: 'PATCH', body: { weekPlanTwoWeeksOnly: twoWeeksOnly } }); } catch {} }, [twoWeeksOnly]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate()+i); return d; }), [weekStart]);

  const colorForCourse = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of (courses||[])) {
      const key = normCourseKey(c?.title || '');
      const col = (c?.color || '').toString().trim();
      if (key && col) map[key] = col;
    }
    return (name?: string | null) => {
      const raw = (name || '').toString();
      const k = normCourseKey(raw);
      try { if (typeof window !== 'undefined' && k === 'internship') { const ls = window.localStorage.getItem('internshipColor'); if (ls) return ls; } } catch {}
      try { if (typeof window !== 'undefined' && k === 'sports law review') { const ls = window.localStorage.getItem('sportsLawReviewColor'); if (ls) return ls; } } catch {}
      return map[k] || fallbackCourseColor(raw);
    };
  }, [courses]);

  const remainingByTask = useMemo(() => remainingEstimates(tasks), [tasks]);
  const studyLoadByDay = useMemo(() =>
    summarizeStudyDays(blocks, sessions, when => chicagoYmd(new Date(when)), remainingByTask),
    [blocks, sessions, remainingByTask]);

  

  // Event intervals (minutes) by day key, merged and minutes totals — used in capacity math
  const eventIntervalsByKey = useMemo(() => {
    const map: Record<string, Array<[number,number]>> = {};
    for (const d of days) map[ymd(d)] = [];
    // Classes
    for (const c of (courses||[])) {
      const start = c.startDate ? new Date(c.startDate) : null;
      const end = c.endDate ? new Date(c.endDate) : null;
      const blocksArr = (Array.isArray(c.meetingBlocks) && c.meetingBlocks.length)
        ? c.meetingBlocks
        : ((Array.isArray(c.meetingDays) && c.meetingStart && c.meetingEnd) ? [{ days: c.meetingDays, start: c.meetingStart, end: c.meetingEnd }] : []);
      if (!Array.isArray(blocksArr) || !blocksArr.length) continue;
      for (const d of days) {
        const within = (!start || d >= start) && (!end || d <= end);
        if (!within) continue;
        for (const b of blocksArr) {
          if (!Array.isArray(b.days)) continue;
          if (b.days.includes(d.getDay())) {
            const sMin = toMin(normHHMM((b as any).start)); const eMin = toMin(normHHMM((b as any).end));
            if (sMin!=null && eMin!=null && eMin>sMin) map[ymd(d)].push([sMin, eMin]);
          }
        }
      }
    }
    // Timed tasks
    for (const t of (tasks||[])) {
      const k = ymd(new Date(t.dueDate)); if (!(k in map)) continue;
      const sMin = toMin(normHHMM((t as any).startTime)); const eMin = toMin(normHHMM((t as any).endTime));
      if (sMin!=null && eMin!=null && eMin>sMin) map[k].push([sMin, eMin]);
    }
    // Merge per day
    for (const k of Object.keys(map)) {
      const arr = map[k].slice().sort((a,b)=>a[0]-b[0]);
      const merged: Array<[number,number]> = [];
      for (const iv of arr) {
        if (!merged.length || iv[0] > merged[merged.length-1][1]) merged.push([iv[0], iv[1]]);
        else merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], iv[1]);
      }
      map[k] = merged;
    }
    return map;
  }, [courses, tasks, days]);

  const eventMinutesByKey = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of days) {
      const k = ymd(d);
      const iv = eventIntervalsByKey[k] || [];
      let sum = 0; for (const [a,b] of iv) sum += Math.max(0, b-a);
      m[k] = sum;
    }
    return m;
  }, [days, eventIntervalsByKey]);

  const effectiveCapByKey = useMemo(() => {
    const cap: Record<string, number> = {};
    for (const day of days) {
      const key = ymd(day);
      cap[key] = dailyStudyCapacity(day.getDay(), availability, windowsByDow, breaksByDow, conflictsForDay(key, courses, tasks));
    }
    return cap;
  }, [days, windowsByDow, breaksByDow, availability, courses, tasks]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, Array<{ label: string; time?: string; color?: string; s?: number }>> = {};
    const keyOf = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    const fmt12 = (hhmm?: string | null) => {
      if (!hhmm || !/^(\d{2}):(\d{2})$/.test(hhmm)) return '';
      const [hStr, mStr] = hhmm.split(':');
      const h = parseInt(hStr, 10);
      const ap = h >= 12 ? 'PM' : 'AM';
      let h12 = h % 12;
      if (h12 === 0) h12 = 12;
      return `${h12}:${mStr} ${ap}`;
    };
    const fmt12Range = (s?: string|null, e?: string|null) => {
      const ss = fmt12(s||''); const ee = fmt12(e||'');
      if (!ss || !ee) return (ss||ee||'All day');
      const sm = /\s(AM|PM)$/i.exec(ss)?.[1] || '';
      const em = /\s(AM|PM)$/i.exec(ee)?.[1] || '';
      if (sm && em && sm===em) return `${ss.replace(/\s(AM|PM)$/i,'')}–${ee.replace(/\s(AM|PM)$/i,'')} ${sm}`;
      return `${ss}–${ee}`;
    };
    for (const d of days) {
      map[ymd(d)] = [];
    }
    // Classes only (no tasks) in Events panel
    for (const c of (courses||[])) {
      const start = c.startDate ? new Date(c.startDate) : null;
      const end = c.endDate ? new Date(c.endDate) : null;
      const blocksArr = (Array.isArray(c.meetingBlocks) && c.meetingBlocks.length)
        ? c.meetingBlocks
        : ((Array.isArray(c.meetingDays) && c.meetingStart && c.meetingEnd)
            ? [{ days: c.meetingDays, start: c.meetingStart, end: c.meetingEnd, location: c.room || c.location || null }]
            : []);
      if (!Array.isArray(blocksArr) || !blocksArr.length) continue;
      for (const d of days) {
        const within = (!start || d >= start) && (!end || d <= end);
        if (!within) continue;
        for (const b of blocksArr) {
          if (!Array.isArray(b.days)) continue;
          if (!b.days.includes(d.getDay())) continue;
          const sNorm = normHHMM((b as any).start);
          const eNorm = normHHMM((b as any).end);
          const k = keyOf(d);
          const courseName = (c.title || c.code || '').toString();
          const sMin = toMin(sNorm||'');
          if (!map[k]) map[k] = [];
          map[k].push({
            label: courseName || 'Class',
            time: (sNorm && eNorm) ? fmt12Range(sNorm,eNorm) : 'All day',
            color: colorForCourse(courseName),
            s: (sMin ?? 24*60),
          });
        }
      }
    }
    // Sort by start minutes asc; all-day at end
    for (const k of Object.keys(map)) {
      map[k].sort((a,b) => (
        (Number(a.s ?? 1e9) - Number(b.s ?? 1e9)) ||
        String(a.label || '').localeCompare(String(b.label || ''))
      ));
    }
    return map;
  }, [courses, days]);

  const taskById = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of (tasks || [])) {
      if (!t || !t.id) continue;
      m.set(t.id, t);
    }
    return m;
  }, [tasks]);

  function moveBlockLaterToday(b: ScheduledBlock) {
    // Moves to the end of today's list. Does not change the clock time.
    snapshot('Reorder task');
    setBlocks(prev => [...prev.filter(x => x.day !== b.day), ...prev.filter(x => x.day === b.day && x.id !== b.id), b]);
  }

  function pushBlockToTomorrow(b: ScheduledBlock) {
    const tryDays = 21; // look ahead up to 3 weeks
    const base = new Date(`${b.day}T12:00:00`);
    for (let i=1;i<=tryDays;i++) {
      const d = new Date(base); d.setDate(d.getDate()+i);
      const k = ymd(d); const dow = d.getDay();
      const effCap = effectiveCapByKey[k] ?? dailyStudyCapacity(dow, availability, windowsByDow, breaksByDow, conflictsForDay(k,courses,tasks));
      const candidate = addPlannedStudyMinutes(studyLoadByDay[k], b.taskId, b.plannedMinutes, remainingByTask);
      if (candidate.committedMinutes <= effCap) {
        snapshot('Move task to another day');
        setBlocks(prev => prev.map(x => x.id === b.id ? { ...x, day: k } : x));
        return;
      }
    }
  }

  // Weekly quota selectors (current week in Chicago time)
  const weekKeysCur = useMemo(() => weekKeysChicago(new Date()), []);
  const todayKeyCur = useMemo(() => chicagoYmd(new Date()), []);
  const todayIdxCur = useMemo(() => weekKeysCur.indexOf(todayKeyCur), [weekKeysCur, todayKeyCur]);
  const todayDowCur = useMemo(() => { const [y,m,da]=todayKeyCur.split('-').map(x=>parseInt(x,10)); return new Date(y,(m as number)-1,da).getDay(); }, [todayKeyCur]);
  const todayCapacityCur = useMemo(() => effectiveCapByKey[todayKeyCur] ?? dailyStudyCapacity(todayDowCur, availability, windowsByDow, breaksByDow, conflictsForDay(todayKeyCur,courses,tasks)), [effectiveCapByKey, todayKeyCur, todayDowCur, availability, windowsByDow, breaksByDow, courses, tasks]);
  const remainingTodayCapacityCur = useMemo(() => Math.max(0, todayCapacityCur - (studyLoadByDay[todayKeyCur]?.committedMinutes || 0)), [todayCapacityCur, studyLoadByDay, todayKeyCur]);
  const workdaysLeftCur = useMemo(() => {
    const future = weekKeysCur.slice(Math.max(0, todayIdxCur+1)).filter(k => { const [y,m,da]=k.split('-').map(x=>parseInt(x,10)); const d=new Date(y,(m as number)-1,da); return (availability[d.getDay()]||0) > 0; }).length;
    const includeToday = remainingTodayCapacityCur > 0 ? 1 : 0;
    return includeToday + future;
  }, [weekKeysCur, todayIdxCur, availability, remainingTodayCapacityCur]);
  const globalGoalMinutes = useMemo(() => (goals.find(g => g.scope==='global')?.weeklyMinutes || 0), [goals]);
  const loggedToDateCur = useMemo(() => {
    return (sessions||[]).filter((s:any)=>{ const k=chicagoYmd(new Date(s.when)); const i=weekKeysCur.indexOf(k); return i!==-1 && i<=todayIdxCur; }).reduce((sum:number,s:any)=>sum+(s.minutes||0),0);
  }, [sessions, weekKeysCur, todayIdxCur]);
  const weeklyNeededCur = useMemo(() => Math.max(0, globalGoalMinutes - loggedToDateCur), [globalGoalMinutes, loggedToDateCur]);
  const dailyQuotaCur = useMemo(() => Math.ceil(weeklyNeededCur / Math.max(workdaysLeftCur,1)), [weeklyNeededCur, workdaysLeftCur]);

  // Catch-Up helpers
  function ymdFromISO(iso: string): string { const dt = new Date(iso); return ymd(dt); }
  function addDaysYmd(ymdStr: string, delta: number): string { const [y,m,da]=ymdStr.split('-').map(n=>parseInt(n,10)); const d=new Date(y,(m as number)-1,da); d.setDate(d.getDate()+delta); return ymd(d); }

  function computeCatchUpPreview() {
    try {
      const today = ymd(new Date());
      const horizonEnd = addDaysYmd(today, 13); // 14 days
      const horizonDays: string[] = []; for (let i=0;i<14;i++) horizonDays.push(addDaysYmd(today, i));
      const totalCap: Record<string, number> = {};
      for (const dk of horizonDays) { const [Y,M,D] = dk.split('-').map(x=>parseInt(x,10)); const dt = new Date(Y,(M as number)-1,D); totalCap[dk] = effectiveCapByKey[dk] ?? dailyStudyCapacity(dt.getDay(),availability,windowsByDow,breaksByDow,conflictsForDay(dk,courses,tasks)); }
      const previewLoad = new Map(horizonDays.map(day => [day, studyLoadByDay[day]]));
      const usedBefore: Record<string, number> = {};
      const capLeft: Record<string, number> = {};
      for (const day of horizonDays) {
        usedBefore[day] = previewLoad.get(day)?.committedMinutes || 0;
        capLeft[day] = Math.max(0, (totalCap[day] || 0) - usedBefore[day]);
      }

      const scheduledByTask = new Map<string, number>();
      for (const b of blocks) { if (b.taskId) scheduledByTask.set(b.taskId, (scheduledByTask.get(b.taskId)||0) + b.plannedMinutes); }

      const spill = (tasks||[]).filter(t => t && t.status==='todo').filter(t => { const dueY = ymdFromISO(t.dueDate); return (dueY < today || dueY <= horizonEnd); });
      const withRemaining: Array<{ task: Task; est: number; remaining: number; guessed: boolean }> = spill.map(t => {
        const { minutes: baseMinutes, guessed } = estimateMinutesForTask(t as any);
        const already = scheduledByTask.get(t.id) || 0;
        const rem = Math.max(0, baseMinutes - already);
        return { task: t, est: baseMinutes, remaining: rem, guessed };
      }).filter(x => x.remaining > 0);

      withRemaining.sort((a,b) => {
        const ad = ymdFromISO(a.task.dueDate), bd = ymdFromISO(b.task.dueDate);
        if (ad !== bd) return ad.localeCompare(bd);
        const ap = a.task.priority ?? 0, bp = b.task.priority ?? 0; if (ap !== bp) return bp - ap;
        return b.remaining - a.remaining;
      });

      const proposed = horizonDays.map(dk => ({ day: dk, total: totalCap[dk]||0, usedBefore: usedBefore[dk]||0, usedAfter: usedBefore[dk]||0, items: [] as Array<{ taskId:string; title:string; course:string; minutes:number; guessed:boolean }> }));
      const unsched: Array<{ taskId: string; title: string; remaining: number; dueYmd: string }> = [];
      for (const entry of withRemaining) {
        const t = entry.task; let rem = entry.remaining; const dueY = ymdFromISO(t.dueDate); const guessed = entry.guessed;
        for (const dk of horizonDays) {
          if (rem <= 0) break; if (dk > dueY) break; let left = capLeft[dk] || 0; if (left < 30) continue;
          let chunk = Math.min(rem, left); if (chunk >= 30) chunk = chunk - (chunk % 30); if (chunk < 30) continue;
          const row = proposed.find(r => r.day === dk)!;
          row.items.push({ taskId: t.id, title: t.title, course: t.course || '', minutes: chunk, guessed });
          const nextLoad = addPlannedStudyMinutes(previewLoad.get(dk), t.id, chunk, remainingByTask);
          previewLoad.set(dk, nextLoad);
          row.usedAfter = nextLoad.committedMinutes;
          capLeft[dk] = Math.max(0, (totalCap[dk] || 0) - row.usedAfter);
          rem -= chunk;
        }
        if (rem > 0) unsched.push({ taskId: t.id, title: t.title, remaining: rem, dueYmd: dueY });
      }
      setCatchupPreview({ days: proposed, unschedulable: unsched });
      setShowCatchup(true);
    } catch { setCatchupPreview(null); setShowCatchup(false); }
  }

  function applyCatchUp() {
    if (!catchupPreview) return;
    const prev = blocks.slice();
    const additions: ScheduledBlock[] = [];
    for (const dayRow of catchupPreview.days) {
      for (const it of dayRow.items) {
        additions.push({ id: uid(), taskId: it.taskId, day: dayRow.day, plannedMinutes: it.minutes, guessed: it.guessed, title: it.title, course: it.course || '', pages: null, priority: null, catchup: true });
      }
    }
    snapshot('Apply catch-up');
    setBlocks(prev => [...prev, ...additions]);
    setShowCatchup(false);
    setCatchupPreview(null);
  }

  function undoCatchUp() { if (!undoSnapshot) return; setBlocks(undoSnapshot); setUndoSnapshot(null); setUndoLabel(''); }

  // Tasks to schedule: from Tasks API (status=todo), excluding tasks already scheduled this week
  const tasksTodo = useMemo(() => (tasks||[]).filter(t => t && t.status === 'todo'), [tasks]);
  const scheduledIdsThisWeek = useMemo(() => {
    const keys = new Set(days.map(d => ymd(d))); return new Set(blocks.filter(b => keys.has(b.day)).map(b => b.taskId));
  }, [blocks, days]);
  const unscheduledTasks = useMemo(() => {
    const base = tasksTodo.filter(t => !scheduledIdsThisWeek.has(t.id));
    if (!twoWeeksOnly) return base;
    const today = ymd(new Date());
    const end = addDaysYmd(today, 13);
    return base.filter(t => { const dy = ymdFromISO(t.dueDate); return dy >= today && dy <= end; });
  }, [tasksTodo, scheduledIdsThisWeek, twoWeeksOnly]);
  function sortValCourse(t: Task) { return displayCourseFor(t).toLowerCase(); }
  function sortValDue(t: Task) { const n = new Date(t.dueDate).getTime(); return isNaN(n) ? Number.MAX_SAFE_INTEGER : n; }
  function sortValPriority(t: Task) { return -(t.priority ?? 0); }
  function sortValEstimate(t: Task) { return -((t.estimatedMinutes ?? 0) as number); }
  const unscheduledSorted = useMemo(() => {
    const arr = unscheduledTasks.slice();
    arr.sort((a,b) => {
      let cmp = 0;
      if (sortBy === 'due') cmp = sortValDue(a) - sortValDue(b);
      else if (sortBy === 'course') cmp = sortValCourse(a).localeCompare(sortValCourse(b));
      else if (sortBy === 'priority') cmp = sortValPriority(a) - sortValPriority(b);
      else cmp = sortValEstimate(a) - sortValEstimate(b);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [unscheduledTasks, sortBy, sortDir]);
  function displayCourseFor(t: Task): string {
    const c = (t.course || '').trim(); if (c) return c;
    const a = (t as any).activity; if ((a || '').toLowerCase() === 'internship') return 'Internship';
    const titleL = (t.title || '').toLowerCase();
    const tagsL: string[] = Array.isArray((t as any).tags) ? ((t as any).tags as string[]).map(s=>String(s).toLowerCase()) : [];
    if (titleL.includes('sports law review') || tagsL.includes('sports law review') || /\bslr\b/i.test(t.title || '')) return 'Sports Law Review';
    return '';
  }
  function onDragStartTask(e: React.DragEvent, t: Task) { e.dataTransfer.setData('text/plain', `task:${t.id}`); }
  function onDropDay(e: React.DragEvent, d: Date) {
    e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (!id) return;
    if (id.startsWith('task:')) {
      const tid = id.slice('task:'.length);
      const t = tasksTodo.find(x => x.id === tid);
      if (!t) return;
      const { minutes, guessed } = estimateMinutesForTask(t);
      const p = (typeof (t as any).pagesRead==='number' && (t as any).pagesRead>0) ? (t as any).pagesRead : null;
      const block: ScheduledBlock = { id: uid(), taskId: t.id, day: ymd(d), plannedMinutes: minutes, guessed, title: t.title, course: displayCourseFor(t) || '', pages: p, priority: t.priority ?? null };
      const k=ymd(d);
      const cap=effectiveCapByKey[k] ?? dailyStudyCapacity(d.getDay(),availability,windowsByDow,breaksByDow,conflictsForDay(k,courses,tasks));
      const projection=addPlannedStudyMinutes(studyLoadByDay[k],t.id,minutes,remainingByTask);
      if(projection.committedMinutes>cap&&!window.confirm('Exceeds the day’s study hours by '+(projection.committedMinutes-cap)+' minutes. Add anyway?'))return;
      snapshot('Schedule task');
      setBlocks(prev => [...prev, block]);
      return;
    }
    // legacy: backlog id
    const it = backlog.find(x => x.id === id); if (!it) return;
    const { minutes, guessed } = estimateMinutesFor(it);
    const block: ScheduledBlock = { id: uid(), taskId: it.id, day: ymd(d), plannedMinutes: minutes, guessed, title: it.title, course: it.course, pages: it.pages ?? null, priority: it.priority ?? null };
    const k=ymd(d);
    const cap=effectiveCapByKey[k] ?? dailyStudyCapacity(d.getDay(),availability,windowsByDow,breaksByDow,conflictsForDay(k,courses,tasks));
    const projection=addPlannedStudyMinutes(studyLoadByDay[k],it.id,block.plannedMinutes,remainingByTask);
    if(projection.committedMinutes>cap&&!window.confirm('Exceeds daily capacity by '+(projection.committedMinutes-cap)+' minutes. Add anyway?'))return;
    snapshot('Schedule task');
    setBlocks(prev => [...prev, block]);
  }
  function removeBlock(id: string) { snapshot('Remove scheduled task'); setBlocks(prev => prev.filter(b => b.id !== id)); }

  function autopackWeek() {
    const keys = new Set(days.map(d => ymd(d)));
    const existing = blocks.filter(b => keys.has(b.day));
    const occupied = new Map(days.map(d => [ymd(d), studyLoadByDay[ymd(d)]]));
    const eff = (d: Date) => effectiveCapByKey[ymd(d)] ?? dailyStudyCapacity(d.getDay(),availability,windowsByDow,breaksByDow,conflictsForDay(ymd(d),courses,tasks));
    const unscheduled = unscheduledSorted.filter(t => !existing.some(b => b.taskId === t.id));
    const nextBlocks: ScheduledBlock[] = [];
    let skipped = 0;
    for (const t of unscheduled) {
      const { minutes, guessed } = estimateMinutesForTask(t);
      const dueY = chicagoYmd(new Date(t.dueDate));
      let placed = false;
      // try days up to and including due date
      for (const d of days) {
        const k = ymd(d);
        if (k > dueY) continue;
        const cap = eff(d);
        const candidate = addPlannedStudyMinutes(occupied.get(k), t.id, minutes, remainingByTask);
        if (candidate.committedMinutes <= cap) { nextBlocks.push({ id: uid(), taskId: t.id, day: k, plannedMinutes: minutes, guessed, title: t.title, course: t.course || '', pages: (typeof (t as any).pagesRead==='number' && (t as any).pagesRead>0)? (t as any).pagesRead : null, priority: t.priority ?? null }); occupied.set(k, candidate); placed = true; break; }
      }
      // No silent overflow: leave tasks unscheduled if capacity is exhausted.
      if (!placed) skipped++;
    }
    if (nextBlocks.length) { snapshot('Autopack week'); setBlocks(prev => [...prev, ...nextBlocks]); }
    if (skipped) notifyToast({ kind: 'warning', message: skipped + ' task' + (skipped===1?'':'s') + ' could not fit without exceeding your study hours. Try Catch-Up or change availability.' });
  }
function toMin(hhmm?: string | null): number | null { if (!hhmm) return null; const m=/^(\d{2}):(\d{2})$/.exec(hhmm); if(!m) return null; const h=parseInt(m[1],10), mi=parseInt(m[2],10); if(isNaN(h)||isNaN(mi)) return null; return h*60+mi; }
function minutesToHHMM(mins: number): string { const m = ((mins % 1440) + 1440) % 1440; const h = Math.floor(m/60); const mi = m % 60; return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`; }
function adjustTimeText(val: string, deltaMin: number): string {
  const n = toMin(normHHMM(val||'')); if (n==null) return val;
  const next = minutesToHHMM(n + deltaMin);
  return fmt12Input(next);
}
function shiftWeek(delta: number) {
    // Save immediately before shifting to prevent data loss
    try { void apiFetch('/api/schedule', { method: 'PUT', body: { blocks } }).then(() => { try { notifyToast({ kind: 'success', message: 'Schedule saved.' }); } catch {} }); } catch {}
    setWeekStart(prev => { const x = new Date(prev); x.setDate(x.getDate() + delta*7); return saturdayOf(x); });
  }
  function clearThisWeek() {
    const keys = new Set(days.map(d => ymd(d)));
    const count = blocks.filter(b => keys.has(b.day)).length;
    if (!count || !window.confirm(`Remove ${count} scheduled item${count===1?'':'s'} from this week? You can undo this change.`)) return;
    snapshot('Clear week');
    setBlocks(prev => prev.filter(b => !keys.has(b.day)));
  }
  async function promoteWeekToTasks() {
    const keys = new Set(days.map(d => ymd(d))); const batch = blocks.filter(b => keys.has(b.day)); let ok = 0, fail = 0;
    for (const b of batch) {
      const body: any = { title: b.title, course: b.course || null, dueDate: endOfDayIso(b.day), status: 'todo', estimatedMinutes: b.plannedMinutes, priority: b.priority ?? null, tags: ['week-plan'] };
      try { await apiFetch('/api/tasks', { method: 'POST', body }); ok++; } catch { fail++; }
    }
    try { notifyToast({ kind: fail ? 'warning' : 'success', message: `Promoted ${ok} task${ok!==1?'s':''}${fail?`, ${fail} failed`:''}.` }); } catch {}
  }

  const noTasksToPlan = unscheduledSorted.length === 0;

  // The planner is entirely driven by browser state (the stored week, the
  // availability template, the cached schedule). Rendering it on the server
  // would produce markup the client immediately disagrees with.
  if (!mounted) {
    return (
      <main className="flex flex-col space-y-6">
        <section className="card p-6">
          <div className="text-sm opacity-60">Loading your week…</div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex flex-col space-y-6">
      <section className="card p-4 sm:p-6 space-y-4 order-1">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <button aria-label="Previous week" onClick={()=>shiftWeek(-1)} className="px-2 py-1 rounded border border-[#1b2344] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">◀</button>
            <div className="text-sm" aria-live="polite">Week of {dayLabel(weekStart)}</div>
            <button aria-label="Jump to this week" onClick={()=>setWeekStart(saturdayOf(new Date()))} className="px-2 py-1 rounded border border-[#1b2344] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">This week</button>
            <button aria-label="Next week" onClick={()=>shiftWeek(1)} className="px-2 py-1 rounded border border-[#1b2344] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">▶</button>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={autopackWeek} className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">Autopack Week</button>
            <button onClick={clearThisWeek} className="px-3 py-2 rounded border border-[#1b2344] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">Clear This Week</button>
            <button onClick={promoteWeekToTasks} className="px-3 py-2 rounded border border-emerald-600 text-emerald-400 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">Promote Week → Tasks</button>
            <button onClick={computeCatchUpPreview} className="px-3 py-2 rounded border border-[#1b2344] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">Catch-Up</button>
            <button onClick={undoCatchUp} title={undoLabel ? 'Undo: ' + undoLabel : 'Nothing to undo'} className="px-3 py-2 rounded border border-[#1b2344] text-sm disabled:opacity-50" disabled={!undoSnapshot}>Undo {undoLabel || 'last change'}</button>
            <span role="status" className={`text-xs ${saveStatus==='error'?'text-rose-300':'text-slate-300'}`}>{saveStatus==='saving'?'Saving…':saveStatus==='error'?'Save failed. Restored previous schedule.':'Saved'}</span>
            <div className="text-xs text-slate-300/80 ml-2">Need ~{minutesToHM(dailyQuotaCur)}/day to hit goal · <button onClick={autopackWeek} className="underline">Autopack</button></div>
          </div>
        </div>
        {/* Compact Availability Summary */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => setAvailabilityExpanded(v => !v)} aria-expanded={availabilityExpanded} className="text-sm text-slate-200 hover:text-white">
              Weekly availability <span className="ml-2 text-xs text-slate-400">{availabilityExpanded?'Hide settings':'Edit settings'}</span>
            </button>
            <div className="flex flex-wrap gap-2 text-xs">
              <button onClick={()=>{ const w = [{ id: uid(), start:'9:00 AM', end:'5:00 PM' }]; setWindowsByDow({ 0:[], 1:w.map(x=>({...x, id:uid()})), 2:w.map(x=>({...x, id:uid()})), 3:w.map(x=>({...x, id:uid()})), 4:w.map(x=>({...x, id:uid()})), 5:w.map(x=>({...x, id:uid()})), 6:[] }); setBreaksByDow({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] }); }} className="px-2 py-1 rounded border border-emerald-600/50 text-emerald-400 hover:bg-emerald-900/20">9–5 Weekdays</button>
              <button onClick={()=>{ const w = [{ id: uid(), start:'6:00 PM', end:'10:00 PM' }]; setWindowsByDow({ 0:w.map(x=>({...x, id:uid()})), 1:w.map(x=>({...x, id:uid()})), 2:w.map(x=>({...x, id:uid()})), 3:w.map(x=>({...x, id:uid()})), 4:w.map(x=>({...x, id:uid()})), 5:w.map(x=>({...x, id:uid()})), 6:w.map(x=>({...x, id:uid()})) }); setBreaksByDow({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] }); }} className="px-2 py-1 rounded border border-blue-600/50 text-blue-400 hover:bg-blue-900/20">Evenings</button>
              <button onClick={()=>{ setWindowsByDow({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] }); setBreaksByDow({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] }); }} className="px-2 py-1 rounded border border-white/20 text-slate-400 hover:bg-white/5">Clear</button>
            </div>
          </div>
          
          {/* Compact 7-day grid */}
          {availabilityExpanded && <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {[6,0,1,2,3,4,5].map(dow => {
              const wins = windowsByDow[dow] || [];
              const brks = breaksByDow[dow] || [];
              const mins = availability[dow] ?? 0;
              return (
                <button
                  key={dow}
                  onClick={() => setToolbarMenu(m => (m && m.dow === dow) ? null : { dow })}
                  className={`relative rounded-lg p-3 border text-center transition-all hover:bg-white/5 ${
                    toolbarMenu?.dow === dow ? 'border-emerald-500 bg-emerald-900/20' : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div className="text-xs font-medium text-slate-300">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]}</div>
                  <div className={`text-lg font-semibold ${mins > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {mins > 0 ? minutesToHM(mins) : '—'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {wins.length > 0 ? `${wins.length} window${wins.length > 1 ? 's' : ''}` : 'No windows'}
                  </div>
                </button>
              );
            })}
          </div>}

          {/* Edit Panel for selected day */}
          {availabilityExpanded && toolbarMenu && (
            <div className="rounded-xl border border-white/10 bg-[#0b1020] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][toolbarMenu.dow]} Schedule</div>
                <button onClick={() => setToolbarMenu(null)} className="text-xs text-slate-400 hover:text-white">Close</button>
              </div>
              
              {/* Study Windows */}
              <div>
                <div className="text-xs text-emerald-400 mb-2 font-medium">Study Windows</div>
                <div className="space-y-2">
                  {(windowsByDow[toolbarMenu.dow] || []).map((w, i) => {
                    const sOk = toMin(normHHMM(w.start||''))!=null;
                    const eOk = toMin(normHHMM(w.end||''))!=null;
                    return (
                      <div key={(w as any).id || i} className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="9:00 AM"
                          value={fmt12Input(w.start||'')}
                          onChange={e => setWindowsByDow(prev => {
                            const arr = (prev[toolbarMenu.dow]||[]).slice();
                            arr[i] = {...arr[i], start: e.target.value};
                            return {...prev, [toolbarMenu.dow]: arr};
                          })}
                          className={`w-28 px-3 py-2 text-sm rounded bg-white/10 border ${sOk ? 'border-white/10' : 'border-rose-600'}`}
                        />
                        <span className="text-slate-400">to</span>
                        <input
                          type="text"
                          placeholder="5:00 PM"
                          value={fmt12Input(w.end||'')}
                          onChange={e => setWindowsByDow(prev => {
                            const arr = (prev[toolbarMenu.dow]||[]).slice();
                            arr[i] = {...arr[i], end: e.target.value};
                            return {...prev, [toolbarMenu.dow]: arr};
                          })}
                          className={`w-28 px-3 py-2 text-sm rounded bg-white/10 border ${eOk ? 'border-white/10' : 'border-rose-600'}`}
                        />
                        <button
                          onClick={() => setWindowsByDow(prev => {
                            const arr = (prev[toolbarMenu.dow]||[]).slice();
                            arr.splice(i, 1);
                            return {...prev, [toolbarMenu.dow]: arr};
                          })}
                          className="px-2 py-1 rounded text-rose-400 hover:bg-rose-900/20 text-xs"
                        >×</button>
                      </div>
                    );
                  })}
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => setWindowsByDow(prev => {
                      const arr = (prev[toolbarMenu.dow]||[]).slice();
                      arr.push({id: uid(), start:'', end:''} as any);
                      return {...prev, [toolbarMenu.dow]: arr};
                    })} className="px-3 py-1.5 rounded border border-emerald-600/50 text-emerald-400 text-xs hover:bg-emerald-900/20">+ Add Window</button>
                    <button onClick={() => setWindowsByDow(prev => ({...prev, [toolbarMenu.dow]: [{id: uid(), start:'9:00 AM', end:'5:00 PM'}]}))} className="px-2 py-1 rounded border border-white/10 text-xs hover:bg-white/5">9–5</button>
                    <button onClick={() => setWindowsByDow(prev => ({...prev, [toolbarMenu.dow]: [{id: uid(), start:'8:00 AM', end:'12:00 PM'}, {id: uid(), start:'1:00 PM', end:'5:00 PM'}]}))} className="px-2 py-1 rounded border border-white/10 text-xs hover:bg-white/5">8–12, 1–5</button>
                  </div>
                </div>
              </div>

              {/* Breaks */}
              <div>
                <div className="text-xs text-amber-400 mb-2 font-medium">Breaks (subtracted from windows)</div>
                <div className="space-y-2">
                  {(breaksByDow[toolbarMenu.dow] || []).map((br, i) => {
                    const sOk = toMin(normHHMM(br.start||''))!=null;
                    const eOk = toMin(normHHMM(br.end||''))!=null;
                    return (
                      <div key={(br as any).id || i} className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="12:00 PM"
                          value={fmt12Input(br.start||'')}
                          onChange={e => setBreaksByDow(prev => {
                            const arr = (prev[toolbarMenu.dow]||[]).slice();
                            arr[i] = {...arr[i], start: e.target.value};
                            return {...prev, [toolbarMenu.dow]: arr};
                          })}
                          className={`w-28 px-3 py-2 text-sm rounded bg-white/10 border ${sOk ? 'border-white/10' : 'border-rose-600'}`}
                        />
                        <span className="text-slate-400">to</span>
                        <input
                          type="text"
                          placeholder="1:00 PM"
                          value={fmt12Input(br.end||'')}
                          onChange={e => setBreaksByDow(prev => {
                            const arr = (prev[toolbarMenu.dow]||[]).slice();
                            arr[i] = {...arr[i], end: e.target.value};
                            return {...prev, [toolbarMenu.dow]: arr};
                          })}
                          className={`w-28 px-3 py-2 text-sm rounded bg-white/10 border ${eOk ? 'border-white/10' : 'border-rose-600'}`}
                        />
                        <button
                          onClick={() => setBreaksByDow(prev => {
                            const arr = (prev[toolbarMenu.dow]||[]).slice();
                            arr.splice(i, 1);
                            return {...prev, [toolbarMenu.dow]: arr};
                          })}
                          className="px-2 py-1 rounded text-rose-400 hover:bg-rose-900/20 text-xs"
                        >×</button>
                      </div>
                    );
                  })}
                  <button onClick={() => setBreaksByDow(prev => {
                    const arr = (prev[toolbarMenu.dow]||[]).slice();
                    arr.push({id: uid(), start:'', end:''} as any);
                    return {...prev, [toolbarMenu.dow]: arr};
                  })} className="px-3 py-1.5 rounded border border-amber-600/50 text-amber-400 text-xs hover:bg-amber-900/20">+ Add Break</button>
                </div>
              </div>

              {/* Copy to other days */}
              <div className="flex gap-2 pt-2 border-t border-white/10">
                <button onClick={() => {
                  const wins = (windowsByDow[toolbarMenu.dow]||[]).slice();
                  const brks = (breaksByDow[toolbarMenu.dow]||[]).slice();
                  setWindowsByDow(prev => ({...prev, 1: wins.map(x=>({...x, id:uid()})), 2: wins.map(x=>({...x, id:uid()})), 3: wins.map(x=>({...x, id:uid()})), 4: wins.map(x=>({...x, id:uid()})), 5: wins.map(x=>({...x, id:uid()}))}));
                  setBreaksByDow(prev => ({...prev, 1: brks.map(x=>({...x, id:uid()})), 2: brks.map(x=>({...x, id:uid()})), 3: brks.map(x=>({...x, id:uid()})), 4: brks.map(x=>({...x, id:uid()})), 5: brks.map(x=>({...x, id:uid()}))}));
                }} className="px-3 py-1.5 rounded border border-white/10 text-xs hover:bg-white/5">Copy to Weekdays</button>
                <button onClick={() => {
                  const wins = (windowsByDow[toolbarMenu.dow]||[]).slice();
                  const brks = (breaksByDow[toolbarMenu.dow]||[]).slice();
                  setWindowsByDow({0: wins.map(x=>({...x, id:uid()})), 1: wins.map(x=>({...x, id:uid()})), 2: wins.map(x=>({...x, id:uid()})), 3: wins.map(x=>({...x, id:uid()})), 4: wins.map(x=>({...x, id:uid()})), 5: wins.map(x=>({...x, id:uid()})), 6: wins.map(x=>({...x, id:uid()}))});
                  setBreaksByDow({0: brks.map(x=>({...x, id:uid()})), 1: brks.map(x=>({...x, id:uid()})), 2: brks.map(x=>({...x, id:uid()})), 3: brks.map(x=>({...x, id:uid()})), 4: brks.map(x=>({...x, id:uid()})), 5: brks.map(x=>({...x, id:uid()})), 6: brks.map(x=>({...x, id:uid()}))});
                }} className="px-3 py-1.5 rounded border border-white/10 text-xs hover:bg-white/5">Copy to All Days</button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3 order-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7 gap-2">
          {days.map((d) => {
            const k = ymd(d);
            const load = studyLoadByDay[k];
            const planned = load?.plannedMinutes || 0;
            const logged = load?.loggedMinutes || 0;
            const committed = load?.committedMinutes || 0;
            const stillPlanned = load?.remainingPlannedMinutes || 0;
            const cap = effectiveCapByKey[k] ?? (availability[d.getDay()] ?? 0);
            const left = Math.max(0, cap - committed);
            const overBy = Math.max(0, committed - cap);
            const completedPct = cap>0 ? Math.min(100,Math.round(100*logged/cap)) : 0;
            const scheduledPct = cap>0 ? Math.max(0,Math.min(100-completedPct,Math.round(100*stillPlanned/cap))) : 0;
            const dayBlocks = blocks.filter(b => b.day === k);
            return (
              <div key={k} className={`rounded border ${overBy>0?'border-rose-600':'border-[#1b2344]'} p-3 min-h-[220px]`} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>onDropDay(e,d)} role="listbox" aria-label={`Planned items for ${dayLabel(d)}`}>
                <div className="flex items-center justify-between mb-2">
                  <button type="button" className="text-sm text-slate-200 underline-offset-2 hover:underline" onClick={() => setExpandedDay(old => old===k?null:k)} aria-expanded={expandedDay===k}>{dayLabel(d)} {expandedDay===k?'▴':'▾'}</button>
                  <div className="text-xs text-slate-300/70 flex items-center gap-2">
                    <span>{minutesToHM(committed)} / {minutesToHM(cap)}</span>
                  </div>
                </div>
                <div className="h-2 w-full bg-[#0b1020] border border-[#1b2344] rounded overflow-hidden mb-1" role="progressbar" aria-valuemin={0} aria-valuemax={Math.max(cap,1)} aria-valuenow={Math.min(committed,Math.max(cap,1))} aria-label="Logged and scheduled study minutes">
                  <div className="flex h-full w-full">
                    <div className="bg-emerald-600 h-full" style={{ width: `${completedPct}%` }} />
                    <div className={`${overBy>0?'bg-rose-600':'bg-blue-500'} h-full`} style={{ width: `${scheduledPct}%` }} />
                  </div>
                </div>
                <div className="text-[10px] text-slate-300/70 mb-1">{minutesToHM(logged)} completed · {minutesToHM(stillPlanned)} still planned</div>
                <div className="text-[10px] text-slate-300/70 mb-2">{minutesToHM(left)} available{planned!==stillPlanned?' · partial progress applied':''}</div>
                {overBy>0 ? <div className="text-[11px] text-rose-400 mb-2">Over by {minutesToHM(overBy)}</div> : null}
                
                <div className="text-xs text-slate-300/70 mb-1">Events</div>
                <ul className="space-y-1 mb-2">
                  {(eventsByDay[k]||[]).length===0 ? (
                    <li className="text-[11px] text-slate-300/50">—</li>
                  ) : (
                    (eventsByDay[k]||[]).map((ev,i) => (
                      <li key={i} className="text-[11px] flex items-center gap-2 justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: ev.color||'#64748b' }} />
                          <span className="truncate">{ev.label}</span>
                        </div>
                        {ev.time ? <span className="shrink-0 text-slate-300/70">{ev.time}</span> : null}
                      </li>
                    ))
                  )}
                </ul>
                <div className="text-xs text-slate-300/70 mb-1">Planned</div>
                <ul className="space-y-1">
                  {dayBlocks.length===0 ? (
                    <li className="text-[11px] text-slate-300/50">Drop tasks here</li>
                  ) : dayBlocks.map(b => {
                    const t = b.taskId ? taskById.get(b.taskId) : undefined;
                    const displayCourse = (t?.course || b.course || "");
                    const displayTitle = t?.title || b.title;
                    const pages = (typeof (t as any)?.pagesRead === 'number' && (t as any).pagesRead > 0)
                      ? (t as any).pagesRead
                      : (typeof b.pages === 'number' && b.pages > 0 ? b.pages : null);
                    return (
                      <li key={b.id} className="text-[11px] flex items-start gap-2">
                        <span className="mt-1 w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colorForCourse(displayCourse) }} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-slate-200 ${expandedDay===k?'whitespace-normal break-words':'truncate'}`} title={displayTitle}>{displayCourse ? `${displayCourse}: ` : ''}{displayTitle}</div>
                          <div className="text-slate-300/70 flex items-center gap-2">
                            <span>{minutesToHM(b.plannedMinutes)}{b.guessed ? <span className="ml-1 inline-block px-1 rounded border border-amber-500 text-amber-400">guessed</span> : null}{pages ? <span className="ml-2">· {pages}p</span> : null}</span>
                            <span className="inline-flex items-center gap-1">
                              <button onClick={()=>moveBlockLaterToday(b)} className="px-1 py-0.5 rounded border border-[#1b2344]">Move to end</button>
                              <button onClick={()=>pushBlockToTomorrow(b)} className="px-1 py-0.5 rounded border border-[#1b2344]">Move to next available day</button>
                            </span>
                          </div>
                        </div>
                        <button aria-label="Remove block" onClick={()=>removeBlock(b.id)} className="px-1 py-0.5 rounded border border-[#1b2344] text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">X</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        {expandedDay && days.some(day => ymd(day)===expandedDay) && (() => {
          const plan = blocks.filter(block => block.day === expandedDay);
          const load = studyLoadByDay[expandedDay];
          const cap = effectiveCapByKey[expandedDay] ?? 0;
          return <section className="mt-4 rounded-lg border border-blue-700/40 bg-blue-950/10 p-4 space-y-3" aria-label="Expanded day details">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Details for {expandedDay}</h3>
              <button type="button" className="text-xs underline" onClick={() => setExpandedDay(null)}>Close day</button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm text-slate-300">
              <div><div className="text-xs text-slate-500">Studied</div>{minutesToHM(load?.loggedMinutes || 0)}</div>
              <div><div className="text-xs text-slate-500">Still planned</div>{minutesToHM(load?.remainingPlannedMinutes || 0)}</div>
              <div><div className="text-xs text-slate-500">Available</div>{minutesToHM(Math.max(0,cap-(load?.committedMinutes||0)))}</div>
            </div>
            {plan.length ? plan.map(b => <div key={b.id} className="border-t border-white/10 pt-3 flex flex-wrap justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-white break-words">{b.title}</div>
                <div className="text-xs text-slate-400">{b.course || 'Unassigned'} · {minutesToHM(b.plannedMinutes)}</div>
              </div>
              <div className="flex flex-wrap gap-2 items-center text-xs">
                <button type="button" onClick={() => pushBlockToTomorrow(b)} className="rounded border border-white/20 px-2 py-1">Next available day</button>
                <button type="button" onClick={() => removeBlock(b.id)} className="rounded border border-rose-600/40 text-rose-300 px-2 py-1">Remove</button>
              </div>
            </div>) : <p className="text-sm text-slate-400">No remaining planned tasks for this day.</p>}
          </section>;
        })()}
      </section>

      <section className="card p-6 space-y-4 order-3">
        <div className="flex items-end justify-between gap-2">
          <h3 className="text-sm font-medium">Tasks to plan (drag to a day)</h3>
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              <span>Sort by</span>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)} className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1">
                <option value="due">Due date</option>
                <option value="course">Course</option>
                <option value="priority">Priority</option>
                <option value="estimate">Estimate</option>
              </select>
            </label>
            <button onClick={()=>setSortDir(d=>d==='asc'?'desc':'asc')} className="px-2 py-1 rounded border border-[#1b2344]">{sortDir==='asc'?'Asc':'Desc'}</button>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={twoWeeksOnly} onChange={e=>setTwoWeeksOnly(e.target.checked)} />
              <span>Due next 2 weeks</span>
            </label>
          </div>
        </div>
        {tasksLoading && !tasks.length ? (
          <div className="rounded border border-[#1b2344] p-4 text-sm text-slate-300/80">Loading your existing tasks…</div>
        ) : tasksError && !tasks.length ? (
          <div role="alert" className="rounded border border-rose-700/60 p-4 text-sm text-rose-300">Unable to load tasks: {tasksError}. Your saved tasks have not been deleted. Try refreshing the page.</div>
        ) : noTasksToPlan ? (
          <div className="rounded border border-dashed border-[#1b2344] p-4 text-sm text-slate-300/80">No unscheduled tasks match this view. Already-planned tasks are shown in the day cards. You can also turn off the two-week filter.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {unscheduledSorted.map(t => (
              <div key={t.id} draggable onDragStart={(e)=>onDragStartTask(e,t)} className={`p-2 pl-3 rounded border focus-within:outline focus-within:outline-2 focus-within:outline-blue-500 ${scheduledIdsThisWeek.has(t.id)?'border-emerald-700 bg-emerald-900/10':'border-[#1b2344]'}`} aria-grabbed="false" style={{ borderLeft: `3px solid ${colorForCourse(displayCourseFor(t))}` }}>
                <div className="text-sm text-slate-200 truncate">{displayCourseFor(t) ? `${displayCourseFor(t)}: ` : ''}{t.title}</div>
                <div className="text-xs text-slate-300/70 flex items-center gap-2 mt-1">
                  <span>due {ymdFromISO(t.dueDate)}</span>
                  {typeof t.priority==='number' ? <span>p{t.priority}</span> : null}
                  {typeof (t as any).pagesRead==='number' ? <span>{(t as any).pagesRead}p</span> : null}
                  {typeof t.estimatedMinutes==='number' && (t.estimatedMinutes ?? 0) > 0 ? <span>{minutesToHM(t.estimatedMinutes)}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showCatchup && catchupPreview && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={()=>{ setShowCatchup(false); setCatchupPreview(null); }} />
          <div className="relative z-10 max-w-3xl w-[92vw] bg-[#0b1020] border border-[#1b2344] rounded p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">Catch-Up Preview (next 14 days)</h4>
              <button onClick={()=>{ setShowCatchup(false); setCatchupPreview(null); }} className="text-xs px-2 py-1 rounded border border-[#1b2344]">Close</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto space-y-3">
              {(catchupPreview?.days || []).map(d => (
                <div key={d.day} className="border border-[#1b2344] rounded p-2">
                  <div className="text-xs text-slate-300/70 mb-1">{d.day} · {d.usedAfter}/{d.total}m (was {d.usedBefore}m)</div>
                  {d.items.length === 0 ? (
                    <div className="text-xs text-slate-300/50">No placements</div>
                  ) : (
                    <ul className="text-xs space-y-1">
                      {d.items.map((it, i) => (
                        <li key={i} className="flex items-center justify-between">
                          <div className="flex items-center min-w-0">
                            <span className="inline-block w-2 h-2 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: colorForCourse(it.course) }} />
                            <span className="truncate mr-2">{it.course ? `${it.course}: `: ''}{it.title}</span>
                          </div>
                          <span>{minutesToHM(it.minutes)}{it.guessed ? <span className="ml-1 inline-block px-1 rounded border border-amber-500 text-amber-400">guessed</span> : null}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {(catchupPreview?.unschedulable?.length || 0) > 0 && (
                <div className="border border-rose-700 rounded p-2">
                  <div className="text-xs text-rose-400 mb-1">Could not schedule (insufficient capacity before due date)</div>
                  <ul className="text-xs space-y-1">
                    {(catchupPreview?.unschedulable || []).map(u => (
                      <li key={u.taskId} className="flex items-center justify-between">
                        <span className="truncate mr-2">{u.title}</span>
                        <span>{u.remaining}m · due {u.dueYmd}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button onClick={()=>{ setShowCatchup(false); setCatchupPreview(null); }} className="px-3 py-2 rounded border border-[#1b2344] text-sm">Cancel</button>
              <button onClick={applyCatchUp} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm">Apply Catch-Up</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
