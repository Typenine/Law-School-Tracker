"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";

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

type TimeRange = { id: string; start: string; end: string };
type AvailabilitySummary = ReturnType<typeof summarizeAvailability>;

const DOW_SEQUENCE: number[] = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun
const DOW_LABEL_LONG: Record<number, string> = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
const DOW_LABEL_SHORT: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
const TIME_OPTIONS_15: number[] = Array.from({ length: 96 }, (_, i) => i * 15);

function toMin(hhmm?: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(mi)) return null;
  return h * 60 + mi;
}

function minutesToHHMM(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(min)));
  const h = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function emptyRangeRecord(): Record<number, TimeRange[]> {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

function normalizeRangeList(input: any): TimeRange[] {
  if (!Array.isArray(input)) return [];
  return input.map((item: any) => {
    const start = typeof item?.start === 'string' ? (normHHMM(item.start) || '') : '';
    const end = typeof item?.end === 'string' ? (normHHMM(item.end) || '') : '';
    const id = typeof item?.id === 'string' ? item.id : uid();
    return { id, start, end };
  });
}

function rangesToSerializable(map: Record<number, TimeRange[]>): Record<number, Array<{ id: string; start: string; end: string }>> {
  const out: Record<number, Array<{ id: string; start: string; end: string }>> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const dow of Object.keys(out)) {
    const num = Number(dow);
    out[num] = (map[num] || []).map(r => ({ id: r.id, start: r.start, end: r.end }));
  }
  return out;
}

function clampRangeToWindow(range: [number, number], windows: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [ws, we] of windows) {
    const s = Math.max(ws, range[0]);
    const e = Math.min(we, range[1]);
    if (e > s) out.push([s, e]);
  }
  return out;
}

function summarizeAvailability(windows: TimeRange[], breaks: TimeRange[]) {
  const winIntervals: Array<[number, number]> = windows.map(w => [toMin(w.start) ?? -1, toMin(w.end) ?? -1]).filter(([a,b]) => a>=0 && b>=0 && b>a) as Array<[number, number]>;
  const breakIntervals: Array<[number, number]> = breaks.map(b => [toMin(b.start) ?? -1, toMin(b.end) ?? -1]).filter(([a,b]) => a>=0 && b>=0 && b>a) as Array<[number, number]>;
  const mergedWindows: Array<[number, number]> = [];
  winIntervals.sort((a,b)=>a[0]-b[0]);
  for (const iv of winIntervals) {
    if (!mergedWindows.length || iv[0] > mergedWindows[mergedWindows.length-1][1]) mergedWindows.push([...iv]);
    else mergedWindows[mergedWindows.length-1][1] = Math.max(mergedWindows[mergedWindows.length-1][1], iv[1]);
  }
  const totalWindows = mergedWindows.reduce((sum,[s,e])=>sum + Math.max(0,e-s), 0);
  let breakOverlap = 0;
  for (const raw of breakIntervals) {
    const clipped = clampRangeToWindow(raw, mergedWindows);
    for (const [s,e] of clipped) breakOverlap += Math.max(0,e-s);
  }
  return {
    totalMinutes: Math.max(0, totalWindows - breakOverlap),
    windows: mergedWindows,
    breaks: breakIntervals,
  };
}

function describeRange(range: TimeRange): { start: string; end: string; valid: boolean } {
  const s = normHHMM(range.start);
  const e = normHHMM(range.end);
  if (!s || !e) return { start: range.start, end: range.end, valid: false };
  return { start: s, end: e, valid: toMin(s) != null && toMin(e) != null && toMin(e)!>toMin(s)! };
}


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

// Minimal Task shape for catch-up
type Task = {
  id: string;
  title: string;
  course?: string | null;
  dueDate: string; // ISO
  status: "todo" | "done";
  estimatedMinutes?: number | null;
  priority?: number | null;
  activity?: string | null;
  tags?: string[] | null;
};

const LS_BACKLOG = "backlogItemsV1";
const LS_AVAIL = "availabilityTemplateV1";
const LS_SCHEDULE = "weekScheduleV1";
const LS_GOALS = "weeklyGoalsV1";
const LS_SHOW_CONFLICTS = "weekPlanShowConflicts";
const LS_WEEK_START = "weekPlanWeekStartYmd";
const LS_TWO_WEEKS = "weekPlanTwoWeeksOnly";
const LS_AVAIL_START = "availabilityStartHHMM";
const LS_AVAIL_END = "availabilityEndHHMM";
const LS_AVAIL_BREAKS = "availabilityBreaksV1";
const LS_AVAIL_AUTO = "availabilityAutoFromWindow";

type WeeklyGoal = { id: string; scope: 'global'|'course'; weeklyMinutes: number; course?: string | null };

