"use client";
import { useEffect, useMemo, useState } from "react";

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
  const [breaksByDow, setBreaksByDow] = useState<Record<number, Array<{ start?: string; end?: string }>>>({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] });
  const [windowsByDow, setWindowsByDow] = useState<Record<number, Array<{ start?: string; end?: string }>>>({ 0:[],1:[],2:[],3:[],4:[],5:[],6:[] });
  const [rowMenu, setRowMenu] = useState<{ kind: 'win'|'br'; dow: number; index: number } | null>(null);
  const [toolbarMenu, setToolbarMenu] = useState<{ dow: number } | null>(null);
  const [courses, setCourses] = useState<any[]>([]);
  const [twoWeeksOnly, setTwoWeeksOnly] = useState<boolean>(false);
  const [undoSnapshot, setUndoSnapshot] = useState<ScheduledBlock[] | null>(null);
  const [showCatchup, setShowCatchup] = useState(false);
  const [availStartByDow, setAvailStartByDow] = useState<Record<number, string>>({ 0:'',1:'',2:'',3:'',4:'',5:'',6:'' });
  const [availEndByDow, setAvailEndByDow] = useState<Record<number, string>>({ 0:'',1:'',2:'',3:'',4:'',5:'',6:'' });
  const [autoFromWindow, setAutoFromWindow] = useState<boolean>(true);
  const [settingsReady, setSettingsReady] = useState<boolean>(false);
  const [catchupPreview, setCatchupPreview] = useState<{
    days: Array<{ day: string; total: number; usedBefore: number; usedAfter: number; items: Array<{ taskId: string; title: string; course: string; minutes: number; guessed: boolean }> }>;
    unschedulable: Array<{ taskId: string; title: string; remaining: number; dueYmd: string }>;
  } | null>(null);

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
        if (startObj) setAvailStartByDow(startObj);
        if (endObj) setAvailEndByDow(endObj);
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
          if (typeof settings.weekPlanTwoWeeksOnly === 'boolean') setTwoWeeksOnly(settings.weekPlanTwoWeeksOnly as boolean);
          const wk = settings.weekPlanWeekStartYmd;
          if (typeof wk === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(wk)) {
            const [y,m,da] = wk.split('-').map(x=>parseInt(x,10));
            setWeekStart(saturdayOf(new Date(y,(m as number)-1,da)));
          }
          const sStart: any = (settings as any).availabilityStartHHMM;
          const sEnd: any = (settings as any).availabilityEndHHMM;
          const br = (settings as any).availabilityBreaksV1;
          // pick latest between local and remote if updatedAt present
          const readLocalJson = (key: string) => { try { if (typeof window!=='undefined') { const raw = window.localStorage.getItem(key); return raw?JSON.parse(raw):null; } } catch {} return null; };
          const localStart = readLocalJson(LS_AVAIL_START);
          const localEnd = readLocalJson(LS_AVAIL_END);
          const localBr = readLocalJson(LS_AVAIL_BREAKS);
          const ts = (o:any) => { try { return Date.parse(o?.updatedAt||''); } catch { return 0; } };
          const bestStart = (ts(localStart) > ts(sStart)) ? localStart : sStart;
          const bestEnd = (ts(localEnd) > ts(sEnd)) ? localEnd : sEnd;
          const bestBr = (ts(localBr) > ts(br)) ? localBr : br;
          if (bestStart && typeof bestStart === 'object') setAvailStartByDow(bestStart as Record<number,string>);
          else if (typeof bestStart === 'string') setAvailStartByDow({0:bestStart,1:bestStart,2:bestStart,3:bestStart,4:bestStart,5:bestStart,6:bestStart});
          if (bestEnd && typeof bestEnd === 'object') setAvailEndByDow(bestEnd as Record<number,string>);
          else if (typeof bestEnd === 'string') setAvailEndByDow({0:bestEnd,1:bestEnd,2:bestEnd,3:bestEnd,4:bestEnd,5:bestEnd,6:bestEnd});
          if (bestBr && typeof bestBr === 'object') setBreaksByDow(bestBr as Record<number, Array<{ start?: string; end?: string }>>);
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
  useEffect(() => { try { const nowIso=new Date().toISOString(); if (typeof window!=='undefined') window.localStorage.setItem(LS_AVAIL_START, JSON.stringify({ ...availStartByDow, updatedAt: nowIso })); if (settingsReady) void fetch('/api/settings', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ availabilityStartHHMM: { ...availStartByDow, updatedAt: nowIso } }) }); } catch {} }, [availStartByDow, settingsReady]);
  useEffect(() => { try { const nowIso=new Date().toISOString(); if (typeof window!=='undefined') window.localStorage.setItem(LS_AVAIL_END, JSON.stringify({ ...availEndByDow, updatedAt: nowIso })); if (settingsReady) void fetch('/api/settings', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ availabilityEndHHMM: { ...availEndByDow, updatedAt: nowIso } }) }); } catch {} }, [availEndByDow, settingsReady]);
  useEffect(() => { try { const nowIso=new Date().toISOString(); if (typeof window!=='undefined') window.localStorage.setItem(LS_AVAIL_BREAKS, JSON.stringify({ ...breaksByDow, updatedAt: nowIso })); if (settingsReady) void fetch('/api/settings', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ availabilityBreaksV1: { ...breaksByDow, updatedAt: nowIso } }) }); } catch {} }, [breaksByDow, settingsReady]);
  // Persist auto-from-window toggle
  useEffect(() => { try { if (typeof window!=='undefined') window.localStorage.setItem(LS_AVAIL_AUTO, autoFromWindow ? 'true':'false'); if (settingsReady) void fetch('/api/settings', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ availabilityAutoFromWindow: autoFromWindow }) }); } catch {} }, [autoFromWindow, settingsReady]);

  // Derive availability minutes from Windows minus Breaks (breaks clipped to windows)
  useEffect(() => {
    if (!autoFromWindow) return;
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
  }, [windowsByDow, breaksByDow, autoFromWindow]);

  // Helper: compute availability minutes for a DOW given candidate windows
  function computeAvailForWins(dow: number, winsArr: Array<{ start?: string; end?: string }>, brArr: Array<{ start?: string; end?: string }>): number {
    const winIntervals: Array<[number,number]> = (winsArr||[])
      .map(w => [toMin(normHHMM(w.start||''))??-1, toMin(normHHMM(w.end||''))??-1])
      .filter(([a,b]) => a>=0 && b>=0 && b>a) as Array<[number,number]>;
    winIntervals.sort((a,b)=>a[0]-b[0]);
    const mergedWins: Array<[number,number]> = [];
    for (const iv of winIntervals) { if (!mergedWins.length || iv[0] > mergedWins[mergedWins.length-1][1]) mergedWins.push([iv[0], iv[1]]); else mergedWins[mergedWins.length-1][1] = Math.max(mergedWins[mergedWins.length-1][1], iv[1]); }
    const brIntervals: Array<[number,number]> = (brArr||[])
      .map(b => [toMin(normHHMM(b.start||''))??-1, toMin(normHHMM(b.end||''))??-1])
      .filter(([a,b]) => a>=0 && b>=0 && b>a) as Array<[number,number]>;
    brIntervals.sort((a,b)=>a[0]-b[0]);
    const mergedBr: Array<[number,number]> = [];
    for (const iv of brIntervals) { if (!mergedBr.length || iv[0] > mergedBr[mergedBr.length-1][1]) mergedBr.push([iv[0], iv[1]]); else mergedBr[mergedBr.length-1][1] = Math.max(mergedBr[mergedBr.length-1][1], iv[1]); }
    let total = 0; for (const [ws,we] of mergedWins) { const base = Math.max(0, we - ws); let over = 0; for (const [bs,be] of mergedBr) { const sC = Math.max(ws, bs); const eC = Math.min(we, be); if (eC>sC) over += (eC - sC); } total += Math.max(0, base - over); }
    return total;
  }

  // Helper: date string (YYYY-MM-DD) for given DOW in current week
  function ymdForDow(dow: number): string {
    for (const d of days) if (d.getDay() === dow) return ymd(d);
    return ymd(days[0]);
  }

  // On first load, hydrate Windows from Start/End +/- Breaks (complement of breaks within [start,end])
  useEffect(() => {
    const empty = [0,1,2,3,4,5,6].every(d => ((windowsByDow[d]||[]).length===0));
    if (!empty) return;
    const out: Record<number, Array<{ start?: string; end?: string }>> = { 0:[],1:[],2:[],3:[],4:[],5:[],6:[] };
    for (const dow of [0,1,2,3,4,5,6]) {
      const s = toMin(normHHMM(availStartByDow[dow]||''));
      const e = toMin(normHHMM(availEndByDow[dow]||''));
      if (s==null || e==null || e<=s) { out[dow] = []; continue; }
      const brRaw = (breaksByDow[dow]||[]).map(b=>[toMin(normHHMM(b.start||''))??-1, toMin(normHHMM(b.end||''))??-1]).filter(([a,b])=>a>=0&&b>=0&&b>a).sort((a,b)=>a[0]-b[0]) as Array<[number,number]>;
      const mergedBr: Array<[number,number]> = [];
      for (const iv of brRaw) { if (!mergedBr.length || iv[0] > mergedBr[mergedBr.length-1][1]) mergedBr.push([iv[0], iv[1]]); else mergedBr[mergedBr.length-1][1] = Math.max(mergedBr[mergedBr.length-1][1], iv[1]); }
      const wins: Array<[number,number]> = [];
      let cur = s;
      for (const [bs,be] of mergedBr) { const ss = Math.max(cur, s); const ee = Math.min(e, bs); if (ee>ss) wins.push([ss, ee]); cur = Math.max(cur, be); }
      if (cur < e) wins.push([cur, e]);
      out[dow] = wins.map(([a,b]) => ({ id: uid(), start: fmt12Input(`${String(Math.floor(a/60)).padStart(2,'0')}:${String(a%60).padStart(2,'0')}`), end: fmt12Input(`${String(Math.floor(b/60)).padStart(2,'0')}:${String(b%60).padStart(2,'0')}`) } as any));
    }
    setWindowsByDow(out);
  }, [availStartByDow, availEndByDow, breaksByDow]);

  // When Windows or Breaks change, derive Start/End (earliest to latest) and merged Breaks (user + gaps) for persistence
  useEffect(() => {
    const sMap: Record<number,string> = {0:'',1:'',2:'',3:'',4:'',5:'',6:''};
    const eMap: Record<number,string> = {0:'',1:'',2:'',3:'',4:'',5:'',6:''};
    const brMap: Record<number, Array<{ start?: string; end?: string }>> = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]};
    for (const dow of [0,1,2,3,4,5,6]) {
      const winIv = (windowsByDow[dow]||[]).map(w=>[toMin(normHHMM(w.start||''))??-1, toMin(normHHMM(w.end||''))??-1]).filter(([a,b])=>a>=0&&b>=0&&b>a).sort((a,b)=>a[0]-b[0]) as Array<[number,number]>;
      let minS: number | null = null; let maxE: number | null = null;
      for (const [a,b] of winIv) { if (minS==null||a<minS) minS=a; if (maxE==null||b>maxE) maxE=b; }
      sMap[dow] = minS!=null ? fmt12Input(`${String(Math.floor(minS/60)).padStart(2,'0')}:${String(minS%60).padStart(2,'0')}`) : '';
      eMap[dow] = maxE!=null ? fmt12Input(`${String(Math.floor(maxE/60)).padStart(2,'0')}:${String(maxE%60).padStart(2,'0')}`) : '';
      // Gaps between windows inside [minS,maxE]
      const gaps: Array<[number,number]> = [];
      if (minS!=null && maxE!=null && maxE>minS) {
        let cur = minS;
        for (const [a,b] of winIv) { if (a>cur) gaps.push([cur,a]); cur = Math.max(cur, b); }
        if (cur<maxE) gaps.push([cur,maxE]);
      }
      const userBr = (breaksByDow[dow]||[]).map(b=>[toMin(normHHMM(b.start||''))??-1, toMin(normHHMM(b.end||''))??-1]).filter(([a,b])=>a>=0&&b>=0&&b>a) as Array<[number,number]>;
      const allBr = [...gaps, ...userBr].sort((a,b)=>a[0]-b[0]);
      const merged: Array<[number,number]> = [];
      for (const iv of allBr) { if (!merged.length || iv[0] > merged[merged.length-1][1]) merged.push([iv[0], iv[1]]); else merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], iv[1]); }
      brMap[dow] = merged.map(([a,b])=>({ start: fmt12Input(`${String(Math.floor(a/60)).padStart(2,'0')}:${String(a%60).padStart(2,'0')}`), end: fmt12Input(`${String(Math.floor(b/60)).padStart(2,'0')}:${String(b%60).padStart(2,'0')}`) }));
    }
    // Only update states if actually changed to avoid loops
    const eqObj = (a:any,b:any) => JSON.stringify(a)===JSON.stringify(b);
    if (!eqObj(sMap, availStartByDow)) setAvailStartByDow(sMap);
    if (!eqObj(eMap, availEndByDow)) setAvailEndByDow(eMap);
    if (!eqObj(brMap, breaksByDow)) setBreaksByDow(brMap);
  }, [windowsByDow]);

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
    try { if (typeof window!=='undefined') setTwoWeeksOnly((window.localStorage.getItem(LS_TWO_WEEKS)||'false')==='true'); } catch {}
  }, []);
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
    const m: Record<string, number> = {};
    for (const d of days) {
      const k = ymd(d); const dow = d.getDay();
      // Build merged windows and breaks
      const winIntervals: Array<[number,number]> = (windowsByDow[dow]||[])
        .map(w => [toMin(normHHMM(w.start||''))??-1, toMin(normHHMM(w.end||''))??-1])
        .filter(([a,b]) => a>=0 && b>=0 && b>a) as Array<[number,number]>;
      winIntervals.sort((a,b)=>a[0]-b[0]);
      const mergedWins: Array<[number,number]> = [];
      for (const iv of winIntervals) { if (!mergedWins.length || iv[0] > mergedWins[mergedWins.length-1][1]) mergedWins.push([iv[0], iv[1]]); else mergedWins[mergedWins.length-1][1] = Math.max(mergedWins[mergedWins.length-1][1], iv[1]); }
      const brIntervals: Array<[number,number]> = (breaksByDow[dow]||[])
        .map(b => [toMin(normHHMM(b.start||''))??-1, toMin(normHHMM(b.end||''))??-1])
        .filter(([a,b]) => a>=0 && b>=0 && b>a) as Array<[number,number]>;
      brIntervals.sort((a,b)=>a[0]-b[0]);
      const mergedBr: Array<[number,number]> = [];
      for (const iv of brIntervals) { if (!mergedBr.length || iv[0] > mergedBr[mergedBr.length-1][1]) mergedBr.push([iv[0], iv[1]]); else mergedBr[mergedBr.length-1][1] = Math.max(mergedBr[mergedBr.length-1][1], iv[1]); }
      const evIntervals: Array<[number,number]> = eventIntervalsByKey[k] || [];
      // Sum W − overlaps(B) − overlaps(E)
      let total = 0;
      if (mergedWins.length>0) {
        for (const [ws,we] of mergedWins) {
          const base = Math.max(0, we - ws);
          let overB = 0; for (const [bs,be] of mergedBr) { const sC = Math.max(ws, bs); const eC = Math.min(we, be); if (eC>sC) overB += (eC - sC); }
          let overE = 0; for (const [es,ee] of evIntervals) { const sC = Math.max(ws, es); const eC = Math.min(we, ee); if (eC>sC) overE += (eC - sC); }
          total += Math.max(0, base - overB - overE);
        }
        m[k] = Math.max(0, total);
      } else {
        // Fallback when no explicit windows: subtract total event minutes from availability
        const availMin = Math.max(0, Number(availability[dow]||0));
        const evMin = Math.max(0, eventMinutesByKey[k] || 0);
        m[k] = Math.max(0, availMin - evMin);
      }
    }
    return m;
  }, [days, windowsByDow, breaksByDow, availability, eventIntervalsByKey, eventMinutesByKey]);

  

  // Read-only events list by day (display only)
  const eventsByDay = useMemo(() => {
    const map: Record<string, Array<{ label: string; time?: string; color?: string; s?: number }>> = {};
    const keyOf = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    const fmt12 = (hhmm?: string | null) => {
      if (!hhmm || !/^(\d{2}):(\d{2})$/.test(hhmm)) return '';
      const [hStr, mStr] = hhmm.split(':'); const h = parseInt(hStr, 10);
      const ap = h >= 12 ? 'PM' : 'AM'; let h12 = h % 12; if (h12 === 0) h12 = 12; return `${h12}:${mStr} ${ap}`;
    };
    const fmt12Range = (s?: string|null, e?: string|null) => {
      const ss = fmt12(s||''); const ee = fmt12(e||'');
      if (!ss || !ee) return (ss||ee||'All day');
      const sm = /\s(AM|PM)$/i.exec(ss)?.[1] || '';
      const em = /\s(AM|PM)$/i.exec(ee)?.[1] || '';
      if (sm && em && sm===em) return `${ss.replace(/\s(AM|PM)$/i,'')}–${ee.replace(/\s(AM|PM)$/i,'')} ${sm}`;
      return `${ss}–${ee}`;
    };
    for (const d of days) map[ymd(d)] = [];
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
            const k = keyOf(d);
            const courseName = (c.title || c.code || '').toString();
            const sMin = toMin(sNorm||'');
            map[k].push({ label: courseName || 'Class', time: (sNorm && eNorm) ? fmt12Range(sNorm,eNorm) : 'All day', color: colorForCourse(courseName), s: (sMin ?? 24*60) });
          }
        }
      }
    }
    // No tasks in Events panel — strictly class/meeting blocks only
    // Sort by start minutes asc; all-day at end
    for (const k of Object.keys(map)) map[k].sort((a,b) => (Number(a.s||1e9) - Number(b.s||1e9)) || String(a.label).localeCompare(String(b.label)));
    return map;
  }, [courses, tasks, days]);


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
    const withoutThis = new Map<string, number>(Object.entries(plannedByDay));
    withoutThis.set(b.day, Math.max(0, (plannedByDay[b.day]||0) - b.plannedMinutes));
    for (let i=1;i<=tryDays;i++) {
      const d = new Date(base); d.setDate(d.getDate()+i);
      const k = ymd(d); const dow = d.getDay();
      const effCap = Math.max(0, Number(availability[dow] || 0));
      const planned = withoutThis.get(k) || 0;
      if (planned + b.plannedMinutes <= effCap) {
        setBlocks(prev => prev.map(x => x.id === b.id ? { ...x, day: k } : x));
        return;
      }
    }
  }

  // Weekly quota selectors (current week in Chicago time)
  const weekKeysCur = useMemo(() => weekKeysChicago(new Date()), []);
  const todayKeyCur = useMemo(() => chicagoYmd(new Date()), []);
  const todayIdxCur = useMemo(() => weekKeysCur.indexOf(todayKeyCur), [weekKeysCur, todayKeyCur]);
  const plannedByDayCur = useMemo(() => {
    const m: Record<string, number> = {}; for (const k of weekKeysCur) m[k] = 0;
    for (const b of blocks) if (m[b.day] !== undefined) m[b.day] += b.plannedMinutes;
    return m;
  }, [blocks, weekKeysCur]);
  const todayDowCur = useMemo(() => { const [y,m,da]=todayKeyCur.split('-').map(x=>parseInt(x,10)); return new Date(y,(m as number)-1,da).getDay(); }, [todayKeyCur]);
  const todayCapacityCur = useMemo(() => Math.max(0, Number(availability[todayDowCur]||0)), [availability, todayDowCur]);
  const remainingTodayCapacityCur = useMemo(() => Math.max(0, todayCapacityCur - (plannedByDayCur[todayKeyCur]||0)), [todayCapacityCur, plannedByDayCur, todayKeyCur]);
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
      for (const dk of horizonDays) { const [Y,M,D] = dk.split('-').map(x=>parseInt(x,10)); const dt = new Date(Y,(M as number)-1,D); totalCap[dk] = availability[dt.getDay()] ?? 0; }
      const usedBefore: Record<string, number> = {}; horizonDays.forEach(dk => usedBefore[dk] = 0);
      for (const b of blocks) if (usedBefore[b.day] !== undefined) usedBefore[b.day] += b.plannedMinutes;
      const capLeft: Record<string, number> = {}; horizonDays.forEach(dk => { capLeft[dk] = Math.max(0, (totalCap[dk]||0) - (usedBefore[dk]||0)); });

      const scheduledByTask = new Map<string, number>();
      for (const b of blocks) { if (b.taskId) scheduledByTask.set(b.taskId, (scheduledByTask.get(b.taskId)||0) + b.plannedMinutes); }

      const spill = (tasks||[]).filter(t => t && t.status==='todo').filter(t => { const dueY = ymdFromISO(t.dueDate); return (dueY < today || dueY <= horizonEnd); });
      const withRemaining = spill.map(t => {
        const est = Math.max(0, Math.round(Number(t.estimatedMinutes)||0));
        const estOrGuess = est > 0 ? est : 30;
        const already = scheduledByTask.get(t.id) || 0;
        const rem = Math.max(0, estOrGuess - already);
        return { task: t, remaining: rem, guessed: est === 0 };
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
          const row = proposed.find(r => r.day === dk)!; row.items.push({ taskId: t.id, title: t.title, course: t.course || '', minutes: chunk, guessed }); row.usedAfter += chunk; capLeft[dk] -= chunk; rem -= chunk;
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
    setUndoSnapshot(prev);
    setBlocks(prev => [...prev, ...additions]);
    setShowCatchup(false);
    setCatchupPreview(null);
  }

  function undoCatchUp() { if (!undoSnapshot) return; setBlocks(undoSnapshot); setUndoSnapshot(null); }

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

  function estimateMinutesForTask(t: Task): { minutes: number; guessed: boolean } {
    const est = Math.max(0, Math.round(Number(t.estimatedMinutes)||0));
    if (est > 0) return { minutes: est, guessed: false };
    const pages = Math.max(0, Number((t as any).pagesRead) || 0);
    if (pages > 0) {
      const mpp = getCourseMpp(t.course || '');
      return { minutes: Math.round(pages * mpp + 10), guessed: false };
    }
    return { minutes: 30, guessed: true };
  }
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
      setBlocks(prev => [...prev, block]);
      return;
    }
    // legacy: backlog id
    const it = backlog.find(x => x.id === id); if (!it) return;
    const { minutes, guessed } = estimateMinutesFor(it);
    const block: ScheduledBlock = { id: uid(), taskId: it.id, day: ymd(d), plannedMinutes: minutes, guessed, title: it.title, course: it.course, pages: it.pages ?? null, priority: it.priority ?? null };
    setBlocks(prev => [...prev, block]);
  }
  function removeBlock(id: string) { setBlocks(prev => prev.filter(b => b.id !== id)); }

  function autopackWeek() {
    const keys = new Set(days.map(d => ymd(d)));
    const existing = blocks.filter(b => keys.has(b.day));
    const planned = new Map<string, number>(); for (const d of days) planned.set(ymd(d), existing.filter(b => b.day===ymd(d)).reduce((s,b)=>s+b.plannedMinutes,0));
    const eff = (d: Date) => effectiveCapByKey[ymd(d)] ?? Math.min(availability[d.getDay()] ?? 0, (() => { const s=toMin(normHHMM(availStartByDow[d.getDay()]||''))??0; const e=toMin(normHHMM(availEndByDow[d.getDay()]||''))??1440; return Math.max(0,e-s); })());
    const unscheduled = unscheduledSorted.filter(t => !existing.some(b => b.taskId === t.id));
    const nextBlocks: ScheduledBlock[] = [];
    for (const t of unscheduled) {
      const { minutes, guessed } = estimateMinutesForTask(t);
      const dueY = chicagoYmd(new Date(t.dueDate));
      let placed = false;
      // try days up to and including due date
      for (const d of days) {
        const k = ymd(d);
        if (k > dueY) continue;
        const cap = eff(d); const cur = planned.get(k)!;
        if (cur + minutes <= cap) { nextBlocks.push({ id: uid(), taskId: t.id, day: k, plannedMinutes: minutes, guessed, title: t.title, course: t.course || '', pages: (typeof (t as any).pagesRead==='number' && (t as any).pagesRead>0)? (t as any).pagesRead : null, priority: t.priority ?? null }); planned.set(k, cur + minutes); placed = true; break; }
      }
      // if not placed before due date, choose best remaining before due date if any, else best overall
      if (!placed) {
        let bestDay: Date | null = null; let bestRem = -Infinity;
        for (const d of days) { const k = ymd(d); if (k > dueY) continue; const cap = eff(d); const cur = planned.get(k)!; const rem = cap - cur; if (rem > bestRem) { bestRem = rem; bestDay = d; } }
        if (bestDay) {
          const k = ymd(bestDay);
          nextBlocks.push({ id: uid(), taskId: t.id, day: k, plannedMinutes: minutes, guessed, title: t.title, course: t.course || '', pages: (typeof (t as any).pagesRead==='number' && (t as any).pagesRead>0)? (t as any).pagesRead : null, priority: t.priority ?? null });
          planned.set(k, planned.get(k)! + minutes);
          placed = true;
        }
      }
      // final fallback: any day in week with most remaining
      if (!placed) {
        let bestDay: Date | null = null; let bestRem = -Infinity;
        for (const d2 of days) { const k2 = ymd(d2); const cap2 = eff(d2); const cur2 = planned.get(k2)!; const rem2 = cap2 - cur2; if (rem2 > bestRem) { bestRem = rem2; bestDay = d2; } }
        if (bestDay) {
          const k2 = ymd(bestDay);
          nextBlocks.push({ id: uid(), taskId: t.id, day: k2, plannedMinutes: minutes, guessed, title: t.title, course: t.course || '', pages: (typeof (t as any).pagesRead==='number' && (t as any).pagesRead>0)? (t as any).pagesRead : null, priority: t.priority ?? null });
          planned.set(k2, planned.get(k2)! + minutes);
        }
      }
    }
    if (nextBlocks.length) setBlocks(prev => [...prev, ...nextBlocks]);
  }