function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function loadGoals(): WeeklyGoal[] { if (typeof window==='undefined') return []; try { const raw=window.localStorage.getItem(LS_GOALS); const arr=raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; } catch { return []; } }
function chicagoYmd(d: Date): string { const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }); const parts = f.formatToParts(d); const y=parts.find(p=>p.type==='year')?.value||'0000'; const m=parts.find(p=>p.type==='month')?.value||'01'; const da=parts.find(p=>p.type==='day')?.value||'01'; return `${y}-${m}-${da}`; }
function mondayOfChicago(d: Date): Date { const ymd = chicagoYmd(d); const [yy,mm,dd]=ymd.split('-').map(x=>parseInt(x,10)); const local = new Date(yy,(mm as number)-1,dd); const dow = local.getDay(); const delta = (dow + 1) % 7; local.setDate(local.getDate()-delta); return local; }
function weekKeysChicago(d: Date): string[] { const start = mondayOfChicago(d); return Array.from({length:7},(_,i)=>{const x=new Date(start); x.setDate(x.getDate()+i); return chicagoYmd(x);}); }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function saturdayOf(d: Date) { const x = startOfDay(d); const dow = x.getDay(); const delta = (dow - 6 + 7) % 7; x.setDate(x.getDate() - delta); return x; }
function ymd(d: Date) { return chicagoYmd(d); }
function dayLabel(d: Date) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
function endOfDayIso(ymdStr: string) { const [y,m,da]=ymdStr.split('-').map(n=>parseInt(n,10)); const x=new Date(y,(m as number)-1,da,23,59,59,999); return x.toISOString(); }
function minutesPerPage(): number { if (typeof window==='undefined') return 3; const s=window.localStorage.getItem('minutesPerPage'); const n=s?parseFloat(s):NaN; return !isNaN(n)&&n>0?n:3; }
function normHHMM(s?: string | null): string | null {
  const raw = (s || '').trim().toLowerCase();
  if (!raw) return null;

  let body = raw;
  let mer: 'am' | 'pm' | null = null;

  const merMatch = /(am?|pm?)$/.exec(body.replace(/\s+/g, ''));
  if (merMatch) {
    mer = merMatch[0].startsWith('a') ? 'am' : 'pm';
    body = body.slice(0, body.length - merMatch[0].length);
  }

  body = body.replace(/\s+/g, '');
  if (!body) body = '0';

  let hours = 0;
  let minutes = 0;

  if (body.includes(':')) {
    const parts = body.split(':');
    if (parts.length !== 2) return null;
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10);
  } else {
    const digits = body.replace(/[^0-9]/g, '');
    if (!digits) return null;
    if (digits.length <= 2) {
      hours = parseInt(digits, 10);
      minutes = 0;
    } else if (digits.length === 3) {
      hours = parseInt(digits.slice(0, 1), 10);
      minutes = parseInt(digits.slice(1), 10);
    } else {
      hours = parseInt(digits.slice(0, digits.length - 2), 10);
      minutes = parseInt(digits.slice(-2), 10);
    }
  }

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (minutes < 0 || minutes > 59) return null;

  if (mer) {
    if (hours < 1 || hours > 12) return null;
    let hh = hours % 12;
    if (mer === 'pm') hh += 12;
    hours = hh;
  } else if (hours < 0 || hours > 23) {
    return null;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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

// Learned MPP support (local-only): courseMppMap in localStorage
type CourseMppEntry = { mpp: number; sample?: number; updatedAt?: string; overrideEnabled?: boolean; overrideMpp?: number | null };
function baseMpp(): number { if (typeof window==='undefined') return 2; const s = window.localStorage.getItem('minutesPerPage'); const n = s ? parseFloat(s) : NaN; return (!isNaN(n) && n>0) ? n : 2; }
function getCourseMpp(course?: string | null): number {
  const fallback = baseMpp();
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem('courseMppMap') || '{}';
    const map = JSON.parse(raw) as Record<string, CourseMppEntry>;
    const key = (course || '').toString().trim().toLowerCase();
    const entry = map[key];
    if (!entry || typeof entry.mpp !== 'number' || entry.mpp <= 0) return fallback;
    if (entry.overrideEnabled && typeof entry.overrideMpp === 'number' && entry.overrideMpp > 0) {
      return Math.max(0.5, Math.min(6, entry.overrideMpp));
    }
    return Math.max(0.5, Math.min(6, entry.mpp));
  } catch { return fallback; }
}

function hueFromString(s: string): number { let h = 0; for (let i=0;i<s.length;i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h % 360; }
function courseColor(c?: string | null): string { const key = (c||'').trim().toLowerCase(); if (!key) return 'hsl(215 16% 47%)'; const h = hueFromString(key); return `hsl(${h} 70% 55%)`; }
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
function saveSchedule(blocks: ScheduledBlock[]) { if (typeof window!=='undefined') window.localStorage.setItem(LS_SCHEDULE, JSON.stringify(blocks)); }

function estimateMinutesFor(item: BacklogItem): { minutes: number; guessed: boolean } {
  // 1) Explicit estimate wins
  if (typeof item.estimatedMinutes === 'number' && item.estimatedMinutes > 0) return { minutes: item.estimatedMinutes, guessed: false };
  // 2) Pages-based with learned MPP preferred, +10m overhead
  if (typeof item.pages === 'number' && item.pages > 0) {
    const mpp = getCourseMpp(item.course);
    const est = Math.round(item.pages * mpp + 10);
    return { minutes: est, guessed: false };
  }
  // 3) Fallback default
  return { minutes: 30, guessed: true };
}

export default function WeekPlanPage() {
  const [sortBy, setSortBy] = useState<'due'|'course'|'priority'|'estimate'>('due');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');
  const [weekStart, setWeekStart] = useState<Date>(() => {
    if (typeof window === 'undefined') return saturdayOf(new Date());
    try {
      const s = window.localStorage.getItem(LS_WEEK_START);
      if (s) {
        const [y,m,da] = s.split('-').map(x=>parseInt(x,10));
        const dt = new Date(y,(m as number)-1,da);
        return saturdayOf(dt);
      }
    } catch {}
    return saturdayOf(new Date());
  });
  const [availability, setAvailability] = useState<AvailabilityTemplate>({ 0:120,1:240,2:240,3:240,4:240,5:240,6:120 });
  const [blocks, setBlocks] = useState<ScheduledBlock[]>([]);
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [goals, setGoals] = useState<WeeklyGoal[]>([]);
  const [windowsByDow, setWindowsByDow] = useState<Record<number, TimeRange[]>>(emptyRangeRecord());
  const [breaksByDow, setBreaksByDow] = useState<Record<number, TimeRange[]>>(emptyRangeRecord());
  const [courses, setCourses] = useState<any[]>([]);
  const [showConflicts, setShowConflicts] = useState<boolean>(true);
  const [twoWeeksOnly, setTwoWeeksOnly] = useState<boolean>(false);
  const [undoSnapshot, setUndoSnapshot] = useState<ScheduledBlock[] | null>(null);
  const [showCatchup, setShowCatchup] = useState(false);
  const [autoFromWindow, setAutoFromWindow] = useState<boolean>(true);
  const [settingsReady, setSettingsReady] = useState<boolean>(false);
  const [catchupPreview, setCatchupPreview] = useState<{
    days: Array<{ day: string; total: number; usedBefore: number; usedAfter: number; items: Array<{ taskId: string; title: string; course: string; minutes: number; guessed: boolean }> }>;
    unschedulable: Array<{ taskId: string; title: string; remaining: number; dueYmd: string }>;
  } | null>(null);

  const windowSummaryByDow = useMemo<Record<number, AvailabilitySummary>>(() => {
    const map: Record<number, AvailabilitySummary> = { 0: summarizeAvailability(windowsByDow[0] || [], breaksByDow[0] || []), 1: summarizeAvailability(windowsByDow[1] || [], breaksByDow[1] || []), 2: summarizeAvailability(windowsByDow[2] || [], breaksByDow[2] || []), 3: summarizeAvailability(windowsByDow[3] || [], breaksByDow[3] || []), 4: summarizeAvailability(windowsByDow[4] || [], breaksByDow[4] || []), 5: summarizeAvailability(windowsByDow[5] || [], breaksByDow[5] || []), 6: summarizeAvailability(windowsByDow[6] || [], breaksByDow[6] || []), };
    return map;
  }, [windowsByDow, breaksByDow]);

  // Initial load: local first for instant UI, then server, and migrate if server empty
  useEffect(() => {
    setAvailability(loadAvailability());
    setBlocks(loadSchedule());
    setBacklog(loadBacklog());
    try {
      if (typeof window!=='undefined') {
        const s = window.localStorage.getItem(LS_AVAIL_START)||'';
        const e = window.localStorage.getItem(LS_AVAIL_END)||'';
        let startObj: Record<number,string> | null = null;
        let endObj: Record<number,string> | null = null;
        try { const js = JSON.parse(s); if (js && typeof js==='object') startObj = js; } catch {}
        try { const je = JSON.parse(e); if (je && typeof je==='object') endObj = je; } catch {}
        if (!startObj && s) startObj = {0:s,1:s,2:s,3:s,4:s,5:s,6:s};
        if (!endObj && e) endObj = {0:e,1:e,2:e,3:e,4:e,5:e,6:e};
        if (startObj || endObj) {
          setWindowsByDow(prev => {
            const next = emptyRangeRecord();
            for (const dow of DOW_SEQUENCE) {
              const start = startObj ? normHHMM(startObj[dow]) : null;
              const end = endObj ? normHHMM(endObj[dow]) : null;
              if (start && end) next[dow] = [{ id: uid(), start, end }];
            }
            return next;
          });
        }
        try { const auto = window.localStorage.getItem(LS_AVAIL_AUTO); if (auto != null) setAutoFromWindow(auto === 'true'); } catch {}
      }
    } catch {}
    let canceled = false;
    let settingsCache: Record<string, any> = {};
    (async () => {
      try {
        const [schRes, setRes] = await Promise.all([
          fetch('/api/schedule', { cache: 'no-store' }),
          fetch('/api/settings?keys=availabilityTemplateV1,weeklyGoalsV1,weekPlanShowConflicts,weekPlanWeekStartYmd,weekPlanTwoWeeksOnly,internshipColor,sportsLawReviewColor,availabilityStartHHMM,availabilityEndHHMM,availabilityBreaksV1,weekScheduleV1,availabilityAutoFromWindow', { cache: 'no-store' })
        ]);
        if (canceled) return;
        if (setRes.ok) {
          const sj = await setRes.json().catch(() => ({ settings: {} }));
          const settings = (sj?.settings || {}) as Record<string, any>;
          settingsCache = settings;
          if (settings.availabilityTemplateV1 && typeof settings.availabilityTemplateV1 === 'object') {
            setAvailability(settings.availabilityTemplateV1 as any);
          }
          if (Array.isArray(settings.weeklyGoalsV1)) setGoals(settings.weeklyGoalsV1 as any[]);
          if (typeof settings.weekPlanShowConflicts === 'boolean') setShowConflicts(settings.weekPlanShowConflicts as boolean);
          if (typeof settings.weekPlanTwoWeeksOnly === 'boolean') setTwoWeeksOnly(settings.weekPlanTwoWeeksOnly as boolean);
          const wk = settings.weekPlanWeekStartYmd;
          if (typeof wk === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(wk)) {
            const [y,m,da] = wk.split('-').map(x=>parseInt(x,10));
            setWeekStart(saturdayOf(new Date(y,(m as number)-1,da)));
          }
          const sStart: any = (settings as any).availabilityStartHHMM;
          const sEnd: any = (settings as any).availabilityEndHHMM;
          if (sStart || sEnd) {
            setWindowsByDow(prev => {
              const next = emptyRangeRecord();
              for (const dow of DOW_SEQUENCE) {
                const start = sStart && typeof sStart === 'object' ? normHHMM(sStart[dow]) : (typeof sStart === 'string' ? normHHMM(sStart) : null);
                const end = sEnd && typeof sEnd === 'object' ? normHHMM(sEnd[dow]) : (typeof sEnd === 'string' ? normHHMM(sEnd) : null);
                if (start && end) next[dow] = [{ id: uid(), start, end }];
              }
              return next;
            });
          }
          const br = (settings as any).availabilityBreaksV1;
          if (br && typeof br === 'object') {
            setBreaksByDow(prev => {
              const next = emptyRangeRecord();
              for (const dow of DOW_SEQUENCE) next[dow] = normalizeRangeList((br as any)[dow] || []);
              return next;
            });
          }
          if (typeof (settings as any).availabilityAutoFromWindow === 'boolean') setAutoFromWindow((settings as any).availabilityAutoFromWindow as boolean);
          setSettingsReady(true);
        }
        if (schRes.ok) {
          const bj = await schRes.json().catch(() => ({ blocks: [] }));
          const remote = Array.isArray(bj?.blocks) ? bj.blocks : [];
          const local = loadSchedule();
          if (remote.length > 0) {
            setBlocks(remote as any);
          } else {
            // Try settings backup, then localStorage
            const fromSettings = (settingsCache as any)?.weekScheduleV1;
            if (Array.isArray(fromSettings) && fromSettings.length > 0) {
              setBlocks(fromSettings as any);
              try { await fetch('/api/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: fromSettings }) }); } catch {}
            } else if (local.length > 0) {
              try { await fetch('/api/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: local }) }); } catch {}
            }
          }
        }
      } catch {}
    })();
    return () => { canceled = true; };
  }, []);
  // Persist changes locally and to server
  useEffect(() => { saveAvailability(availability); }, [availability]);
  useEffect(() => { saveSchedule(blocks); }, [blocks]);
  // Debounced server save for blocks (persist API + settings backup)
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        void fetch('/api/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks }) });
        void fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekScheduleV1: blocks }) });
      } catch {}
    }, 400);
    return () => clearTimeout(id);
  }, [blocks]);
  useEffect(() => { try { if (typeof window !== 'undefined') window.localStorage.setItem(LS_WEEK_START, ymd(weekStart)); } catch {} try { void fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekPlanWeekStartYmd: ymd(weekStart) }) }); } catch {} }, [weekStart]);
  useEffect(() => { try { void fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ availabilityTemplateV1: availability }) }); } catch {} }, [availability]);
  useEffect(() => { try { void fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weeklyGoalsV1: goals }) }); } catch {} }, [goals]);
  useEffect(() => {
    const payload = rangesToSerializable(windowsByDow);
    try {
      if (typeof window!=='undefined') {
        window.localStorage.setItem(LS_AVAIL_START, JSON.stringify(Object.fromEntries(DOW_SEQUENCE.map(d => [d, payload[d]?.[0]?.start || '']))));
        window.localStorage.setItem(LS_AVAIL_END, JSON.stringify(Object.fromEntries(DOW_SEQUENCE.map(d => [d, payload[d]?.[0]?.end || '']))));
      }
      if (settingsReady) {
        void fetch('/api/settings', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ availabilityStartHHMM: Object.fromEntries(DOW_SEQUENCE.map(d => [d, payload[d]?.[0]?.start || ''])), availabilityEndHHMM: Object.fromEntries(DOW_SEQUENCE.map(d => [d, payload[d]?.[0]?.end || ''])) }) });
      }
    } catch {}
  }, [windowsByDow, settingsReady]);
  useEffect(() => {
    const serialized = rangesToSerializable(breaksByDow);
    try {
      if (typeof window!=='undefined') window.localStorage.setItem(LS_AVAIL_BREAKS, JSON.stringify(serialized));
      if (settingsReady) void fetch('/api/settings', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ availabilityBreaksV1: serialized }) });
    } catch {}
  }, [breaksByDow, settingsReady]);
  // Persist auto-from-window toggle
  useEffect(() => { try { if (typeof window!=='undefined') window.localStorage.setItem(LS_AVAIL_AUTO, autoFromWindow ? 'true':'false'); if (settingsReady) void fetch('/api/settings', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ availabilityAutoFromWindow: autoFromWindow }) }); } catch {} }, [autoFromWindow, settingsReady]);

  // Auto derive availability minutes from Start/End minus breaks
  useEffect(() => {
    if (!autoFromWindow) return;
    setAvailability(prev => {
      const next: Record<number, number> = { ...prev } as any;
      let changed = false;
      for (const dow of DOW_SEQUENCE) {
        const total = windowSummaryByDow[dow]?.totalMinutes ?? 0;
        if ((next as any)[dow] !== total) {
          (next as any)[dow] = total;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [windowSummaryByDow, autoFromWindow]);

  // Fetch tasks for Catch-Up
  useEffect(() => {
    (async () => {
      try { const r = await fetch('/api/tasks', { cache: 'no-store' }); const d = await r.json(); setTasks((d.tasks || []) as Task[]); } catch {}
    })();
  }, []);
  // Load goals & sessions for weekly quota
  useEffect(() => { setGoals(loadGoals()); }, []);
  useEffect(() => {
    (async () => { try { const r = await fetch('/api/sessions', { cache: 'no-store' }); const d = await r.json(); setSessions(Array.isArray(d?.sessions)?d.sessions:[]); } catch {} })();
  }, []);
  // Load courses for class times and initial toggles
  useEffect(() => {
    (async () => { try { const r = await fetch('/api/courses', { cache: 'no-store' }); const d = await r.json(); setCourses(Array.isArray(d?.courses)?d.courses:[]); } catch {} })();
    try { if (typeof window!=='undefined') setShowConflicts((window.localStorage.getItem(LS_SHOW_CONFLICTS)||'true')==='true'); } catch {}
    try { if (typeof window!=='undefined') setTwoWeeksOnly((window.localStorage.getItem(LS_TWO_WEEKS)||'false')==='true'); } catch {}
  }, []);
  useEffect(() => { if (typeof window!=='undefined') window.localStorage.setItem(LS_SHOW_CONFLICTS, showConflicts ? 'true':'false'); try { void fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekPlanShowConflicts: showConflicts }) }); } catch {} }, [showConflicts]);
  useEffect(() => { if (typeof window!=='undefined') window.localStorage.setItem(LS_TWO_WEEKS, twoWeeksOnly ? 'true':'false'); try { void fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekPlanTwoWeeksOnly: twoWeeksOnly }) }); } catch {} }, [twoWeeksOnly]);

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
      return map[k] || courseColor(raw || '');
    };
  }, [courses]);

  const plannedByDay = useMemo(() => {
    const m: Record<string, number> = {}; for (const d of days) m[ymd(d)] = 0;
    for (const b of blocks) if (m[b.day] !== undefined) m[b.day] += b.plannedMinutes;
    return m;
  }, [blocks, days]);

  // Build busy minutes and overlappers per day from classes and timed events
  const busyByDay = useMemo(() => {
    const map: Record<string, number> = {};
    const items: Record<string, Array<{ label: string; time?: string; sMin?: number; eMin?: number; color?: string }>> = {};
    const keyOf = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    const fmt12 = (hhmm?: string | null) => {
      if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
      const [hStr, mStr] = hhmm.split(':'); const h = parseInt(hStr, 10); const m = parseInt(mStr, 10);
      const h12 = ((h + 11) % 12) + 1; const ampm = h < 12 ? 'AM' : 'PM';
      return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
    };
    const toMinLocal = (hhmm?: string | null) => { return toMin(hhmm); };
    // init keys
    for (const d of days) { const k = keyOf(d); map[k] = 0; items[k] = []; }
    // Classes
    for (const c of (courses||[])) {
      const start = c.startDate ? new Date(c.startDate) : null;
      const end = c.endDate ? new Date(c.endDate) : null;
      const blocksArr = (Array.isArray(c.meetingBlocks) && c.meetingBlocks.length)
        ? c.meetingBlocks
        : ((Array.isArray(c.meetingDays) && c.meetingStart && c.meetingEnd) ? [{ days: c.meetingDays, start: c.meetingStart, end: c.meetingEnd, location: c.room || c.location || null }] : []);
      if (!Array.isArray(blocksArr) || !blocksArr.length) continue;
      for (const d of days) {
        const within = (!start || d >= start) && (!end || d <= end);
        if (!within) continue;
        for (const b of blocksArr) {
          if (!Array.isArray(b.days)) continue;
          if (b.days.includes(d.getDay())) {
            const sNorm = normHHMM((b as any).start);
            const eNorm = normHHMM((b as any).end);
            const sMin = toMinLocal(sNorm); const eMin = toMinLocal(eNorm);
            const dur = (sMin!=null && eMin!=null && eMin>sMin) ? (eMin - sMin) : 0;
            const k = keyOf(d);
            map[k] += dur;
            const courseName = (c.title || c.code || '').toString();
            items[k].push({ label: courseName || 'Class', time: ((b as any).start && (b as any).end) ? `${fmt12(sNorm||'')}–${fmt12(eNorm||'')}` : undefined, sMin: sMin==null?undefined:sMin, eMin: eMin==null?undefined:eMin, color: colorForCourse(courseName) });
          }
        }
      }
    }
    // Timed events from tasks (start/end on dueDate day)
    for (const t of (tasks||[])) {
      const k = keyOf(new Date(t.dueDate));
      if (!(k in map)) continue;
      const sNorm = normHHMM((t as any).startTime);
      const eNorm = normHHMM((t as any).endTime);
      const sMin = toMinLocal(sNorm); const eMin = toMinLocal(eNorm);
      const dur = (sMin!=null && eMin!=null && eMin>sMin) ? (eMin - sMin) : 0;
      if (dur > 0) {
        map[k] += dur;
        const courseName = (t.course || '').toString();
        items[k].push({ label: t.title, time: (sNorm && eNorm) ? `${fmt12(sNorm)}–${fmt12(eNorm)}` : undefined, sMin: sMin==null?undefined:sMin, eMin: eMin==null?undefined:eMin, color: colorForCourse(courseName) });
      }
    }
    // Finals (calendar-only)
    const finals: Array<{ iso: string; title: string }> = [
      { iso: '2025-12-12T09:00:00-06:00', title: 'Final — Amateur Sports Law' },
      { iso: '2025-12-17T09:00:00-06:00', title: 'Final — Intellectual Property' },
    ];
    for (const f of finals) {
      const k = f.iso.slice(0,10);
      if (k in map) {
        const s = toMinLocal('09:00'); const e = s!=null ? s+180 : null;
        map[k] += 180;
        items[k].push({ label: f.title, time: `${fmt12('09:00')}–${fmt12('12:00')}`, sMin: s==null?undefined:s, eMin: e==null?undefined:e!, color: colorForCourse(f.title.replace(/^Final —\s*/,'').trim()) });
      }
    }
    // Sort events by start time (sMin) ascending
    for (const k of Object.keys(items)) {
      items[k].sort((a,b) => {
        const sa = (a.sMin ?? 1e9); const sb = (b.sMin ?? 1e9);
        if (sa !== sb) return sa - sb;
        return (a.label||'').localeCompare(b.label||'');
      });
    }
    return { minutes: map, items };
  }, [courses, tasks, days]);

  const effectiveCapByKey = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of days) {
      const k = ymd(d);
      const summary = windowSummaryByDow[d.getDay()] || summarizeAvailability([], []);
      const windows = summary.windows;
      let busyOverlap = 0;
      for (const ev of (busyByDay.items[k] || [])) {
        const evStart = (ev as any).sMin ?? null;
        const evEnd = (ev as any).eMin ?? null;
        if (evStart == null || evEnd == null) continue;
        for (const [ws,we] of windows) busyOverlap += overlap(ws, we, evStart, evEnd);
      }
      const cap = Math.max(0, summary.totalMinutes - busyOverlap);
      const req = availability[d.getDay()] || 0;
      m[k] = Math.min(req, cap);
    }
    return m;
  }, [days, availability, windowSummaryByDow, busyByDay]);

  function dayHasConflict(k: string, dow: number): boolean {
    if (!showConflicts) return false;
    const capEff = effectiveCapByKey[k] || 0;
    const plan = plannedByDay[k] || 0;
    return plan > capEff;
  }

  function moveBlockLaterToday(b: ScheduledBlock) {
    // Just reorder to end if same-day slack allows (cap - busy - others >= minutes); else no-op
    const k = b.day;
    const effCap = effectiveCapByKey[k] || 0;
    const others = (plannedByDay[k] || 0) - b.plannedMinutes;
    const slack = effCap - others;
    if (slack < b.plannedMinutes) return; // insufficient space today
    setBlocks(prev => {
      const sameDay = prev.filter(x => x.day === k && x.id !== b.id);
      const otherDays = prev.filter(x => x.day !== k);
      return [...otherDays, ...sameDay, b];
    });
  }

  function pushBlockToTomorrow(b: ScheduledBlock) {
    const tryDays = 21; // look ahead up to 3 weeks
    const base = new Date(`${b.day}T12:00:00`);
    setBlocks(prev => {
      const remaining = prev.filter(x => x.id !== b.id);
      let targetDay = '';

      for (let i = 1; i <= tryDays; i++) {
        const candidate = new Date(base);
        candidate.setDate(candidate.getDate() + i);
        const candKey = ymd(candidate);
        const alreadyPlanned = remaining.reduce((sum, block) => block.day === candKey ? sum + block.plannedMinutes : sum, 0);
        const cap = availability[candidate.getDay()] ?? 0;
        if (cap === 0) continue;
        if (alreadyPlanned + b.plannedMinutes <= cap) {
          targetDay = candKey;
          break;
        }
      }

      if (!targetDay) {
        const next = new Date(base);
        next.setDate(next.getDate() + 1);
        targetDay = ymd(next);
      }

      return [...remaining, { ...b, day: targetDay }];
    });
  }

  function addBreakRow(dow: number) {
    setBreaksByDow(prev => ({ ...prev, [dow]: [...(prev[dow]||[]), { id: uid(), start: '12:00', end: '12:30' }] }));
  }

  function updateWindow(dow: number, id: string, patch: Partial<TimeRange>) {
    setWindowsByDow(prev => {
      const arr = prev[dow] || [];
      const next = arr.map(row => {
        if (row.id !== id) return row;
        const start = patch.start ? normHHMM(patch.start) || row.start : row.start;
        const end = patch.end ? normHHMM(patch.end) || row.end : row.end;
        return { ...row, start, end };
      });
      return { ...prev, [dow]: next };
    });
  }

  function updateBreak(dow: number, id: string, patch: Partial<TimeRange>) {
    setBreaksByDow(prev => {
      const arr = prev[dow] || [];
      const next = arr.map(row => {
        if (row.id !== id) return row;
        const start = patch.start ? normHHMM(patch.start) || row.start : row.start;
        const end = patch.end ? normHHMM(patch.end) || row.end : row.end;
        return { ...row, start, end };
      });
      return { ...prev, [dow]: next };
    });
  }

  function removeWindow(dow: number, id: string) {
    setWindowsByDow(prev => ({ ...prev, [dow]: (prev[dow] || []).filter(r => r.id !== id) }));
  }

  function removeBreak(dow: number, id: string) {
    setBreaksByDow(prev => ({ ...prev, [dow]: (prev[dow] || []).filter(r => r.id !== id) }));
  }

  function duplicateWindow(dow: number, id: string) {
    setWindowsByDow(prev => {
      const arr = prev[dow] || [];
      const idx = arr.findIndex(r => r.id === id);
      if (idx === -1) return prev;
      const row = arr[idx];
      const start = row.start;
      const end = row.end;
      const copy = { id: uid(), start, end };
      const next = arr.slice(); next.splice(idx + 1, 0, copy);
      return { ...prev, [dow]: next };
    });
  }

  function duplicateBreak(dow: number, id: string) {
    setBreaksByDow(prev => {
      const arr = prev[dow] || [];
      const idx = arr.findIndex(r => r.id === id);
      if (idx === -1) return prev;
      const row = arr[idx];
      const copy = { id: uid(), start: row.start, end: row.end };
      const next = arr.slice(); next.splice(idx + 1, 0, copy);
      return { ...prev, [dow]: next };
    });
  }

  function shiftRange(range: TimeRange, deltaMinutes: number): TimeRange {
    const startMin = Math.max(0, Math.min(24*60, (toMin(range.start) ?? 0) + deltaMinutes));
    const endMin = Math.max(0, Math.min(24*60, (toMin(range.end) ?? 0) + deltaMinutes));
    if (endMin <= startMin) return range;
    return { ...range, start: minutesToHHMM(startMin), end: minutesToHHMM(endMin) };
  }

  function nudgeWindow(dow: number, id: string, deltaMinutes: number) {
    setWindowsByDow(prev => {
      const arr = prev[dow] || [];
      const next = arr.map(r => r.id === id ? shiftRange(r, deltaMinutes) : r);
      return { ...prev, [dow]: next };
    });
  }

  function nudgeBreak(dow: number, id: string, deltaMinutes: number) {
    setBreaksByDow(prev => {
      const arr = prev[dow] || [];
      const next = arr.map(r => r.id === id ? shiftRange(r, deltaMinutes) : r);
      return { ...prev, [dow]: next };
    });
  }

  function copyToWeekdays(sourceDow: number) {
    const windowsSrc = (windowsByDow[sourceDow] || []).map(r => ({ id: uid(), start: r.start, end: r.end }));
    const breaksSrc = (breaksByDow[sourceDow] || []).map(r => ({ id: uid(), start: r.start, end: r.end }));
    setWindowsByDow(prev => {
      const next = { ...prev };
      for (const dow of [1,2,3,4,5]) next[dow] = windowsSrc.map(r => ({ ...r, id: uid() }));
      return next;
    });
    setBreaksByDow(prev => {
      const next = { ...prev };
      for (const dow of [1,2,3,4,5]) next[dow] = breaksSrc.map(r => ({ ...r, id: uid() }));
      return next;
    });
  }
  function shiftWeek(delta: number) { setWeekStart(prev => { const x = new Date(prev); x.setDate(x.getDate() + delta*7); return saturdayOf(x); }); }
  function clearThisWeek() { const keys = new Set(days.map(d => ymd(d))); setBlocks(prev => prev.filter(b => !keys.has(b.day))); }
  async function promoteWeekToTasks() {
    const keys = new Set(days.map(d => ymd(d))); const batch = blocks.filter(b => keys.has(b.day)); let ok = 0, fail = 0;
    for (const b of batch) {
      const body: any = { title: b.title, course: b.course || null, dueDate: endOfDayIso(b.day), status: 'todo', estimatedMinutes: b.plannedMinutes, priority: b.priority ?? null, tags: ['week-plan'] };
      try { const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (res.ok) ok++; else fail++; } catch { fail++; }
    }
    if (typeof window !== 'undefined') window.alert(`Promoted ${ok} task(s)${fail?`, ${fail} failed`:''}`);
  }

  const noTasksToPlan = unscheduledSorted.length === 0;

  return (
    <main className="flex flex-col space-y-6">
      <section className="card p-6 space-y-4 order-1">
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
            <button onClick={undoCatchUp} className="px-3 py-2 rounded border border-[#1b2344] text-sm disabled:opacity-50" disabled={!undoSnapshot}>Undo Last</button>
            <div className="text-xs text-slate-300/80 ml-2">Need ~{minutesToHM(dailyQuotaCur)}/day to hit goal · <button onClick={autopackWeek} className="underline">Autopack</button></div>
            <label className="ml-2 inline-flex items-center gap-1 text-xs">
              <input type="checkbox" checked={showConflicts} onChange={e=>setShowConflicts(e.target.checked)} /> Show conflicts
            </label>
            <label className="ml-2 inline-flex items-center gap-1 text-xs">
              <input type="checkbox" checked={autoFromWindow} onChange={e=>setAutoFromWindow(e.target.checked)} /> Auto from Start/End
            </label>
          </div>
        </div>
        <div className="space-y-3">
          <div className="text-sm text-slate-300/70">Availability (windows and breaks)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[1.7fr_1fr] gap-4 xl:max-w-[1600px] mx-auto px-0">
            {DOW_SEQUENCE.map(dow => {
              const summary = summarizeAvailability(windowsByDow[dow] || [], breaksByDow[dow] || []);
              const windows = windowsByDow[dow] || [];
              const breaks = breaksByDow[dow] || [];
              const totalLabel = minutesToHM(summary.totalMinutes);
              return (
                <article key={dow} className="rounded-2xl p-5 md:p-6 shadow-sm border border-white/10 bg-white/5 space-y-3">
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold">{DOW_LABEL_LONG[dow]}</div>
                      <div className="text-xs text-white/60">Availability {totalLabel}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/80">
                      <button onClick={() => addWindowRow(dow)} className="h-9 px-3 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20">Add window</button>
                      <button onClick={() => addBreakRow(dow)} className="h-9 px-3 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20">Add break</button>
                      <button onClick={() => copyToWeekdays(dow)} className="h-9 px-3 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20">Copy to weekdays</button>
                    </div>
                  </header>
                  <section className="space-y-2">
                    <div className="text-xs text-white/60">Windows</div>
                    {windows.length === 0 ? (
                      <div className="text-xs text-white/40">No windows yet. Add one to begin.</div>
                    ) : windows.map((row) => {
                      const parsed = describeRange(row);
                      const invalid = !parsed.valid;
                      return (
                        <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-3">
                          <TimeField value={row.start} onChange={(v)=>updateWindow(dow, row.id, { start: v })} invalid={invalid} />
                          <TimeField value={row.end} onChange={(v)=>updateWindow(dow, row.id, { end: v })} invalid={invalid} />
                          <RowActions onNudge={(delta)=>nudgeWindow(dow, row.id, delta)} onDuplicate={()=>duplicateWindow(dow, row.id)} onDelete={()=>removeWindow(dow, row.id)} />
                          {invalid ? <div className="col-span-3 text-[11px] text-rose-400">Start must be before end.</div> : null}
                        </div>
                      );
                    })}
                  </section>
                  <section className="space-y-2">
                    <div className="text-xs text-white/60">Breaks</div>
                    {breaks.length === 0 ? (
                      <div className="text-xs text-white/40">No breaks entered.</div>
                    ) : breaks.map((row) => {
                      const parsed = describeRange(row);
                      const invalid = !parsed.valid;
                      return (
                        <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-3">
                          <TimeField value={row.start} onChange={(v)=>updateBreak(dow, row.id, { start: v })} invalid={invalid} subtle />
                          <TimeField value={row.end} onChange={(v)=>updateBreak(dow, row.id, { end: v })} invalid={invalid} subtle />
                          <RowActions onNudge={(delta)=>nudgeBreak(dow, row.id, delta)} onDuplicate={()=>duplicateBreak(dow, row.id)} onDelete={()=>removeBreak(dow, row.id)} subtle />
                          {invalid ? <div className="col-span-3 text-[11px] text-rose-400">Start must be before end.</div> : null}
                        </div>
                      );
                    })}
                  </section>
                </article>
              );
            })}
          </div>
        </div>
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
        {noTasksToPlan ? (
          <div className="rounded border border-dashed border-[#1b2344] p-4 text-sm text-slate-300/80">No todo tasks to plan. Add some in <a href="/tasks" className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Tasks</a> and return.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {unscheduledSorted.map(t => (
              <div key={t.id} draggable onDragStart={(e)=>onDragStartTask(e,t)} className={`p-2 pl-3 rounded border focus-within:outline focus-within:outline-2 focus-within:outline-blue-500 ${scheduledIdsThisWeek.has(t.id)?'border-emerald-700 bg-emerald-900/10':'border-[#1b2344]'}`} aria-grabbed="false" style={{ borderLeft: `3px solid ${colorForCourse(displayCourseFor(t))}` }}>
                <div className="text-sm text-slate-200 truncate">{displayCourseFor(t) ? `${displayCourseFor(t)}: ` : ''}{t.title}</div>
                <div className="text-xs text-slate-300/70 flex items-center gap-2 mt-1">
                  <span>due {ymdFromISO(t.dueDate)}</span>
                  {typeof t.priority==='number' ? <span>p{t.priority}</span> : null}
                  {typeof (t as any).pagesRead==='number' ? <span>{(t as any).pagesRead}p</span> : null}
                  {typeof t.estimatedMinutes==='number' && (t.estimatedMinutes ?? 0) > 0 ? <span>{t.estimatedMinutes}m</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 order-2">
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {days.map((d) => {
            const k = ymd(d);
            const planned = plannedByDay[k] || 0;
            const cap = effectiveCapByKey[k] ?? (availability[d.getDay()] ?? 0);
            const overBy = Math.max(0, planned - cap);
            const pct = cap>0 ? Math.min(100, Math.round((planned/cap)*100)) : (planned>0?100:0);
            const dayBlocks = blocks.filter(b => b.day === k);
            return (
              <div key={k} className={`rounded border ${overBy>0?'border-rose-600':'border-[#1b2344]'} p-3 min-h-[220px]`} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>onDropDay(e,d)} role="listbox" aria-label={`Planned items for ${dayLabel(d)}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-slate-200">{dayLabel(d)}</div>
                  <div className="text-xs text-slate-300/70 flex items-center gap-2">
                    <span>{minutesToHM(planned)} / {minutesToHM(cap)}</span>
                    {dayHasConflict(k, d.getDay()) && (
                      <span className="px-1 py-0.5 rounded border border-rose-600 text-rose-400" title={(busyByDay.items[k]||[]).map(x=>`${x.label}${x.time?` · ${x.time}`:''}`).join('\n')}>conflict</span>
                    )}
                  </div>
                </div>
                <div className="h-2 w-full bg-[#0b1020] border border-[#1b2344] rounded overflow-hidden mb-2" role="progressbar" aria-valuemin={0} aria-valuemax={cap||0} aria-valuenow={planned} aria-label="Planned minutes">
                  <div className={`${overBy>0?'bg-rose-600':'bg-emerald-600'}`} style={{ width: `${pct}%`, height: '100%' }} />
                </div>
                {overBy>0 ? <div className="text-[11px] text-rose-400 mb-2">Over by {minutesToHM(overBy)}</div> : null}
                <div className="mb-2">
                  <div className="text-xs text-slate-300/70 mb-1">Events</div>
                  {(() => { const evs = (busyByDay.items[k] || []); return evs.length===0 ? (
                    <div className="text-[11px] text-slate-300/50">—</div>
                  ) : (
                    <ul className="text-[11px] space-y-1">
                      {evs.map((ev, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: ev.color || 'hsl(215 16% 70%)' }} />
                          <span className="text-slate-200 break-words whitespace-pre-wrap">{ev.label}</span>
                          {ev.time ? <span className="text-slate-300/70">· {ev.time}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ); })()}
                </div>
                <div className="text-xs text-slate-300/70 mb-1">Planned</div>
                <ul className="space-y-1">
                  {dayBlocks.length===0 ? (
                    <li className="text-[11px] text-slate-300/50">Drop tasks here</li>
                  ) : dayBlocks.map(b => (
                    <li key={b.id} className="text-[11px] flex items-start gap-2">
                      <span className="mt-1 w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colorForCourse(b.course) }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-200 truncate">{b.course ? `${b.course}: ` : ''}{b.title}</div>
                        <div className="text-slate-300/70 flex items-center gap-2">
                          <span>{minutesToHM(b.plannedMinutes)}{b.guessed ? <span className="ml-1 inline-block px-1 rounded border border-amber-500 text-amber-400">guessed</span> : null}{typeof b.pages==='number' && b.pages>0 ? <span className="ml-2">· {b.pages}p</span> : null}</span>
                          {dayHasConflict(k, d.getDay()) && showConflicts && (
                            <span className="inline-flex items-center gap-1">
                              <span className="px-1 rounded border border-rose-600 text-rose-400" title={(busyByDay.items[k]||[]).map(x=>`${x.label}${x.time?` · ${x.time}`:''}`).join('\n')}>conflict</span>
                              <button onClick={()=>moveBlockLaterToday(b)} className="px-1 py-0.5 rounded border border-[#1b2344]">Move later today</button>
                              <button onClick={()=>pushBlockToTomorrow(b)} className="px-1 py-0.5 rounded border border-[#1b2344]">Push → tomorrow</button>
                            </span>
                          )}
                        </div>
                      </div>
                      <button aria-label="Remove block" onClick={()=>removeBlock(b.id)} className="px-1 py-0.5 rounded border border-[#1b2344] text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">X</button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
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
        {noTasksToPlan ? (
          <div className="rounded border border-dashed border-[#1b2344] p-4 text-sm text-slate-300/80">No todo tasks to plan. Add some in <a href="/tasks" className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Tasks</a> and return.</div>
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