function toMin(hhmm?: string | null): number | null { if (!hhmm) return null; const m=/^(\d{2}):(\d{2})$/.exec(hhmm); if(!m) return null; const h=parseInt(m[1],10), mi=parseInt(m[2],10); if(isNaN(h)||isNaN(mi)) return null; return h*60+mi; }
function minutesToHHMM(mins: number): string { const m = ((mins % 1440) + 1440) % 1440; const h = Math.floor(m/60); const mi = m % 60; return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`; }
function adjustTimeText(val: string, deltaMin: number): string {
  const n = toMin(normHHMM(val||'')); if (n==null) return val;
  const next = minutesToHHMM(n + deltaMin);
  return fmt12Input(next);
}
function parseAvailFlexible(input: string): number | null {
    const s = (input||'').trim().toLowerCase();
    if (!s) return null;
    const colon = /^(\d{1,3}):(\d{1,2})$/.exec(s);
    if (colon) { const h = parseInt(colon[1],10); const m = parseInt(colon[2],10); if (!isNaN(h) && !isNaN(m)) return Math.max(0, h*60 + m); }
    const space = /^(\d{1,3})\s+(\d{1,2})$/.exec(s);
    if (space) { const h = parseInt(space[1],10); const m = parseInt(space[2],10); if (!isNaN(h) && !isNaN(m)) return Math.max(0, h*60 + m); }
    const hr = /([0-9]+(?:\.[0-9]+)?)\s*h/.exec(s); const mr = /([0-9]+)\s*m(?![a-z])/i.exec(s);
    if (hr || mr) { let tot = 0; if (hr) { const h = parseFloat(hr[1]); if (!isNaN(h)) tot += Math.round(h*60); } if (mr) { const m = parseInt(mr[1],10); if (!isNaN(m)) tot += m; } return Math.max(0, tot); }
    const plain = parseFloat(s);
    if (!isNaN(plain)) {
      if (s.includes('.') || plain <= 10) {
        return Math.max(0, Math.round(plain * 60));
      }
      return Math.max(0, Math.round(plain));
    }
    return null;
  }
  function setAvailForDow(dow: number, val: string) {
    const parsed = parseAvailFlexible(val);
    const v = parsed == null ? 0 : parsed;
    setAvailability(prev => ({ ...prev, [dow]: v }));
  }
  function bumpAvail(dow: number, delta: number) {
    setAvailability(prev => ({ ...prev, [dow]: Math.max(0, Math.round((prev[dow]||0) + delta)) }));
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
              <input type="checkbox" checked={autoFromWindow} onChange={e=>setAutoFromWindow(e.target.checked)} /> Auto from Start/End
            </label>
          </div>
        </div>
        <div className="space-y-3">
          <div className="text-sm text-slate-300/70">Availability (windows − breaks) per weekday</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-3">
            {[6,0,1,2,3,4,5].map(dow => (
              <div key={dow} className="relative rounded-2xl p-5 md:p-6 border border-white/10 bg-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]}</div>
                  <div className="flex items-center gap-2 flex-nowrap">
                    <div className="text-xs text-slate-300/70">{minutesToHM(availability[dow] ?? 0)}</div>
                    <div className="block relative">
                      <button aria-label="Open day actions" onClick={()=>setToolbarMenu(m => (m && m.dow===dow)? null : { dow })} className="px-2 py-1 rounded border border-white/10 text-xs">…</button>
                      {toolbarMenu && toolbarMenu.dow===dow ? (
                        <div className="absolute right-0 mt-2 z-30 w-40 rounded border border-white/10 bg-[#0b1020] p-2 text-xs space-y-1 shadow-lg">
                          <button onClick={()=>{ setBreaksByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr.push({ id: uid(), start:'', end:'' } as any); return { ...prev, [dow]: arr }; }); setToolbarMenu(null); }} className="block w-full text-left px-2 py-1 rounded hover:bg-white/5">Add break</button>
                          <button onClick={()=>{ setWindowsByDow(prev=>{ const wins=(prev[dow]||[]).slice(); const out: Record<number, any[]> = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]}; for(const k of [1,2,3,4,5]) out[k]=wins.slice(); return { ...prev, ...out } as any; }); setBreaksByDow(prev=>{ const br=(prev[dow]||[]).slice(); const out: Record<number, any[]> = {0:(prev[0]||[]),1:[],2:[],3:[],4:[],5:[],6:(prev[6]||[])}; for(const k of [1,2,3,4,5]) out[k]=br.slice(); return out as any; }); setToolbarMenu(null); }} className="block w-full text-left px-2 py-1 rounded hover:bg-white/5">Copy to weekdays</button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/70 mb-1">Windows</div>
                  <div className="space-y-2">
                    {(windowsByDow[dow]||[]).map((w, i) => { const sOk = toMin(normHHMM(w.start||''))!=null; const eOk = toMin(normHHMM(w.end||''))!=null; const valid = (toMin(normHHMM(w.start||''))??0) < (toMin(normHHMM(w.end||''))??0); const keyId = (w as any).id || `w-${i}`; return (
                      <div key={keyId} className="relative grid grid-cols-[1fr_1fr_auto] items-center gap-3">
                        <input type="text" placeholder="7:00 AM" value={fmt12Input(w.start||'')} onChange={e=>setWindowsByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr[i]={...arr[i], start:e.target.value}; return { ...prev, [dow]: arr }; })} className={`h-9 px-3 text-sm rounded-lg bg-white/10 border ${valid && sOk? 'border-white/10':'border-rose-600'} focus-visible:ring-2 focus-visible:ring-emerald-400`} />
                        <input type="text" placeholder="5:00 PM" value={fmt12Input(w.end||'')} onChange={e=>setWindowsByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr[i]={...arr[i], end:e.target.value}; return { ...prev, [dow]: arr }; })} className={`h-9 px-3 text-sm rounded-lg bg-white/10 border ${valid && eOk? 'border-white/10':'border-rose-600'} focus-visible:ring-2 focus-visible:ring-emerald-400`} />
                        <div className="relative">
                          <button aria-label="Row menu" onClick={()=>setRowMenu(m => m && m.kind==='win' && m.dow===dow && m.index===i ? null : { kind:'win', dow, index:i })} className="px-2 py-1 rounded border border-white/10 text-xs">…</button>
                          {rowMenu && rowMenu.kind==='win' && rowMenu.dow===dow && rowMenu.index===i ? (
                            <div className="absolute right-0 mt-2 z-10 rounded border border-white/10 bg-[#0b1020] p-2 text-xs space-y-1">
                              <button onClick={()=>{ setWindowsByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr[i]={...arr[i], start: adjustTimeText(arr[i].start||'', -15), end: adjustTimeText(arr[i].end||'', -15)}; return { ...prev, [dow]: arr }; }); setRowMenu(null); }} className="block px-2 py-1 rounded hover:bg-white/5">−15</button>
                              <button onClick={()=>{ setWindowsByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr[i]={...arr[i], start: adjustTimeText(arr[i].start||'', 15), end: adjustTimeText(arr[i].end||'', 15)}; return { ...prev, [dow]: arr }; }); setRowMenu(null); }} className="block px-2 py-1 rounded hover:bg-white/5">+15</button>
                              <button onClick={()=>{ setWindowsByDow(prev=>{ const arr=(prev[dow]||[]).slice(); const copy = { ...arr[i], id: uid() } as any; arr.splice(i+1,0,copy); return { ...prev, [dow]: arr }; }); setRowMenu(null); }} className="block px-2 py-1 rounded hover:bg-white/5">Duplicate</button>
                              <button onClick={()=>{ setWindowsByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr.splice(i,1); return { ...prev, [dow]: arr }; }); setRowMenu(null); }} className="block px-2 py-1 rounded hover:bg-white/5">Delete</button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );})}
                    {(() => { const hasInvalid = (windowsByDow[dow]||[]).some(w => { const s=toMin(normHHMM(w.start||'')); const e=toMin(normHHMM(w.end||'')); return !(s!=null && e!=null && e>s); }); return (
                      <div>
                        <button onClick={()=>setWindowsByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr.push({ id: uid(), start:'', end:'' } as any); return { ...prev, [dow]: arr }; })} className="mt-1 px-2 py-1 rounded border border-white/10 text-xs disabled:opacity-50" disabled={hasInvalid}>+ Add window</button>
                      </div>
                    ); })()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/70 mb-1">Breaks</div>
                  <div className="space-y-2">
                    {(breaksByDow[dow]||[]).map((br, i) => { const valid = (toMin(normHHMM(br.start||''))??0) < (toMin(normHHMM(br.end||''))??0); const keyId=(br as any).id || `b-${i}`; return (
                      <div key={keyId} className="relative grid grid-cols-[1fr_1fr_auto] items-center gap-3">
                        <input type="text" placeholder="2:15 PM" value={fmt12Input(br.start||'')} onChange={e=>setBreaksByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr[i]={...arr[i], start:e.target.value}; return { ...prev, [dow]: arr }; })} className={`h-9 px-3 text-sm rounded-lg bg-white/10 border ${valid? 'border-white/10':'border-rose-600'} focus-visible:ring-2 focus-visible:ring-emerald-400`} />
                        <input type="text" placeholder="2:45 PM" value={fmt12Input(br.end||'')} onChange={e=>setBreaksByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr[i]={...arr[i], end:e.target.value}; return { ...prev, [dow]: arr }; })} className={`h-9 px-3 text-sm rounded-lg bg-white/10 border ${valid? 'border-white/10':'border-rose-600'} focus-visible:ring-2 focus-visible:ring-emerald-400`} />
                        <div className="relative">
                          <button aria-label="Row menu" onClick={()=>setRowMenu(m => m && m.kind==='br' && m.dow===dow && m.index===i ? null : { kind:'br', dow, index:i })} className="px-2 py-1 rounded border border-white/10 text-xs">…</button>
                          {rowMenu && rowMenu.kind==='br' && rowMenu.dow===dow && rowMenu.index===i ? (
                            <div className="absolute right-0 mt-2 z-10 rounded border border-white/10 bg-[#0b1020] p-2 text-xs space-y-1">
                              <button onClick={()=>{ setBreaksByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr[i]={...arr[i], start: adjustTimeText(arr[i].start||'', -15), end: adjustTimeText(arr[i].end||'', -15)}; return { ...prev, [dow]: arr }; }); setRowMenu(null); }} className="block px-2 py-1 rounded hover:bg-white/5">−15</button>
                              <button onClick={()=>{ setBreaksByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr[i]={...arr[i], start: adjustTimeText(arr[i].start||'', 15), end: adjustTimeText(arr[i].end||'', 15)}; return { ...prev, [dow]: arr }; }); setRowMenu(null); }} className="block px-2 py-1 rounded hover:bg-white/5">+15</button>
                              <button onClick={()=>{ setBreaksByDow(prev=>{ const arr=(prev[dow]||[]).slice(); const copy = { ...arr[i], id: uid() } as any; arr.splice(i+1,0,copy); return { ...prev, [dow]: arr }; }); setRowMenu(null); }} className="block px-2 py-1 rounded hover:bg-white/5">Duplicate</button>
                              <button onClick={()=>{ setBreaksByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr.splice(i,1); return { ...prev, [dow]: arr }; }); setRowMenu(null); }} className="block px-2 py-1 rounded hover:bg-white/5">Delete</button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );})}
                    <div>
                      <button onClick={()=>setBreaksByDow(prev=>{ const arr=(prev[dow]||[]).slice(); arr.push({ id: uid(), start:'', end:'' } as any); return { ...prev, [dow]: arr }; })} className="mt-1 px-2 py-1 rounded border border-white/10 text-xs">+ Add break</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
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
                  </div>
                </div>
                <div className="h-2 w-full bg-[#0b1020] border border-[#1b2344] rounded overflow-hidden mb-2" role="progressbar" aria-valuemin={0} aria-valuemax={cap||0} aria-valuenow={planned} aria-label="Planned minutes">
                  <div className={`${overBy>0?'bg-rose-600':'bg-emerald-600'}`} style={{ width: `${pct}%`, height: '100%' }} />
                </div>
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
                  ) : dayBlocks.map(b => (
                    <li key={b.id} className="text-[11px] flex items-start gap-2">
                      <span className="mt-1 w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colorForCourse(b.course) }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-200 truncate">{b.course ? `${b.course}: ` : ''}{b.title}</div>
                        <div className="text-slate-300/70 flex items-center gap-2">
                          <span>{minutesToHM(b.plannedMinutes)}{b.guessed ? <span className="ml-1 inline-block px-1 rounded border border-amber-500 text-amber-400">guessed</span> : null}{typeof b.pages==='number' && b.pages>0 ? <span className="ml-2">· {b.pages}p</span> : null}</span>
                          
                          <span className="inline-flex items-center gap-1">
                            <button onClick={()=>moveBlockLaterToday(b)} className="px-1 py-0.5 rounded border border-[#1b2344]">Move later today</button>
                            <button onClick={()=>pushBlockToTomorrow(b)} className="px-1 py-0.5 rounded border border-[#1b2344]">Push → tomorrow</button>
                          </span>
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
