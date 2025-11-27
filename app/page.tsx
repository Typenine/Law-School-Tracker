"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTasks } from "@/lib/useTasks";
import { estimateMinutesForTask } from "@/lib/taskEstimate";

type BacklogItem = {
  id: string;
  title: string;
  course: string;
  dueDate?: string | null; // YYYY-MM-DD
  pages?: number | null;
  estimatedMinutes?: number | null;
  priority?: number | null;
  tags?: string[] | null;
};

type ScheduledBlock = {
  id: string;
  taskId: string; // BacklogItem.id
  day: string; // YYYY-MM-DD
  plannedMinutes: number;
  guessed?: boolean;
  title: string;
  course: string;
  pages?: number | null;
  priority?: number | null;
};

type TodayPlanItem = { id: string; title: string; course: string; minutes: number; guessed?: boolean };
type TodayPlan = { dateKey: string; locked: boolean; lockedAt?: string; items: TodayPlanItem[] };

type WeeklyGoal = { id: string; scope: 'global'|'course'; weeklyMinutes: number; course?: string | null };
type AvailabilityTemplate = Record<number, number>; // 0..6 => minutes

const LS_SCHEDULE = "weekScheduleV1";
const LS_BACKLOG = "backlogItemsV1";
const LS_AVAIL = "availabilityTemplateV1";
const LS_TODAY = "todayPlanV1";
const LS_GOALS = "weeklyGoalsV1";
const LS_ORIG_RANGES = "readOrigRangesMapV1";

function minutesPerPage(): number { if (typeof window==='undefined') return 3; const s=window.localStorage.getItem('minutesPerPage'); const n=s?parseFloat(s):NaN; return !isNaN(n)&&n>0?n:3; }
// Count pages from title ranges like "p. 449–486, 505–520"
function countPagesFromTitle(title: string): number {
  const s = (title || '').trim();
  const m = s.match(/p(?:ages?)?\.?\s*([0-9,\s–-]+(?:\s*,\s*[0-9–-]+)*)/i);
  if (!m) return 0;
  const cleaned = (m[1] || '').replace(/–/g,'-').replace(/\s+/g,'');
  const parts = cleaned.split(',').map(p=>p.trim()).filter(Boolean);
  let pages = 0;
  for (const p of parts) {
    const mm = /^(\d+)(?:-(\d+))?$/.exec(p);
    if (!mm) continue;
    const a = parseInt(mm[1],10); const b = mm[2]? parseInt(mm[2],10): a;
    if (!isNaN(a) && !isNaN(b) && b >= a) pages += (b - a + 1);
  }
  return pages;
}
function minutesPerPageForCourse(course?: string | null): number {
  try {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem('courseMppMap');
      const obj = raw ? JSON.parse(raw) : null;
      const key = (course || '').toString().trim().toLowerCase();
      const v = key && obj && obj[key] && typeof obj[key].mpp === 'number' ? obj[key].mpp : null;
      if (typeof v === 'number' && v > 0) return Math.max(0.5, Math.min(6.0, v));
    }
  } catch {}
  return minutesPerPage();
}

function ymdAddDays(ymd: string, delta: number): string {
  const [y,m,d] = ymd.split('-').map(x=>parseInt(x,10));
  const dt = new Date(y,(m as number)-1,d); dt.setDate(dt.getDate()+delta);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
// Use shared helper for estimate calculations
function estimateMinutes(it: BacklogItem): { minutes: number; guessed: boolean } {
  return estimateMinutesForTask(it);
}

function chicagoYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function mondayOfChicago(d: Date): Date { const ymd = chicagoYmd(d); const [yy,mm,dd]=ymd.split('-').map(x=>parseInt(x,10)); const local = new Date(yy,(mm as number)-1,dd); const dow = local.getDay(); const delta = (dow + 1) % 7; local.setDate(local.getDate()-delta); return local; }
function weekKeysChicago(d: Date): string[] { const monday = mondayOfChicago(d); return Array.from({length:7},(_,i)=>{const x=new Date(monday); x.setDate(x.getDate()+i); return chicagoYmd(x);}); }
function minutesStr(mins: number): string { const h=Math.floor(mins/60), m=mins%60; return `${h>0?`${h}h `:''}${m}m`.trim(); }
function minutesToHM(min: number | null | undefined): string { const n=Math.max(0,Math.round(Number(min)||0)); const h=Math.floor(n/60); const m=n%60; return `${h}:${String(m).padStart(2,'0')}`; }
function hueFromString(s: string): number { let h=0; for (let i=0;i<s.length;i++){ h=(h*31 + s.charCodeAt(i))>>>0; } return h%360; }
function courseColor(name?: string | null): string { const key=(name||'').toString().trim().toLowerCase(); if(!key) return 'hsl(215 16% 47%)'; const h=hueFromString(key); return `hsl(${h} 70% 55%)`; }

function mmss(sec: number): string {
  const n = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
// Extract page ranges from a title like "p. 449–486, 505–520"
function extractPageRanges(title: string): string[] {
  try {
    const m = title.match(/p(?:ages?)?\.?\s*([0-9,\s–:\-]+(?:\s*,\s*[0-9–:\-]+)*)/i);
    if (!m) return [];
    const raw = m[1] || '';
    return raw.split(/\s*,\s*/).map(x => x.replace(/[:\-]/g, '–').trim()).filter(x => /\d/.test(x));
  } catch { return []; }
}

// Flexible duration parser: accepts "H:MM", "2h 5m", "135", "1.5h" etc.
function parseMinutesFlexible(input: string): number | null {
  const s = (input||'').toString().trim().toLowerCase();
  if (!s) return null;
  const hm = /^(\d{1,3}):(\d{1,2})$/.exec(s);
  if (hm) { const h=parseInt(hm[1],10), m=parseInt(hm[2],10); if(!isNaN(h)&&!isNaN(m)) return Math.max(0, h*60 + m); }
  const hr = /([0-9]+(?:\.[0-9]+)?)\s*h/.exec(s); const mr = /([0-9]+)\s*m(?![a-z])/i.exec(s);
  if (hr || mr) { let tot=0; if (hr){ const h=parseFloat(hr[1]); if(!isNaN(h)) tot+=Math.round(h*60);} if(mr){ const m=parseInt(mr[1],10); if(!isNaN(m)) tot+=m; } return Math.max(0,tot); }
  const plain = parseFloat(s);
  if (!isNaN(plain)) { if (s.includes('.') || plain <= 10) return Math.max(0, Math.round(plain*60)); return Math.max(0, Math.round(plain)); }
  return null;
}

// Page range helpers
type Interval = [number, number]; // inclusive
function parseIntervalsFromRangeString(ranges: string): Interval[] {
  const cleaned = (ranges||'').replace(/p(?:ages?)?\.?/ig,'').replace(/[–:]/g,'-').replace(/\s+/g,'').trim();
  if (!cleaned) return [];
  const parts = cleaned.split(',').map(p=>p.trim()).filter(Boolean);
  const out: Interval[] = [];
  for (const p of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p);
    if (!m) continue; const a=parseInt(m[1],10); const b = m[2] ? parseInt(m[2],10) : a;
    if (!isNaN(a) && !isNaN(b) && b>=a) out.push([a,b]);
  }
  return mergeIntervals(out);
}
function mergeIntervals(arr: Interval[]): Interval[] {
  const a = arr.slice().sort((x,y)=>x[0]-y[0]); if (!a.length) return [];
  const out: Interval[] = [a[0].slice() as Interval];
  for (let i=1;i<a.length;i++) { const [s,e]=a[i]; const last = out[out.length-1]; if (s<=last[1]+1) last[1] = Math.max(last[1], e); else out.push([s,e]); }
  return out;
}
function pagesInIntervals(arr: Interval[]): number { return arr.reduce((sum,[a,b])=>sum+Math.max(0,b-a+1),0); }
function unionIntervals(a: Interval[], b: Interval[]): Interval[] { return mergeIntervals([...a, ...b]); }
function subtractIntervals(base: Interval[], cover: Interval[]): Interval[] {
  if (!base.length) return [];
  if (!cover.length) return mergeIntervals(base);
  const covered = mergeIntervals(cover);
  const res: Interval[] = [];
  for (const [s,e] of mergeIntervals(base)) {
    let curS = s; let curE = e;
    for (const [cs,ce] of covered) {
      if (ce < curS || cs > curE) continue; // no overlap
      if (cs <= curS && ce >= curE) { curS = curE+1; break; }
      if (cs <= curS) { curS = ce+1; continue; }
      if (ce >= curE) { res.push([curS, cs-1]); curS = curE+1; break; }
      res.push([curS, cs-1]); curS = ce+1;
    }
    if (curS <= curE) res.push([curS, curE]);
  }
  return res;
}

// Label intervals: "p. a–b, c–d, e"
function intervalsToLabel(arr: Interval[]): string {
  if (!arr.length) return '';
  return 'p. ' + arr.map(([a,b]) => (a===b ? String(a) : `${a}–${b}`)).join(', ');
}

// Subtract a raw page count from the start of intervals
function subtractCountFromFront(base: Interval[], count: number): Interval[] {
  if (count <= 0) return mergeIntervals(base);
  const arr = mergeIntervals(base).slice();
  let n = count;
  const out: Interval[] = [];
  for (const [s,e] of arr) {
    const len = Math.max(0, e - s + 1);
    if (n >= len) { n -= len; continue; }
    const newStart = s + n; out.push([newStart, e]); n = 0;
  }
  return out;
}

// Additional pure helpers for assigned/completed math and formatting
function stripControlChars(s: string): string { return (s||'').replace(/[\u0000-\u001F\u007F]/g, ''); }
type Seg = { mode: 'read'|'skim'; ranges: Array<{ start: number; end: number }> };
function normalizeRanges(segments?: Seg[] | null): { read: Interval[]; skim: Interval[] } {
  const out = { read: [] as Interval[], skim: [] as Interval[] };
  if (!Array.isArray(segments)) return out;
  for (const s of segments) {
    if (!s || !Array.isArray(s.ranges)) continue;
    for (const r of s.ranges) {
      const a = Number((r as any)?.start); const b = Number((r as any)?.end);
      if (!isNaN(a) && !isNaN(b) && b>=a) (s.mode==='read'?out.read:out.skim).push([a,b]);
    }
  }
  return { read: mergeIntervals(out.read), skim: mergeIntervals(out.skim) };
}
function union(ranges: Interval[]): Interval[] { return mergeIntervals(ranges||[]); }
function minus(A: Interval[], B: Interval[]): Interval[] { return subtractIntervals(A||[], B||[]); }
function compress(pages?: number[] | null): Interval[] {
  const arr = Array.isArray(pages) ? pages.filter(x=>Number.isFinite(x)).map(x=>Number(x)).sort((a,b)=>a-b) : [];
  const out: Interval[] = [];
  for (const p of arr) { if (!out.length || p > out[out.length-1][1] + 1) out.push([p,p]); else out[out.length-1][1] = p; }
  return out;
}
function assignedUnion(assigned: { read: Interval[]; skim: Interval[] }): Interval[] {
  const R = union(assigned.read||[]);
  const S = minus(union(assigned.skim||[]), R);
  return union([...R, ...S]);
}
type LogEntry = { mode?: 'read'|'skim'|null; ranges?: Array<{ start:number; end:number }>|null; pages?: number[]|null; minutes?: number|null };
function completedUnion(logs: LogEntry[]): { iv: Interval[]; hasPageInfo: boolean } {
  const rIv: Interval[] = []; const sIv: Interval[] = []; let any=false;
  for (const lg of (logs||[])) {
    const mode = (lg?.mode==='skim')?'skim':'read';
    let iv: Interval[] = [];
    if (Array.isArray(lg?.ranges) && lg!.ranges!.length) iv = mergeIntervals(lg!.ranges!.map(r=>[Number((r as any).start), Number((r as any).end)]) as Interval[]);
    else if (Array.isArray(lg?.pages) && lg!.pages!.length) iv = compress(lg!.pages as number[]);
    if (iv.length) { any=true; if (mode==='read') rIv.push(...iv); else sIv.push(...iv); }
  }
  const R = union(rIv);
  const S = minus(union(sIv), R);
  return { iv: union([...R, ...S]), hasPageInfo: any };
}
function remainingUnion(assigned: Interval[], completed: Interval[]): Interval[] { return minus(union(assigned), union(completed)); }
function countPages(iv: Interval[]): number { return pagesInIntervals(iv); }
function formatRanges(iv: Interval[]): string { if (!iv.length) return ''; return iv.map(([a,b])=>a===b?`${a}`:`${a}–${b}`).join(', '); }
function pagesPerHourForCourse(course?: string|null): number {
  try {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem('coursePphMap');
      const map = raw ? JSON.parse(raw) as Record<string, { pph: number }> : null;
      const key = (course||'').toString().trim().toLowerCase();
      const val = key && map && map[key] && typeof map[key].pph === 'number' ? map[key].pph : null;
      if (typeof val === 'number' && val > 0) return Math.max(1, Math.round(val));
    }
  } catch {}
  return 18;
}
function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// Map a Today plan item to the canonical task UUID if possible
function canonicalTaskIdForItem(it: { id: string; title: string; course: string }, dateKey: string, schedule: ScheduledBlock[], tasks: any[]): string | null {
  if (isUUID(it.id)) return it.id;
  // try schedule for today
  const byId = (schedule||[]).find(b => b.day === dateKey && (b.id === it.id || (b.title === it.title && (b.course||'') === (it.course||''))));
  if (byId && isUUID(byId.taskId)) return byId.taskId;
  // try tasks by exact title+course
  const t = (tasks||[]).find((x:any) => (x.title||'') === (it.title||'') && (x.course||'') === (it.course||''));
  if (t && isUUID(t.id)) return t.id;
  return null;
}

// Day-level Chicago helpers for countdowns
function chicagoPartsYMD(d: Date) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  const s = fmt.format(d); // YYYY-MM-DD
  const [y, m, da] = s.split('-').map(v => parseInt(v, 10));
  return { y, m, d: da };
}
function ymdFromParts(y: number, m: number, d: number) { return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function cmpYmd(a: string, b: string) { return a === b ? 0 : (a < b ? -1 : 1); }
function addMonthsYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(x=>parseInt(x,10));
  let Y = y; let M = m + n; while (M > 12) { M -= 12; Y += 1; } while (M < 1) { M += 12; Y -= 1; }
  const daysInMonth = new Date(Y, M, 0).getDate();
  const D = Math.min(d, daysInMonth);
  return ymdFromParts(Y, M, D);
}
function addYearsYmd(ymd: string, n: number): string { return addMonthsYmd(ymd, n*12); }
function daysBetweenYmd(a: string, b: string): number {
  const [ay,am,ad] = a.split('-').map(x=>parseInt(x,10));
  const [by,bm,bd] = b.split('-').map(x=>parseInt(x,10));
  const aDate = new Date(ay, (am as number)-1, ad);
  const bDate = new Date(by, (bm as number)-1, bd);
  return Math.max(0, Math.round((bDate.getTime() - aDate.getTime()) / 86400000));
}
function diffMonthsWeeksDays(startYmd: string, endYmd: string): { months: number; weeks: number; days: number } {
  if (cmpYmd(endYmd, startYmd) <= 0) return { months: 0, weeks: 0, days: 0 };
  let months = 0;
  while (cmpYmd(addMonthsYmd(startYmd, months+1), endYmd) <= 0) months++;
  const afterMonths = addMonthsYmd(startYmd, months);
  const remDays = daysBetweenYmd(afterMonths, endYmd);
  const weeks = Math.floor(remDays / 7);
  const days = remDays % 7;
  return { months, weeks, days };
}
function diffYearsMonthsDays(startYmd: string, endYmd: string): { years: number; months: number; days: number } {
  if (cmpYmd(endYmd, startYmd) <= 0) return { years: 0, months: 0, days: 0 };
  let years = 0; while (cmpYmd(addYearsYmd(startYmd, years+1), endYmd) <= 0) years++;
  const afterYears = addYearsYmd(startYmd, years);
  let months = 0; while (cmpYmd(addMonthsYmd(afterYears, months+1), endYmd) <= 0) months++;
  const afterMonths = addMonthsYmd(afterYears, months);
  const days = daysBetweenYmd(afterMonths, endYmd);
  return { years, months, days };
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
  if (a.ap === b.ap) return `${a.h12}–${b.h12}${a.ap}`;
  return `${a.h12}${a.ap}–${b.h12}${b.ap}`;
}

function loadGoals(): WeeklyGoal[] { if (typeof window==='undefined') return []; try { const raw=window.localStorage.getItem(LS_GOALS); const arr=raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; } catch { return []; } }
function saveGoals(goals: WeeklyGoal[]) { if (typeof window!=='undefined') window.localStorage.setItem(LS_GOALS, JSON.stringify(goals)); }

export default function TodayPage() {
  // Step wizard (1: choose/add, 2: confirm/order, 3: locked)
  const [step, setStep] = useState<1|2|3>(1);
  const [dateKey, setDateKey] = useState<string>(() => chicagoYmd(new Date()));
  const [plan, setPlan] = useState<TodayPlan>({ dateKey, locked: false, items: [] });
  const [schedule, setSchedule] = useState<ScheduledBlock[]>([]);
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [availability, setAvailability] = useState<AvailabilityTemplate>({ 0:120,1:240,2:240,3:240,4:240,5:240,6:120 });
  const [goals, setGoals] = useState<WeeklyGoal[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const { tasks, setTasks } = useTasks();
  const [rightMode, setRightMode] = useState<'day'|'week'>('day');
  const [selectedKey, setSelectedKey] = useState<string>(() => chicagoYmd(new Date()));
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [itemSeconds, setItemSeconds] = useState<Record<string, number>>({});
  const [itemStartAt, setItemStartAt] = useState<Record<string, number>>({});
  const itemTickRef = useRef<NodeJS.Timeout|null>(null);
  const carryoverRef = useRef<boolean>(false);
  const [ctNow, setCtNow] = useState<string>('--:--'); // Hydration-safe default
  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  const [logModal, setLogModal] = useState<{ mode: 'partial'|'finish'; itemId: string } | null>(null);
  const [logForm, setLogForm] = useState<{ minutes: string; focus: string; notes: string; pages: string; portion: string; moveDay: string }>({ minutes: '', focus: '5', notes: '', pages: '', portion: '', moveDay: '' });
  const [editModal, setEditModal] = useState<{ itemId: string } | null>(null);
  const [editForm, setEditForm] = useState<{ title: string; notes: string; estimate: string; segments: string; pph: string }>({ title: '', notes: '', estimate: '', segments: '', pph: '' });
  
  // Get Central Time properly - client-only to avoid hydration mismatch
  const getCentralTime = () => {
    const now = new Date();
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(now);
  };
  
  useEffect(() => {
    // Set time immediately on client mount
    setCtNow(getCentralTime());
    // Update every minute
    const id = setInterval(() => setCtNow(getCentralTime()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window==='undefined') return;
    try {
      const rawS = window.localStorage.getItem(LS_SCHEDULE); setSchedule(rawS?JSON.parse(rawS):[]);
      const rawB = window.localStorage.getItem(LS_BACKLOG); setBacklog(rawB?JSON.parse(rawB):[]);
      const rawA = window.localStorage.getItem(LS_AVAIL); setAvailability(rawA?JSON.parse(rawA):availability);
      const rawT = window.localStorage.getItem(LS_TODAY);
      setGoals(loadGoals());
      const dk = chicagoYmd(new Date()); setDateKey(dk);
      if (rawT) {
        const t = JSON.parse(rawT) as TodayPlan;
        if (t.dateKey === dk) setPlan(t);
      }
    } catch {}
    let canceled = false;
    (async () => {
      try {
        const [schRes, setRes] = await Promise.all([
          fetch('/api/schedule', { cache: 'no-store' }),
          fetch('/api/settings?keys=weeklyGoalsV1,availabilityTemplateV1,todayPlanV1,todayItemTimersV1,nudgesEnabled,nudgesReminderTime,nudgesQuietStart,nudgesQuietEnd,nudgesMaxPerWeek', { cache: 'no-store' })
        ]);
        if (canceled) return;
        if (setRes.ok) {
          const sj = await setRes.json().catch(() => ({ settings: {} }));
          const s = (sj?.settings || {}) as Record<string, any>;
          if (s.availabilityTemplateV1 && typeof s.availabilityTemplateV1 === 'object') setAvailability(s.availabilityTemplateV1 as any);
          if (Array.isArray(s.weeklyGoalsV1)) setGoals(s.weeklyGoalsV1 as any[]);
          const tp = s.todayPlanV1 as any;
          const dk = chicagoYmd(new Date());
          if (tp && typeof tp === 'object' && tp.dateKey === dk) setPlan(tp as TodayPlan);
          const ttt = s.todayItemTimersV1 as any;
          if (ttt && typeof ttt === 'object' && ttt.dateKey === dk) {
            const sec = (ttt.itemSeconds && typeof ttt.itemSeconds === 'object') ? ttt.itemSeconds as Record<string, number> : {};
            const st = (ttt.itemStartAt && typeof ttt.itemStartAt === 'object') ? ttt.itemStartAt as Record<string, number> : {};
            setItemSeconds(sec);
            setItemStartAt(st);
            if (typeof ttt.activeItemId === 'string' || ttt.activeItemId === null) setActiveItemId(ttt.activeItemId || null);
          }
          try {
            if (typeof window !== 'undefined') {
              if (typeof s.nudgesEnabled === 'boolean') window.localStorage.setItem('nudgesEnabled', s.nudgesEnabled ? 'true' : 'false');
              if (typeof s.nudgesReminderTime === 'string') window.localStorage.setItem('nudgesReminderTime', s.nudgesReminderTime);
              if (typeof s.nudgesQuietStart === 'string') window.localStorage.setItem('nudgesQuietStart', s.nudgesQuietStart);
              if (typeof s.nudgesQuietEnd === 'string') window.localStorage.setItem('nudgesQuietEnd', s.nudgesQuietEnd);
              if (typeof s.nudgesMaxPerWeek !== 'undefined') window.localStorage.setItem('nudgesMaxPerWeek', String(Math.max(0, parseInt(String(s.nudgesMaxPerWeek),10)||3)));
            }
          } catch {}
        }
        if (schRes.ok) {
          const bj = await schRes.json().catch(() => ({ blocks: [] }));
          const remote = Array.isArray(bj?.blocks) ? bj.blocks : [];
          const local = (() => { try { const raw = window.localStorage.getItem(LS_SCHEDULE); return raw ? JSON.parse(raw) : []; } catch { return []; } })();
          if (remote.length > 0) setSchedule(remote as any);
          else if (local.length > 0) { try { await fetch('/api/schedule', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ blocks: local }) }); } catch {} }
        }
      } catch {}
    })();
    return () => { canceled = true; };
  }, []);
  useEffect(() => { if (typeof window!=='undefined') window.localStorage.setItem(LS_TODAY, JSON.stringify(plan)); }, [plan]);
  useEffect(() => { saveGoals(goals); }, [goals]);
  useEffect(() => {
    const id = setTimeout(() => {
      try { void fetch('/api/settings', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ todayPlanV1: plan }) }); } catch {}
    }, 400);
    return () => clearTimeout(id);
  }, [plan]);
  useEffect(() => {
    const id = setTimeout(() => {
      try { void fetch('/api/settings', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ weeklyGoalsV1: goals }) }); } catch {}
    }, 400);
    return () => clearTimeout(id);
  }, [goals]);

  // Persist per-item timers to server (debounced)
  useEffect(() => {
    const id = setTimeout(() => {
      try { void fetch('/api/settings', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ todayItemTimersV1: { dateKey, itemSeconds, itemStartAt, activeItemId } }) }); } catch {}
    }, 1500);
    return () => clearTimeout(id);
  }, [itemSeconds, itemStartAt, activeItemId, dateKey]);

  // Sessions fetch for KPIs
  useEffect(() => {
    let mounted = true;
    (async () => {
      try { const r = await fetch('/api/sessions', { cache: 'no-store' }); const d = await r.json(); if (mounted) setSessions(Array.isArray(d.sessions)?d.sessions:[]); }
      catch {}
    })();
    return () => { mounted = false; };
  }, [dateKey]);
  // Auto-sync: adjust remaining ranges/minutes based on cumulative pages read
  useEffect(() => {
    if (!plan || !plan.items || plan.items.length === 0) return;
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(LS_ORIG_RANGES);
      const origMap = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      let changed = false;
      let scheduleChanged = false;
      const nextItems: TodayPlanItem[] = [];
      const nextSched = (schedule||[]).slice();
      for (const it of plan.items) {
        const chips = extractPageRanges(String(it.title||''));
        if (chips.length === 0) { nextItems.push(it); continue; }
        const re = /\bp(?:p|ages?)?\.?\s*[0-9,\s–:\-]+(?:\s*,\s*[0-9–:\-]+)*/i;
        // establish baseline
        const baseline = origMap[it.id] || ('p. ' + chips.join(', '));
        if (!origMap[it.id]) { origMap[it.id] = baseline; }
        const origIntervals = parseIntervalsFromRangeString(baseline);
        // cumulative previously read (pagesRead if present; else derive from minutes)
        let prevPages = 0; let extraMins = 0;
        for (const ss of (sessions||[])) {
          if (ss?.taskId !== it.id) continue;
          const pr = Number(ss?.pagesRead || 0);
          if (pr > 0) prevPages += pr;
          else extraMins += Math.max(0, Number(ss?.minutes)||0);
        }
        const mpp = minutesPerPageForCourse(it.course);
        const prevRead = prevPages + Math.floor(extraMins / Math.max(1, Math.round(mpp)));
        let remaining = subtractCountFromFront(origIntervals, prevRead);
        const pagesLeft = pagesInIntervals(remaining);
        const remainLabel = intervalsToLabel(remaining);
        if (pagesLeft <= 0) {
          // remove from plan
          changed = true;
          // mark schedule block to 0 if present
          const si = nextSched.findIndex(b => b.taskId === it.id && b.day === plan.dateKey);
          if (si !== -1) { nextSched[si] = { ...nextSched[si], plannedMinutes: 0 }; scheduleChanged = true; }
          // best-effort mark task done
          if (isUUID(it.id)) { try { void fetch(`/api/tasks/${it.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'done' }) }); } catch {} }
          continue;
        }
        const newMinutes = Math.max(1, Math.round(pagesLeft * minutesPerPageForCourse(it.course)));
        const currentLabel = String(it.title||'').match(re)?.[0] || '';
        const desiredTitle = re.test(it.title||'') ? String(it.title).replace(re, remainLabel) : `${it.title} — ${remainLabel}`;
        if (currentLabel !== remainLabel || Number(it.minutes)!==newMinutes || it.guessed===true) {
          nextItems.push({ ...it, title: desiredTitle, minutes: newMinutes, guessed: false });
          changed = true;
          // schedule
          const si = nextSched.findIndex(b => b.taskId === it.id && b.day === plan.dateKey);
          if (si !== -1) { nextSched[si] = { ...nextSched[si], title: desiredTitle, plannedMinutes: newMinutes, guessed: false }; scheduleChanged = true; }
          // persist task
          if (isUUID(it.id)) { try { void fetch(`/api/tasks/${it.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title: desiredTitle, estimatedMinutes: newMinutes }) }); } catch {} }
        } else {
          nextItems.push(it);
        }
      }
      if (changed) setPlan(p => ({ ...p, items: nextItems }));
      if (scheduleChanged) {
        setSchedule(nextSched as any);
        try { void fetch('/api/schedule', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ blocks: nextSched }) }); } catch {}
      }
      window.localStorage.setItem(LS_ORIG_RANGES, JSON.stringify(origMap));
    } catch {}
  }, [sessions, plan.dateKey, plan.items.length]);
  // Tasks for preview come from shared useTasks hook

  // Compute today's scheduled blocks (from weekly schedule)
  const todaysBlocks = useMemo(() => (schedule || []).filter(b => b.day === dateKey), [schedule, dateKey]);
  // Minutes planned today per taskId (to hide from tomorrow preview if fully covered today)
  const plannedTodayByTaskId = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of (schedule || [])) {
      if (b.day === dateKey && b.taskId) m.set(b.taskId, (m.get(b.taskId) || 0) + Math.max(0, Number(b.plannedMinutes)||0));
    }
    return m;
  }, [schedule, dateKey]);
  // Right-side view: selected day/week
  const selectedBlocks = useMemo(() => (schedule || []).filter(b => b.day === selectedKey), [schedule, selectedKey]);
  const tasksDueSelected = useMemo(() => {
    const arr = (tasks || []).filter((t:any) => (t.status === 'todo') && chicagoYmd(new Date(t.dueDate)) === selectedKey);
    // If previewing a future day (e.g., tomorrow) and the task is fully planned today, hide it from preview
    const todayKey = dateKey;
    if (selectedKey > todayKey) {
      return arr.filter((t:any) => {
        const planned = plannedTodayByTaskId.get(t.id) || 0;
        const { minutes: est } = estimateMinutesForTask(t as any);
        if (planned >= est && est > 0) return false;
        return true;
      });
    }
    return arr;
  }, [tasks, selectedKey, dateKey, plannedTodayByTaskId]);
  const selectedWeekKeys = useMemo(() => {
    const [y,m,da] = selectedKey.split('-').map(x=>parseInt(x,10));
    const dt = new Date(y,(m as number)-1,da);
    return weekKeysChicago(dt);
  }, [selectedKey]);
  const weekBlocks = useMemo(() => (schedule || []).filter(b => selectedWeekKeys.includes(b.day)), [schedule, selectedWeekKeys]);
  const weekDueTasks = useMemo(() => (tasks || []).filter((t:any) => (t.status==='todo') && selectedWeekKeys.includes(chicagoYmd(new Date(t.dueDate)))), [tasks, selectedWeekKeys]);

  // Auto-carryover unfinished items from an older plan to the next day (or next day with availability)
  useEffect(() => {
    if (carryoverRef.current) return;
    const today = chicagoYmd(new Date());
    if (!plan?.dateKey || plan.dateKey >= today) return;
    const leftovers = (plan?.items || []).filter(it => (Number(it.minutes)||0) > 0);
    if (leftovers.length === 0) return;
    // Build planned minutes by day
    const planned = new Map<string, number>();
    for (const b of (schedule || [])) planned.set(b.day, (planned.get(b.day)||0) + Math.max(0, Number(b.plannedMinutes)||0));
    // Availability by DOW
    const avail: Record<number, number> = (() => { try { return (typeof window!=='undefined' ? (JSON.parse(window.localStorage.getItem('availabilityTemplateV1')||'{}')||{}) : {}) as any; } catch { return {} as any; } })();
    const capFor = (ymdStr: string) => { const [y,m,da] = ymdStr.split('-').map(x=>parseInt(x,10)); const d=new Date(y,(m as number)-1,da); return Math.max(0, Number(avail[d.getDay()]||0)); };
    const ALLOWED_OVERAGE_MIN = 60; // allow up to 60m over capacity
    const TRY_DAYS = 21;
    const additions: any[] = [];
    const startBase = new Date(plan.dateKey);
    for (const it of leftovers) {
      let rem = Math.max(1, Math.round(Number(it.minutes)||0));
      // Overdue if linked task has dueDate < today
      const t = (tasks || []).find((x:any) => isUUID(it.id) && x.id === it.id);
      const isOverdue = !!(t && chicagoYmd(new Date(t.dueDate)) < today);
      // If overdue, drop entire remainder on the next day regardless of capacity
      if (isOverdue) {
        const d = new Date(startBase); d.setDate(d.getDate()+1);
        const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        additions.push({ id: uid(), taskId: (isUUID(it.id)? it.id : uid()), day: k, plannedMinutes: rem, guessed: true, title: it.title, course: it.course || '', pages: null, priority: null });
        planned.set(k, (planned.get(k)||0) + rem);
        continue;
      }
      // Otherwise, try to split across next days within capacity + overage
      for (let i=1;i<=TRY_DAYS && rem>0;i++) {
        const d = new Date(startBase); d.setDate(d.getDate()+i);
        const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const cap = capFor(k);
        const used = planned.get(k) || 0;
        const allow = Math.max(0, (cap - used) + ALLOWED_OVERAGE_MIN);
        if (allow <= 0) continue;
        const chunk = Math.max(1, Math.min(rem, allow));
        additions.push({ id: uid(), taskId: (isUUID(it.id)? it.id : uid()), day: k, plannedMinutes: chunk, guessed: true, title: it.title, course: it.course || '', pages: null, priority: null });
        planned.set(k, used + chunk);
        rem -= chunk;
      }
      if (rem > 0) {
        // fallback: put remaining on the day with most capacity (even if exceeding)
        let bestK = '';
        let bestRem = -Infinity;
        for (let i=1;i<=TRY_DAYS;i++) {
          const d = new Date(startBase); d.setDate(d.getDate()+i);
          const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const cap = capFor(k); const used = planned.get(k)||0; const left = cap - used;
          if (left > bestRem) { bestRem = left; bestK = k; }
        }
        const k = bestK || today;
        additions.push({ id: uid(), taskId: (isUUID(it.id)? it.id : uid()), day: k, plannedMinutes: rem, guessed: true, title: it.title, course: it.course || '', pages: null, priority: null });
        planned.set(k, (planned.get(k)||0) + rem);
      }
    }
    if (additions.length) {
      const nextBlocks = [...(schedule||[]), ...additions];
      setSchedule(nextBlocks);
      try { void fetch('/api/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: nextBlocks }) }); } catch {}
    }
    // Reset today's plan for new day
    setPlan({ dateKey: today, locked: false, items: [] });
    carryoverRef.current = true;
  }, [plan.dateKey, plan.items, schedule]);

  // Backlog suggestions: top by due asc then priority, limit 5
  const backlogSorted = useMemo(() => {
    const arr = (backlog||[]).slice();
    arr.sort((a,b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      const ap = a.priority ?? 0; const bp = b.priority ?? 0; return (bp - ap);
    });
    return arr;
  }, [backlog]);

  // Initialize plan from schedule if not set yet
  useEffect(() => {
    if (plan.items.length === 0 && todaysBlocks.length > 0 && !plan.locked) {
      const items: TodayPlanItem[] = todaysBlocks.map(b => ({ id: b.taskId || b.id, title: b.title, course: b.course, minutes: b.plannedMinutes, guessed: b.guessed }));
      setPlan({ dateKey, locked: false, items });
      setStep(2);
    }
  }, [todaysBlocks, plan.items.length, plan.locked, dateKey]);

  // Wizard actions
  function addFromBacklog(it: BacklogItem) {
    if (plan.items.find(p => p.id === it.id)) return;
    const { minutes, guessed } = estimateMinutes(it);
    const next = { id: it.id, title: it.title, course: it.course, minutes, guessed };
    setPlan(p => ({ ...p, items: [...p.items, next] }));
  }
  function removeItem(id: string) { setPlan(p => ({ ...p, items: p.items.filter(x => x.id !== id) })); }
  function moveItem(id: string, dir: -1|1) {
    setPlan(p => {
      const idx = p.items.findIndex(x => x.id === id); if (idx<0) return p;
      const j = idx + dir; if (j<0 || j>=p.items.length) return p;
      const arr = p.items.slice(); const [it] = arr.splice(idx,1); arr.splice(j,0,it);
      return { ...p, items: arr };
    });
  }
  function lockPlan() { setPlan(p => ({ ...p, locked: true, lockedAt: new Date().toISOString() })); setStep(3); }

  // Per-item timer tick (display refresh only; elapsed computed by wall-clock)
  useEffect(() => {
    if (activeItemId) {
      itemTickRef.current = setInterval(() => { setNowTs(Date.now()); }, 1000) as any;
    } else if (itemTickRef.current) {
      clearInterval(itemTickRef.current); itemTickRef.current = null;
    }
    return () => { if (itemTickRef.current) { clearInterval(itemTickRef.current); itemTickRef.current = null; } };
  }, [activeItemId]);

  function startItemTimer(id: string) {
    // Accumulate previous active before switching
    setActiveItemId(prev => {
      if (prev && itemStartAt[prev]) {
        const delta = Math.max(0, Math.floor((Date.now() - (itemStartAt[prev] || 0)) / 1000));
        if (delta > 0) setItemSeconds(s => ({ ...s, [prev]: Math.max(0, (s[prev] || 0) + delta) }));
        setItemStartAt(st => ({ ...st, [prev]: 0 }));
      }
      return id;
    });
    setItemStartAt(st => ({ ...st, [id]: Date.now() }));
  }
  function pauseItemTimer() {
    setActiveItemId(prev => {
      if (prev && itemStartAt[prev]) {
        const delta = Math.max(0, Math.floor((Date.now() - (itemStartAt[prev] || 0)) / 1000));
        if (delta > 0) setItemSeconds(s => ({ ...s, [prev]: Math.max(0, (s[prev] || 0) + delta) }));
        setItemStartAt(st => ({ ...st, [prev]: 0 }));
      }
      return null;
    });
  }

  function resetTimer(id: string) {
    setActiveItemId(prev => {
      if (prev === id && itemStartAt[id]) {
        const delta = Math.max(0, Math.floor((Date.now() - (itemStartAt[id] || 0)) / 1000));
        if (delta > 0) {
          // discard unsaved elapsed for current run
          setItemStartAt(st => ({ ...st, [id]: 0 }));
        }
      }
      return prev === id ? null : prev;
    });
    setItemSeconds(s => ({ ...s, [id]: 0 }));
  }

  async function recalcFromSessions(it: TodayPlanItem) {
    try {
      if (typeof window === 'undefined') return;
      const taskId = canonicalTaskIdForItem(it, plan.dateKey, schedule, tasks) || it.id;
      const chips = extractPageRanges(String(it.title||''));
      if (chips.length === 0) return;
      const raw = window.localStorage.getItem(LS_ORIG_RANGES);
      const origMap = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      const baseline = origMap[it.id] || ('p. ' + chips.join(', '));
      if (!origMap[it.id]) { origMap[it.id] = baseline; }
      const origIntervals = parseIntervalsFromRangeString(baseline);
      let prevPages = 0; let extraMins = 0;
      for (const ss of (sessions||[])) {
        if (ss?.taskId !== taskId) continue;
        const pr = Number(ss?.pagesRead || 0);
        if (pr > 0) prevPages += pr; else extraMins += Math.max(0, Number(ss?.minutes)||0);
      }
      const mpp = minutesPerPageForCourse(it.course);
      const prevRead = prevPages + Math.floor(extraMins / Math.max(1, Math.round(mpp)));
      let remaining = subtractCountFromFront(origIntervals, prevRead);
      const pagesLeft = pagesInIntervals(remaining);
      const remainLabel = intervalsToLabel(remaining);
      if (pagesLeft <= 0) {
        setPlan(p => ({ ...p, items: p.items.filter(x => x.id !== it.id) }));
        if (isUUID(taskId)) { try { void fetch(`/api/tasks/${taskId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'done' }) }); } catch {} }
        try {
          const nextSched = (schedule||[]).map(b => (b.taskId === taskId && b.day === plan.dateKey) ? { ...b, plannedMinutes: 0 } : b);
          if (nextSched !== schedule) {
            setSchedule(nextSched as any);
            try { void fetch('/api/schedule', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ blocks: nextSched }) }); } catch {}
          }
        } catch {}
      } else {
        const newMinutes = Math.max(1, Math.round(pagesLeft * mpp));
        const re = /\bp(?:p|ages?)?\.?\s*[0-9,\s–:\-]+(?:\s*,\s*[0-9–:\-]+)*/i;
        const newTitle = re.test(it.title) ? String(it.title).replace(re, remainLabel) : `${it.title} — ${remainLabel}`;
        setPlan(p => ({ ...p, items: p.items.map(x => x.id === it.id ? { ...x, title: newTitle, minutes: newMinutes, guessed: false } : x) }));
        if (isUUID(taskId)) { try { void fetch(`/api/tasks/${taskId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title: newTitle, estimatedMinutes: newMinutes }) }); } catch {} }
        try {
          const nextSched = (schedule||[]).map(b => (b.taskId === taskId && b.day === plan.dateKey) ? { ...b, plannedMinutes: newMinutes, title: newTitle, guessed: false } : b);
          if (nextSched !== schedule) {
            setSchedule(nextSched as any);
            try { void fetch('/api/schedule', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ blocks: nextSched }) }); } catch {}
          }
        } catch {}
      }
      window.localStorage.setItem(LS_ORIG_RANGES, JSON.stringify(origMap));
    } catch {}
  }

  async function refreshSessionsNow() {
    try { const r = await fetch('/api/sessions', { cache: 'no-store' }); const d = await r.json(); setSessions(Array.isArray(d.sessions)?d.sessions:[]); } catch {}
  }

  function openLogFor(itemId: string, mode: 'partial'|'finish') {
    const it = plan.items.find(x => x.id === itemId); if (!it) return;
    const secs = Math.max(0, Number(itemSeconds[itemId] || 0));
    const minsFromTimer = Math.floor(secs / 60);
    const def = mode === 'finish' ? Math.max(1, minsFromTimer || (Number(it.minutes)||0)) : Math.max(1, minsFromTimer || Math.max(1, Math.round((Number(it.minutes)||0)/2)));
    const df = (typeof window !== 'undefined' ? (window.localStorage.getItem('defaultFocus') || '5') : '5');
    setLogForm({ minutes: minutesToHM(def), focus: df, notes: '', pages: '', portion: '', moveDay: '' });
    setLogModal({ mode, itemId });
  }

  async function submitLog() {
    if (!logModal) return;
    const it = plan.items.find(x => x.id === logModal.itemId); if (!it) return;
    let minutes = (() => { const p = parseMinutesFlexible(logForm.minutes||''); if (p!=null && p>0) return p; const n = parseInt(logForm.minutes||'0',10); return Math.max(1, isNaN(n)?0:n); })();
    const f = parseFloat(logForm.focus || ''); const focus = isNaN(f) ? null : Math.max(1, Math.min(10, f));
    const portion = (logForm.portion || '').trim();
    const notes = (() => { const base = (logForm.notes || '').trim(); return portion ? (base ? `${base}\nPortion: ${portion}` : `Portion: ${portion}`) : (base || null); })();
    const pagesRead = (() => {
      const str = (logForm.pages||'').trim();
      const iv = parseIntervalsFromRangeString(str);
      const fromIv = pagesInIntervals(iv);
      if (fromIv>0) return fromIv;
      const n = parseInt(str,10); return isNaN(n)||n<=0 ? null : n;
    })();
    // If user provided pages for readings, compute minutes from pages using per-course MPP
    if (pagesRead && pagesRead > 0) {
      const mpp = minutesPerPageForCourse(it.course);
      const estFromPages = Math.max(1, Math.round(pagesRead * mpp));
      minutes = estFromPages;
    }
    const taskId = canonicalTaskIdForItem(it, plan.dateKey, schedule, tasks);
    const body: any = { taskId: taskId, when: new Date().toISOString(), minutes, focus, notes, pagesRead, activity: null };
    try { await fetch('/api/sessions', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) }); } catch {}
    await refreshSessionsNow();
    if (logModal.mode === 'finish') {
      if (taskId) { try { await fetch(`/api/tasks/${taskId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'done' }) }); } catch {} }
      setPlan(p => ({ ...p, items: p.items.filter(x => x.id !== it.id) }));
    } else {
      // Partial: recompute remaining ranges & minutes using cumulative pages read
      const titleRangesStr = extractPageRanges(String(it.title||'')).join(', ');
      const origIntervals = parseIntervalsFromRangeString(titleRangesStr);
      const totalPages = pagesInIntervals(origIntervals);
      // Cumulative pages previously read for this task (sessions state)
      const canonId = canonicalTaskIdForItem(it, plan.dateKey, schedule, tasks) || it.id;
      const prevRead = (sessions||[]).reduce((sum:number, s:any)=>{
        const tid = s?.taskId; const pr = Number(s?.pagesRead||0);
        return (tid===canonId && pr>0) ? (sum+pr) : sum;
      }, 0);
      // Start from remaining after previously read pages (consume from front)
      let baseRemaining = subtractCountFromFront(origIntervals, prevRead);
      // Apply current input
      const readIntervals = parseIntervalsFromRangeString(logForm.pages||'');
      let remainingIntervals = baseRemaining;
      if (readIntervals.length > 0) {
        remainingIntervals = subtractIntervals(baseRemaining, readIntervals);
      } else {
        const n = parseInt((logForm.pages||'').trim(), 10);
        if (!isNaN(n) && n>0) remainingIntervals = subtractCountFromFront(baseRemaining, n);
      }
      const pagesLeft = pagesInIntervals(remainingIntervals);
      if (pagesLeft > 0) {
        const newMinutes = Math.max(1, Math.round(pagesLeft * minutesPerPageForCourse(it.course)));
        const re = /\bp(?:p|ages?)?\.?\s*[0-9,\s–:\-]+(?:\s*,\s*[0-9–:\-]+)*/i;
        const remainLabel = intervalsToLabel(remainingIntervals);
        const newTitle = re.test(it.title) ? String(it.title).replace(re, remainLabel) : `${it.title} — ${remainLabel}`;
        
        // Check if user wants to move remaining work to a different day
        const moveDay = (logForm.moveDay || '').trim();
        const targetDay = moveDay && /^\d{4}-\d{2}-\d{2}$/.test(moveDay) ? moveDay : plan.dateKey;
        
        if (moveDay && targetDay !== plan.dateKey) {
          // Remove from today's plan
          setPlan(p => ({ ...p, items: p.items.filter(x => x.id !== it.id) }));
          // Add to schedule for target day
          try {
            const schedRes = await fetch('/api/schedule', { cache: 'no-store' });
            const schedData = await schedRes.json();
            const blocks = Array.isArray(schedData.blocks) ? schedData.blocks : [];
            // Remove from today, add to target day
            const filtered = blocks.filter((b:any) => !(b.taskId === (taskId||it.id) && b.day === plan.dateKey));
            filtered.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              taskId: taskId || it.id,
              day: targetDay,
              plannedMinutes: newMinutes,
              guessed: false,
              title: newTitle,
              course: it.course,
              pages: null,
              priority: null,
              catchup: false
            });
            await fetch('/api/schedule', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ blocks: filtered }) });
            setSchedule(filtered as any);
          } catch {}
          // Also update the due date on the task if needed
          if (taskId) {
            const newDueDate = new Date(targetDay + 'T23:59:59').toISOString();
            try { await fetch(`/api/tasks/${taskId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title: newTitle, estimatedMinutes: newMinutes, dueDate: newDueDate, remainingPageRanges: remainLabel }) }); } catch {}
          }
        } else {
          // Keep on today
          setPlan(p => ({ ...p, items: p.items.map(x => x.id === it.id ? { ...x, title: newTitle, minutes: newMinutes, guessed: false } : x) }));
          // Persist to Task so changes show everywhere
          if (taskId) { try { await fetch(`/api/tasks/${taskId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title: newTitle, estimatedMinutes: newMinutes, remainingPageRanges: remainLabel }) }); } catch {} }
          // Update this week's schedule block for the task (today's block)
          try {
            const nextSched = (schedule||[]).map(b => (b.taskId === (taskId||it.id) && b.day === plan.dateKey) ? { ...b, plannedMinutes: newMinutes, title: newTitle, guessed: false } : b);
            if (nextSched !== schedule) {
              setSchedule(nextSched as any);
              try { void fetch('/api/schedule', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ blocks: nextSched }) }); } catch {}
            }
          } catch {}
        }
      } else {
        // No pages left; remove from plan and optionally mark task/schedule as done-ish
        setPlan(p => ({ ...p, items: p.items.filter(x => x.id !== it.id) }));
        if (taskId) { try { await fetch(`/api/tasks/${taskId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'done' }) }); } catch {} }
        try {
          const nextSched = (schedule||[]).map(b => (b.taskId === (taskId||it.id) && b.day === plan.dateKey) ? { ...b, plannedMinutes: 0 } : b);
          if (nextSched !== schedule) {
            setSchedule(nextSched as any);
            try { void fetch('/api/schedule', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ blocks: nextSched }) }); } catch {}
          }
        } catch {}
      }
    }
    setItemSeconds(prev => ({ ...prev, [it.id]: 0 }));
    if (activeItemId === it.id) setActiveItemId(null);
    setLogModal(null);
  }

  function openEditFor(id: string) {
    const it = plan.items.find(x => x.id === id); if (!it) return;
    const t: any = (tasks||[]).find((x:any) => (x.id===id) || (x.title===it.title && (x.course||'')===(it.course||''))) || {};
    const segs = Array.isArray(t.assignedSegments) ? t.assignedSegments as any[] : [];
    const segmentsText = segs.map((s:any) => Array.isArray(s?.ranges)? s.ranges.map((r:any)=>`${r.start}-${r.end}`).join(',') : '').filter(Boolean).join('; ');
    setEditForm({
      title: String(t.title || it.title || ''),
      notes: String(t.notes || ''),
      estimate: String(Math.max(0, Number(t.estimatedMinutes || it.minutes) || 0)),
      segments: segmentsText,
      pph: (()=>{ try{ const raw=window.localStorage.getItem('coursePphMap'); const map=raw?JSON.parse(raw):{}; const k=(it.course||'').toString().toLowerCase(); const v=(map&&map[k]&&map[k].pph)||''; return v?String(v):''; }catch{return '';} })()
    });
    setEditModal({ itemId: id });
  }

  async function saveEdit() {
    if (!editModal) return;
    const id = editModal.itemId;
    const it = plan.items.find(x => x.id === id); if (!it) { setEditModal(null); return; }
    const est = Math.max(0, parseInt(editForm.estimate||'0',10) || 0);
    const segmentsText = (editForm.segments||'').trim();
    const segs = segmentsText ? segmentsText.split(/\s*;\s*/).map(part => {
      const ranges = part.split(/\s*,\s*/).map(r=>{ const mm=/^(\d+)-(\d+)$/.exec(r); if(!mm) return null; return { start: parseInt(mm[1],10), end: parseInt(mm[2],10) };}).filter(Boolean);
      return { mode: 'read', ranges } as any;
    }).filter((s:any)=>Array.isArray(s.ranges)&&s.ranges.length>0) : undefined;
    try {
      if (isUUID(id)) {
        const body:any = { title: editForm.title, notes: editForm.notes||null, estimatedMinutes: est>0?est:null };
        if (segs && segs.length>0) body.assignedSegments = segs;
        await fetch(`/api/tasks/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      }
      setTasks(prev => prev.map((t:any)=> (t.id===id? { ...t, title: editForm.title, notes: editForm.notes||null, estimatedMinutes: est>0?est:null, assignedSegments: segs||t.assignedSegments } : t)) as any);
      try { if (editForm.pph) { const n=parseInt(editForm.pph,10); if(!isNaN(n)&&n>0){ const raw=window.localStorage.getItem('coursePphMap'); const map=raw?JSON.parse(raw):{}; const k=(it.course||'').toString().toLowerCase(); map[k]={pph:n}; window.localStorage.setItem('coursePphMap', JSON.stringify(map)); } } } catch {}
      setPlan(p => ({ ...p, items: p.items.map(x=> x.id===id? { ...x, title: editForm.title, minutes: est>0?est:x.minutes } : x) }));
    } catch {}
    setEditModal(null);
  }

  async function logSessionForItem(it: TodayPlanItem, minutes: number) {
    const body: any = { taskId: isUUID(it.id) ? it.id : null, when: new Date().toISOString(), minutes: Math.max(1, Math.round(minutes||0)), focus: null, notes: null, activity: null };
    try { await fetch('/api/sessions', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); } catch {}
    await refreshSessionsNow();
  }

  async function handleFinishItem(id: string) {
    const it = plan.items.find(x => x.id === id); if (!it) return;
    const secs = Math.max(0, Number(itemSeconds[id] || 0));
    const minsFromTimer = Math.floor(secs / 60);
    const def = Math.max(1, minsFromTimer || (Number(it.minutes)||0));
    let minutes = def;
    try {
      if (typeof window !== 'undefined') {
        const resp = window.prompt('Minutes to log for this task', String(def));
        if (resp != null && resp.trim() !== '') {
          const v = parseInt(resp, 10); if (!isNaN(v) && v > 0) minutes = v;
        }
      }
    } catch {}
    await logSessionForItem(it, minutes);
    if (isUUID(id)) { try { await fetch(`/api/tasks/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'done' }) }); } catch {} }
    setPlan(p => ({ ...p, items: p.items.filter(x => x.id !== id) }));
    setItemSeconds(prev => ({ ...prev, [id]: 0 }));
    if (activeItemId === id) setActiveItemId(null);
  }

  async function handlePartialItem(id: string) {
    const it = plan.items.find(x => x.id === id); if (!it) return;
    const secs = Math.max(0, Number(itemSeconds[id] || 0));
    const minsFromTimer = Math.floor(secs / 60);
    const def = Math.max(1, minsFromTimer || Math.max(1, Math.round((Number(it.minutes)||0) / 2)));
    let minutes = def;
    try {
      if (typeof window !== 'undefined') {
        const resp = window.prompt('Minutes to log as partial completion', String(def));
        if (resp != null && resp.trim() !== '') {
          const v = parseInt(resp, 10); if (!isNaN(v) && v > 0) minutes = v;
        }
      }
    } catch {}
    minutes = Math.min(minutes, Math.max(1, Number(it.minutes)||0));
    await logSessionForItem(it, minutes);
    setPlan(p => ({ ...p, items: p.items.map(x => x.id === id ? { ...x, minutes: Math.max(0, (Number(x.minutes)||0) - minutes) } : x) }));
    setItemSeconds(prev => ({ ...prev, [id]: 0 }));
    if (activeItemId === id) setActiveItemId(null);
  }

  // no global quick log; logging occurs via per-item Finish/Partial actions

  // KPIs & Goals
  const plannedToday = useMemo(() => plan.items.reduce((s,it)=>s+(Number(it.minutes)||0),0), [plan.items]);
  const totalPlannedLabel = useMemo(() => minutesStr(plannedToday), [plannedToday]);
  const weekKeys = useMemo(() => weekKeysChicago(new Date()), []);
  const loggedWeek = useMemo(() => (sessions||[]).filter((s:any) => weekKeys.includes(chicagoYmd(new Date(s.when)))).reduce((sum:number, s:any)=>sum+(s.minutes||0),0), [sessions, weekKeys]);
  const weekOnPace = useMemo(() => {
    // Planned this week
    const plannedWeek = (schedule||[]).filter(b => weekKeys.includes(b.day)).reduce((s,b)=>s+(b.plannedMinutes||0),0);
    if (plannedWeek<=0) return { label: 'No plan', delta: 0 } as const;
    // Logged this week
    const loggedWeekLocal = loggedWeek;
    // Workdays this week (availability>0)
    const avail = (typeof window!=='undefined' ? (JSON.parse(window.localStorage.getItem(LS_AVAIL)||'{}')||{}) : {}) as Record<number,number>;
    const monday = mondayOfChicago(new Date());
    const todayIdx = (new Date(chicagoYmd(new Date())).getTime() - monday.getTime())/(24*3600*1000);
    const daysArr = Array.from({length:7},(_,i)=>{ const x=new Date(monday); x.setDate(x.getDate()+i); return x; });
    const totalWork = daysArr.filter(d => (avail[d.getDay()]||0) > 0).length || 7;
    const elapsedWork = daysArr.filter((d,i)=> i <= todayIdx && (avail[d.getDay()]||0) > 0).length || 1;
    const expectedByNow = Math.round(plannedWeek * (elapsedWork/totalWork));
    const delta = loggedWeekLocal - expectedByNow;
    return { label: delta>=0? 'On pace' : 'Behind', delta } as const;
  }, [sessions, schedule, weekKeys]);

  // Availability & capacity
  const availabilityByDow = useMemo(() => (typeof window!=='undefined' ? (JSON.parse(window.localStorage.getItem(LS_AVAIL)||'{}')||{}) : {}) as Record<number,number>, [plan.items]);
  const availabilityWeekTotal = useMemo(() => Object.values(availabilityByDow).reduce((s,v)=>s+Math.max(0, Number(v)||0), 0), [availabilityByDow]);
  const todayDow = useMemo(() => { const [y,m,da] = dateKey.split('-').map(x=>parseInt(x,10)); return new Date(y,(m as number)-1,da).getDay(); }, [dateKey]);
  const todayCapacity = useMemo(() => Math.max(0, Number(availabilityByDow[todayDow]||0)), [availabilityByDow, todayDow]);
  const remainingTodayCapacity = useMemo(() => Math.max(0, todayCapacity - plannedToday), [todayCapacity, plannedToday]);

  const workdaysLeft = useMemo(() => {
    // Include today only if remaining capacity > 0; future days if availability > 0
    const keys = weekKeys;
    const todayIdx = keys.indexOf(dateKey);
    const future = keys.slice(Math.max(0,todayIdx+1)).filter(k => {
      const [y,m,da] = k.split('-').map(x=>parseInt(x,10)); const d = new Date(y,(m as number)-1,da); return (availabilityByDow[d.getDay()]||0) > 0;
    }).length;
    const includeToday = remainingTodayCapacity > 0 ? 1 : 0;
    return includeToday + future;
  }, [dateKey, weekKeys, availabilityByDow, remainingTodayCapacity]);

  const globalGoalMinutes = useMemo(() => (goals.find(g => g.scope==='global')?.weeklyMinutes || 0), [goals]);
  const effectiveGoalMinutes = useMemo(() => (globalGoalMinutes>0 ? globalGoalMinutes : availabilityWeekTotal), [globalGoalMinutes, availabilityWeekTotal]);
  const loggedToDate = useMemo(() => {
    const todayIdx = weekKeys.indexOf(dateKey);
    return (sessions||[]).filter((s:any) => { const k = chicagoYmd(new Date(s.when)); const i = weekKeys.indexOf(k); return i !== -1 && i <= todayIdx; }).reduce((sum:number, s:any)=>sum+(s.minutes||0),0);
  }, [sessions, weekKeys, dateKey]);
  const weeklyNeeded = useMemo(() => Math.max(0, effectiveGoalMinutes - loggedToDate), [effectiveGoalMinutes, loggedToDate]);
  const dailyQuota = useMemo(() => Math.ceil(weeklyNeeded / Math.max(workdaysLeft, 1)), [weeklyNeeded, workdaysLeft]);
  const hoursPerDayNeeded = useMemo(() => {
    if (effectiveGoalMinutes <= 0) return 0;
    const remaining = Math.max(0, effectiveGoalMinutes - loggedToDate);
    const daysLeft = Math.max(1, workdaysLeft);
    return Math.max(0, remaining / daysLeft) / 60;
  }, [effectiveGoalMinutes, loggedToDate, workdaysLeft]);
  const globalProgressPct = useMemo(() => {
    if (effectiveGoalMinutes <= 0) return 0;
    return Math.min(1, loggedWeek / effectiveGoalMinutes);
  }, [loggedWeek, effectiveGoalMinutes]);

  // Focus Insights (rolling averages and best window)
  const startYMD30 = useMemo(() => {
    const today = new Date();
    const ymdToday = chicagoYmd(today);
    const parts = ymdToday.split('-').map(v => parseInt(v, 10));
    const d0 = new Date(parts[0], (parts[1] as number)-1, parts[2]);
    const start = new Date(d0); start.setDate(start.getDate() - 29);
    return chicagoYmd(start);
  }, []);
  function avgFocusSince(days: number) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const vals: number[] = [];
    for (const s of (sessions||[])) {
      if (s?.focus == null) continue;
      const ts = new Date(s.when).getTime();
      if (ts >= cutoff) vals.push(s.focus);
    }
    if (vals.length === 0) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const focus7 = useMemo(() => avgFocusSince(7), [sessions]);
  const focus14 = useMemo(() => avgFocusSince(14), [sessions]);
  const focus30 = useMemo(() => avgFocusSince(30), [sessions]);
  const bestWindow = useMemo(() => {
    const hour = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));
    for (const s of (sessions||[])) {
      if (s?.focus == null) continue;
      const ymd = chicagoYmd(new Date(s.when));
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
    return best;
  }, [sessions, startYMD30]);
  const slump = useMemo(() => {
    let n30 = 0;
    for (const s of (sessions||[])) {
      if (s?.focus == null) continue;
      const ymd = chicagoYmd(new Date(s.when));
      if (ymd >= startYMD30) n30 += 1;
    }
    const falling = focus14 < (focus30 - 1.0);
    return { isSlump: falling && n30 >= 10, n30 };
  }, [sessions, focus14, focus30, startYMD30]);

  // Reading stats per plan item using assignedSegments and logs (read beats skim)
  const readingStatsByItem = useMemo(() => {
    const out: Record<string, { assignedIv: Interval[]; assignedLabel: string; remainingIv: Interval[]; remainingLabel: string; pagesLeft: number|null; pph: number; etaMinutes: number; loggedMinutes: number; showRemaining: boolean }> = {};
    try {
      for (const it of plan.items) {
        const canon = canonicalTaskIdForItem(it, plan.dateKey, schedule, tasks) || it.id;
        const taskObj: any = (tasks||[]).find((t:any) => (t?.id===canon) || (t?.title===it.title && (t?.course||'')===(it.course||'')) ) || null;
        const assignedNorm = normalizeRanges((taskObj as any)?.assignedSegments || null);
        const assignedIv = assignedUnion(assignedNorm);
        const assignedLabel = formatRanges(assignedIv);
        // Build logs array for this task from sessions; our sessions may not include ranges/pages arrays -> hasPageInfo may be false
        const logs: LogEntry[] = (sessions||[]).filter((s:any)=> (s?.taskId===canon)).map((s:any)=>({ mode: (s?.mode||null) as any, ranges: (Array.isArray(s?.ranges)?s.ranges:null), pages: (Array.isArray(s?.pages)?s.pages:null), minutes: Number(s?.minutes)||0 })) as LogEntry[];
        const cmp = completedUnion(logs);
        const remainingIv = remainingUnion(assignedIv, cmp.iv);
        const pagesLeft = (assignedIv.length>0 && cmp.hasPageInfo) ? countPages(remainingIv) : (assignedIv.length>0 && cmp.hasPageInfo===false ? null : 0);
        const pph = pagesPerHourForCourse(it.course) || 18;
        const etaMinutes = (typeof pagesLeft==='number' && pagesLeft!=null) ? Math.ceil((pagesLeft / Math.max(pph,0.1)) * 60) : Math.max(1, Math.round(Number(it.minutes)||0));
        const loggedMinutes = (sessions||[]).filter((s:any)=>s?.taskId===canon).reduce((sum:number,s:any)=>sum + Math.max(0, Number(s?.minutes)||0), 0);
        const remainingLabel = (typeof pagesLeft==='number' && pagesLeft!=null) ? formatRanges(remainingIv) : '';
        out[it.id] = { assignedIv, assignedLabel, remainingIv, remainingLabel, pagesLeft, pph: Math.round(pph), etaMinutes, loggedMinutes, showRemaining: (assignedIv.length>0 && cmp.hasPageInfo) };
      }
    } catch {}
    return out;
  }, [plan.items, plan.dateKey, schedule, tasks, sessions]);

  function statsForTaskId(taskId: string, title: string, course: string) {
    try {
      // Find canonical task and id
      const t:any = (tasks||[]).find((x:any)=>x.id===taskId || (x.title===title && (x.course||'')===(course||''))) || null;
      const canonId = (t && typeof t.id==='string') ? t.id : taskId;
      // Assigned intervals: prefer assignedSegments; fallback to ranges parsed from title
      const assignedNorm = normalizeRanges((t as any)?.assignedSegments || null);
      let assignedIv = assignedUnion(assignedNorm);
      if (!assignedIv.length) {
        const chips = extractPageRanges(String(title||''));
        const iv = parseIntervalsFromRangeString(chips.join(', '));
        assignedIv = iv;
      }
      // Logs by canonical id if available
      const logs: LogEntry[] = (sessions||[])
        .filter((s:any)=> (s?.taskId===canonId))
        .map((s:any)=>({ mode: (s?.mode||null) as any, ranges: (Array.isArray(s?.ranges)?s.ranges:null), pages: (Array.isArray(s?.pages)?s.pages:null), minutes: Number(s?.minutes)||0 })) as LogEntry[];
      const cmp = completedUnion(logs);
      const remainingIv = assignedIv.length ? remainingUnion(assignedIv, cmp.iv) : [];
      // If no page info in logs, treat remaining as assigned (we still want to show ranges and ETA)
      const hasIv = assignedIv.length>0;
      const pagesLeft = hasIv ? (cmp.hasPageInfo ? countPages(remainingIv) : countPages(assignedIv)) : null;
      const pph = pagesPerHourForCourse(course) || 18;
      const etaMinutes = (typeof pagesLeft==='number' && pagesLeft!=null) ? Math.ceil((pagesLeft / Math.max(pph,0.1)) * 60) : 0;
      const remainingLabel = hasIv ? formatRanges(cmp.hasPageInfo ? remainingIv : assignedIv) : '';
      return { pagesLeft, pph: Math.round(pph), etaMinutes, remainingLabel, showRemaining: hasIv };
    } catch { return { pagesLeft:null, pph:18, etaMinutes:0, remainingLabel:'', showRemaining:false }; }
  }

  // Streaks (Chicago local dates)
  const activeDaysSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of (sessions||[])) {
      const ymd = chicagoYmd(new Date(s.when));
      const mins = Math.max(0, Number(s.minutes)||0);
      if (mins > 0) set.add(ymd);
    }
    return set;
  }, [sessions]);
  const streakDays = useMemo(() => {
    const today = chicagoYmd(new Date());
    let cnt = 0; let cur = today;
    while (activeDaysSet.has(cur)) { cnt += 1; cur = ymdAddDays(cur, -1); }
    return cnt;
  }, [activeDaysSet]);
  const longestStreak = useMemo(() => {
    // Sort unique active days and scan
    const days = Array.from(activeDaysSet).sort();
    if (days.length === 0) return 0;
    let best = 1, cur = 1;
    for (let i=1;i<days.length;i++) {
      const prev = days[i-1]; const next = days[i];
      const adj = ymdAddDays(prev, 1);
      if (adj === next) { cur += 1; } else { best = Math.max(best, cur); cur = 1; }
    }
    best = Math.max(best, cur);
    return best;
  }, [activeDaysSet]);

  // Gentle Nudges (in-app banner only)
  const [showNudge, setShowNudge] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      try {
        if (typeof window === 'undefined') return;
        const enabled = (window.localStorage.getItem('nudgesEnabled')||'false')==='true';
        if (!enabled) { setShowNudge(false); return; }
        const reminder = window.localStorage.getItem('nudgesReminderTime') || '20:00';
        const quietS = window.localStorage.getItem('nudgesQuietStart') || '22:00';
        const quietE = window.localStorage.getItem('nudgesQuietEnd') || '07:00';
        const maxPerWeek = Math.max(0, parseInt(window.localStorage.getItem('nudgesMaxPerWeek')||'3',10)||3);
        // Chicago now
        const now = new Date();
        const hhParts = new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(now);
        const HH = parseInt(hhParts.find(p=>p.type==='hour')?.value||'0',10);
        const MM = parseInt(hhParts.find(p=>p.type==='minute')?.value||'0',10);
        const hhmm = `${String(HH).padStart(2,'0')}:${String(MM).padStart(2,'0')}`;
        const todayY = chicagoYmd(now);
        // today's minutes
        const minsToday = (sessions||[]).filter(s=>chicagoYmd(new Date(s.when))===todayY).reduce((s,a)=>s+(a.minutes||0),0);
        if (minsToday > 0) { setShowNudge(false); return; }
        // not in quiet hours
        function toMin(s:string){ const [h,m]=s.split(':').map(x=>parseInt(x,10)); return (h*60 + m + 1440) % 1440; }
        const curMin = toMin(hhmm), qs = toMin(quietS), qe = toMin(quietE);
        const inQuiet = qs <= qe ? (curMin>=qs && curMin<qe) : (curMin>=qs || curMin<qe);
        if (inQuiet) { setShowNudge(false); return; }
        // after reminder time
        const remMin = toMin(reminder);
        if (curMin < remMin) { setShowNudge(false); return; }
        // limit per week
        const monday = mondayOfChicago(now); const wk = chicagoYmd(monday);
        const storedWk = window.localStorage.getItem('nudgesWeekKey') || '';
        let cnt = parseInt(window.localStorage.getItem('nudgesWeekCount')||'0',10)||0;
        if (storedWk !== wk) { cnt = 0; window.localStorage.setItem('nudgesWeekKey', wk); window.localStorage.setItem('nudgesWeekCount','0'); }
        if (cnt >= maxPerWeek) { setShowNudge(false); return; }
        // once per day
        const lastY = window.localStorage.getItem('nudgesLastShownYMD') || '';
        const dismissedY = window.localStorage.getItem('nudgesDismissedYMD') || '';
        if (lastY === todayY || dismissedY === todayY) { setShowNudge(false); return; }
        // show
        setShowNudge(true);
        window.localStorage.setItem('nudgesLastShownYMD', todayY);
        window.localStorage.setItem('nudgesWeekKey', wk);
        window.localStorage.setItem('nudgesWeekCount', String(cnt+1));
      } catch {}
    }, 30000);
    // run once quickly
    setTimeout(() => { try { /* call same logic */ } catch {} }, 0);
    return () => clearInterval(t);
  }, [sessions]);

  function setGlobalGoalHours(h: number) {
    const mins = Math.max(0, Math.round(h * 60));
    setGoals(prev => {
      const arr = prev.slice();
      const idx = arr.findIndex(g => g.scope==='global');
      if (idx >= 0) arr[idx] = { ...arr[idx], weeklyMinutes: mins };
      else arr.push({ id: 'global', scope: 'global', weeklyMinutes: mins });
      return arr;
    });
  }

  // UI
  return (
    <main className="space-y-6">
      {/* Countdown widget */}
      <section className="card p-4">
        {(() => {
          const todayYmd = chicagoYmd(new Date());
          // Finals list (fixed)
          const finals = [
            { ymd: '2025-12-12', label: 'Final — Amateur Sports Law' },
            { ymd: '2025-12-17', label: 'Final — Intellectual Property' },
          ];
          const nextFinal = finals.find(f => f.ymd >= todayYmd);
          const gradYmd = '2027-05-15';
          const fLine = nextFinal ? (() => {
            const d = diffMonthsWeeksDays(todayYmd, nextFinal.ymd);
            return `Next Final: ${d.months} ${d.months===1?'month':'months'}, ${d.weeks} ${d.weeks===1?'week':'weeks'}, ${d.days} ${d.days===1?'day':'days'}`;
          })() : null;
          const g = diffYearsMonthsDays(todayYmd, gradYmd);
          const gLine = `Graduation: ${g.years} ${g.years===1?'year':'years'}, ${g.months} ${g.months===1?'month':'months'}, ${g.days} ${g.days===1?'day':'days'}`;
          return (
            <div className="text-sm leading-5">
              {fLine ? <div className="text-slate-200">{fLine}</div> : null}
              <div className="text-slate-300/80">{gLine}</div>
            </div>
          );
        })()}
      </section>
      {/* Availability notification banner */}
      {(() => {
        const dow = new Date().getDay();
        const availMins = availability[dow] ?? 0;
        const plannedMins = todaysBlocks.reduce((s, b) => s + (b.plannedMinutes || 0), 0);
        const loggedMins = sessions.filter((s: any) => chicagoYmd(new Date(s.when)) === dateKey).reduce((s: number, x: any) => s + (x.minutes || 0), 0);
        const remaining = Math.max(0, plannedMins - loggedMins);
        const free = Math.max(0, availMins - plannedMins);
        if (availMins === 0) return null;
        return (
          <section className="rounded-xl border border-white/10 bg-gradient-to-r from-emerald-900/20 to-blue-900/20 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-slate-300/70">Available:</span>
                <span className="font-medium text-emerald-400">{minutesToHM(availMins)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-300/70">Planned:</span>
                <span className="font-medium text-blue-400">{minutesToHM(plannedMins)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-300/70">Logged:</span>
                <span className="font-medium text-purple-400">{minutesToHM(loggedMins)}</span>
              </div>
            </div>
            <div className="text-xs text-slate-300/60">
              {remaining > 0 ? `${minutesToHM(remaining)} left to complete` : 'All planned work complete!'} 
              {free > 0 ? ` · ${minutesToHM(free)} free` : ''}
            </div>
          </section>
        );
      })()}
      <section className="card p-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-medium">Today</h2>
            <p className="text-xs text-slate-300/60">Central time · {dateKey} · {ctNow}</p>
          </div>
          <div className="text-xs text-slate-300/80">Today’s Plan comes from your schedule.</div>
        </div>

        {/* Wizard disabled per request */}
        {false && !plan.locked && (
          <div className="space-y-4">
            {step===1 && (
              <div className="rounded border border-[#1b2344] p-4 space-y-3">
                <div className="text-sm font-medium">Step 1 · Choose today’s work</div>
                {/* Preload today’s scheduled */}
                <div>
                  <div className="text-xs text-slate-300/70 mb-1">From schedule</div>
                  {todaysBlocks.length===0 ? (
                    <div className="text-xs text-slate-300/80 rounded border border-dashed border-[#1b2344] p-3">No items scheduled for today. Add from Backlog below or click <button onClick={()=>setStep(2)} className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Next</button> to confirm minutes.</div>
                  ) : (
                    <ul className="text-sm space-y-1">
                      {todaysBlocks.map(b => (
                        <li key={b.id} className="flex items-center justify-between">
                          <span className="truncate">{b.course ? `${b.course}: ` : ''}{b.title} · {minutesToHM(b.plannedMinutes)}</span>
                          {!plan.items.find(p=>p.id===b.taskId) && (
                            <button aria-label="Add from schedule" onClick={()=>addFromBacklog({ id:b.taskId, title:b.title, course:b.course, estimatedMinutes:b.plannedMinutes })} className="px-2 py-1 rounded border border-[#1b2344] text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Add</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* Suggestions from inbox */}
                <div>
                  <div className="text-xs text-slate-300/70 mb-1">Add 1–2 from Inbox</div>
                  <ul className="text-sm space-y-1">
                    {backlogSorted.slice(0,5).map(it => (
                      <li key={it.id} className="flex items-center justify-between">
                        <span className="truncate">{it.course ? `${it.course}: ` : ''}{it.title}</span>
                        <button aria-label="Add from backlog" onClick={()=>addFromBacklog(it)} className="px-2 py-1 rounded border border-[#1b2344] text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" disabled={!!plan.items.find(p=>p.id===it.id)}>Add</button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center gap-2">
                  <button aria-label="Go to Step 2" onClick={()=>setStep(2)} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" disabled={plan.items.length===0}>Next</button>
                </div>
              </div>
            )}
            {step===2 && (
              <div className="rounded border border-[#1b2344] p-4 space-y-3">
                <div className="text-sm font-medium">Step 2 · Confirm minutes & order</div>
                <ul className="space-y-2">
                  {plan.items.map((it, idx) => { const st = readingStatsByItem[it.id]; return (
                    <li key={it.id} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-200 truncate">{it.course ? `${it.course}: `:''}{stripControlChars(it.title)}</div>
                        {st && st.assignedLabel ? (
                          <div className="text-[11px] text-slate-300/70">Assigned: {st.assignedLabel}</div>
                        ) : null}
                        {st && st.showRemaining ? (
                          <div className="text-[11px] text-slate-300/70">Remaining: {st.remainingLabel} ({st.pagesLeft}p)</div>
                        ) : (
                          <div className="text-[11px] text-slate-300/60">Est. {minutesToHM(Math.max(1, Math.round(Number(it.minutes)||0)))}</div>
                        )}
                      </div>
                      <label htmlFor={`minutes-${it.id}`} className="sr-only">Minutes for {it.title}</label>
                      <input id={`minutes-${it.id}`} type="number" min={5} step={5} value={it.minutes} onChange={e=>setPlan(p=>({ ...p, items: p.items.map(x=>x.id===it.id?{...x, minutes: parseInt(e.target.value||'0',10)||0}:x) }))} className="w-20 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
                      <div className="flex items-center gap-1">
                        <button aria-label="Move up" onClick={()=>moveItem(it.id,-1)} className="px-2 py-1 rounded border border-[#1b2344] text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" disabled={idx===0}>↑</button>
                        <button aria-label="Move down" onClick={()=>moveItem(it.id, 1)} className="px-2 py-1 rounded border border-[#1b2344] text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" disabled={idx===plan.items.length-1}>↓</button>
                        <button aria-label="Remove item" onClick={()=>removeItem(it.id)} className="px-2 py-1 rounded border border-rose-600 text-rose-400 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Remove</button>
                      </div>
                    </li>
                  );})}
                </ul>
                <div className="flex items-center gap-2">
                  <button aria-label="Back to Step 1" onClick={()=>setStep(1)} className="px-3 py-2 rounded border border-[#1b2344] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">Back</button>
                  <button aria-label="Confirm Plan" onClick={lockPlan} className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">Confirm</button>
                </div>
              </div>
            )}
          </div>
        )}

        {editModal && (
          <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={()=>setEditModal(null)} />
            <div className="relative z-10 w-[92vw] max-w-md bg-[#0b1020] border border-[#1b2344] rounded p-4">
              <div className="text-sm font-medium mb-2">Edit Task</div>
              <div className="grid grid-cols-1 gap-2 text-sm">
                <label className="block"> <span className="block text-xs text-slate-300/70 mb-1">Title</span>
                  <input value={editForm.title} onChange={e=>setEditForm(f=>({...f, title: e.target.value}))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                </label>
                <label className="block"> <span className="block text-xs text-slate-300/70 mb-1">Notes</span>
                  <input value={editForm.notes} onChange={e=>setEditForm(f=>({...f, notes: e.target.value}))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                </label>
                <label className="flex items-center justify-between gap-2"> <span className="text-xs text-slate-300/70">Estimate (min)</span>
                  <input type="number" min={0} step={5} value={editForm.estimate} onChange={e=>setEditForm(f=>({...f, estimate: e.target.value}))} className="w-28 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                </label>
                <label className="block"> <span className="block text-xs text-slate-300/70 mb-1">Assigned page segments</span>
                  <input placeholder="449-486,505-520; 90-105" value={editForm.segments} onChange={e=>setEditForm(f=>({...f, segments: e.target.value}))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                </label>
                <label className="flex items-center justify-between gap-2"> <span className="text-xs text-slate-300/70">Course PPH</span>
                  <input type="number" min={1} step={1} value={editForm.pph} onChange={e=>setEditForm(f=>({...f, pph: e.target.value}))} className="w-28 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                </label>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button onClick={saveEdit} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500">Save</button>
                <button onClick={()=>setEditModal(null)} className="px-3 py-2 rounded border border-[#1b2344]">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Plan + Tomorrow preview */}
        <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-6 xl:max-w-[1600px] mx-auto px-6 md:px-8">
          <div className="min-h-[140px]">
            <h3 className="text-sm font-medium mb-2">Today’s Plan</h3>
            {plan.items.length===0 ? (
              <div className="text-xs text-slate-300/80">No items yet. Today’s Plan comes from your schedule.</div>
            ) : (
              <ul className="space-y-3">
                {plan.items.map((it, i) => {
                  const st = readingStatsByItem[it.id] || { assignedIv: [], assignedLabel: '', remainingIv: [], remainingLabel: '', pagesLeft: null as number|null, pph: pagesPerHourForCourse(it.course), etaMinutes: Math.max(1, Math.round(Number(it.minutes)||0)), loggedMinutes: (sessions||[]).filter((s:any)=>s?.taskId===it.id).reduce((a:number,s:any)=>a+(Number(s?.minutes)||0),0), showRemaining: false };
                  // Use task's estimatedMinutes or item.minutes as fallback
                  const displayEta = Math.max(1, Number(it.minutes) || st.etaMinutes || 30);
                  const pct = Math.min(100, Math.round((st.loggedMinutes/Math.max(st.etaMinutes,1))*100));
                  return (
                    <li key={it.id} className="rounded-2xl p-5 md:p-6 border border-white/10 bg-white/5" style={{ borderLeft: `3px solid ${courseColor(it.course)}` }}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="mb-1">
                            {it.course ? <span className="mr-2 inline-flex items-center text-[11px] px-1.5 py-0.5 rounded border border-white/10 text-white/80" style={{ backgroundColor: 'transparent' }}>{it.course}</span> : null}
                            <span className="text-lg font-semibold align-middle line-clamp-2" title={stripControlChars(it.title)}>{(() => { const c = String(it.course||''); const raw = stripControlChars(String(it.title||'')); const lc = c.toLowerCase(); const lraw = raw.toLowerCase(); if (lc && (lraw.startsWith(lc+':') || lraw.startsWith(lc+' -') || lraw.startsWith(lc+' —') || lraw.startsWith(lc+' –'))) { return raw.slice(c.length+1).trimStart(); } return raw; })()}</span>
                          </div>
                          {st.showRemaining ? (
                            <div className="text-sm text-slate-200"><span className="font-medium">Remaining:</span> {st.remainingLabel} <span className="text-slate-300/70">({st.pagesLeft}p)</span></div>
                          ) : null}
                          {st.assignedLabel ? (
                            <div className="text-xs text-white/60 mt-0.5">Assigned: {st.assignedLabel}</div>
                          ) : null}
                          <div className="mt-3 h-1 bg-white/10 rounded overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Elapsed vs estimate">
                            <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="w-[420px] min-w-[420px] flex-shrink-0 flex flex-col items-end gap-2">
                          <div className="inline-flex items-center gap-3">
                            {/* Timer display */}
                            {(() => {
                              const secs = Math.max(0, Number(itemSeconds[it.id] || 0)) + (activeItemId === it.id && itemStartAt[it.id] ? Math.floor((nowTs - itemStartAt[it.id]) / 1000) : 0);
                              return secs > 0 ? (
                                <div className="px-2 py-0.5 rounded-md text-sm bg-blue-600/30 border border-blue-600/50 font-mono">
                                  {mmss(secs)}
                                </div>
                              ) : null;
                            })()}
                            <div className="px-2 py-0.5 rounded-md text-sm bg-white/10 leading-tight">
                              <div className="text-right">
                                <div className="font-medium">Est. {minutesToHM(displayEta)}</div>
                                {typeof st.pagesLeft==='number' && st.pagesLeft > 0 ? (<div className="text-[11px] text-white/70">{st.pagesLeft}p @ {st.pph}pph</div>) : null}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-nowrap">
                            {activeItemId === it.id ? (
                              <button aria-label="Pause item timer" onClick={pauseItemTimer} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Stop</button>
                            ) : (
                              <button aria-label="Start item timer" onClick={()=>startItemTimer(it.id)} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Start</button>
                            )}
                            <button aria-label="Recalculate from logs" onClick={()=>recalcFromSessions(it)} className="px-2 py-1 rounded border border-emerald-700 text-emerald-300 text-xs">Recalc</button>
                            <button aria-label="Partial complete" onClick={()=>openLogFor(it.id,'partial')} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Partial</button>
                            <button aria-label="Finish task" onClick={()=>openLogFor(it.id,'finish')} className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs">Finish</button>
                            <button aria-label="Reset item timer" onClick={()=>resetTimer(it.id)} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Reset</button>
                            <button aria-label="Edit task" onClick={()=>openEditFor(it.id)} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Edit</button>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {plan.locked && (
              <div className="text-xs text-slate-300/70 mt-2">Locked · Total {totalPlannedLabel}</div>
            )}
          </div>
          <div className="rounded border border-[#1b2344] p-4 min-h-[140px]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Preview</h3>
              <div className="flex items-center gap-2 text-xs">
                <div className="inline-flex rounded border border-[#1b2344] overflow-hidden">
                  <button onClick={()=>setRightMode('day')} className={`px-2 py-1 ${rightMode==='day'?'bg-emerald-600':'bg-transparent'}`}>Day</button>
                  <button onClick={()=>setRightMode('week')} className={`px-2 py-1 ${rightMode==='week'?'bg-emerald-600':'bg-transparent'}`}>Week</button>
                </div>
                <div className="inline-flex items-center gap-1">
                  <button onClick={()=>{ setSelectedKey(k=>ymdAddDays(k, rightMode==='day'? -1 : -7)); }} className="px-2 py-1 rounded border border-[#1b2344]">◀</button>
                  <button onClick={()=>{ setSelectedKey(k=>ymdAddDays(k, rightMode==='day'? 1 : 7)); }} className="px-2 py-1 rounded border border-[#1b2344]">▶</button>
                  <button onClick={()=>{ const today = chicagoYmd(new Date()); setSelectedKey(today); }} className="px-2 py-1 rounded border border-[#1b2344]">Today</button>
                </div>
              </div>
            </div>
            {rightMode==='day' ? (
              <>
                <div className="text-xs text-slate-300/70 mb-2">
                  {(() => {
                    const [y,m,da] = selectedKey.split('-').map(x=>parseInt(x,10));
                    const d = new Date(y,(m as number)-1,da);
                    const w = d.toLocaleDateString(undefined, { weekday: 'long' });
                    const md = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                    const isToday = selectedKey === chicagoYmd(new Date());
                    return (
                      <span>
                        <span className="text-slate-200 font-medium">{w}</span> · {md}
                        {isToday ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-600/30 border border-blue-600/60 text-blue-300">Today</span> : null}
                      </span>
                    );
                  })()}
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-slate-300/70 mb-1">Scheduled</div>
                    {selectedBlocks.length===0 ? (
                      <div className="text-[11px] text-slate-300/60">—</div>
                    ) : (
                      <ul className="space-y-2">
                        {selectedBlocks.map((b, i) => { const st = statsForTaskId(b.taskId, b.title, b.course); const pct = st.etaMinutes>0 ? 0 : 0; const fallbackMin = (() => { const pm = Math.max(0, Math.round(Number(b.plannedMinutes)||0)); if (pm>0) return pm; const t:any = (tasks||[]).find((x:any)=>x.id===b.taskId) || null; const est = Math.max(0, Math.round(Number(t?.estimatedMinutes)||0)); if (est>0) return est; const chips = extractPageRanges(String(b.title||'')); if (chips.length>0) { const cnt = pagesInIntervals(parseIntervalsFromRangeString(chips.join(', '))); const mpp = minutesPerPageForCourse(b.course); return Math.max(1, Math.round(cnt * mpp)); } return 30; })(); return (
                          <li key={b.id} className="rounded-2xl p-3 border border-white/10 bg-white/5 flex items-start justify-between gap-2" style={{ borderLeft: `3px solid ${courseColor(b.course)}` }}>
                            <div className="min-w-0">
                              <div className="text-sm">
                                {b.course ? <span className="mr-2 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-white/80">{b.course}</span> : null}
                                <span className="font-medium align-middle line-clamp-2" title={stripControlChars(b.title)}>{(() => { const c = String(b.course||''); const raw = stripControlChars(String(b.title||'')); const lc = c.toLowerCase(); const lraw = raw.toLowerCase(); if (lc && (lraw.startsWith(lc+':') || lraw.startsWith(lc+' -') || lraw.startsWith(lc+' —') || lraw.startsWith(lc+' –'))) { return raw.slice(c.length+1).trimStart(); } return raw; })()}</span>
                              </div>
                              {st.showRemaining ? (
                                <div className="text-[12px] text-slate-200"><span className="font-medium">Remaining:</span> {st.remainingLabel} <span className="text-slate-300/70">({st.pagesLeft}p)</span></div>
                              ) : null}
                            </div>
                            <div className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-white/10 leading-tight">
                              <div className="text-right">
                                <div className="font-medium">{st.pagesLeft==null?`Est. ${minutesToHM(Math.max(1, fallbackMin))}`:minutesToHM(Math.max(1, st.etaMinutes))}</div>
                                {typeof st.pagesLeft==='number' && st.pagesLeft > 0 ? (<div className="text-[10px] text-white/70">{st.pagesLeft}p @ {st.pph}pph</div>) : null}
                              </div>
                            </div>
                          </li>
                        ); })}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-slate-300/70 mb-1">Due</div>
                    {tasksDueSelected.length===0 ? (
                      <div className="text-[11px] text-slate-300/60">—</div>
                    ) : (
                      <ul className="text-sm space-y-2">
                        {tasksDueSelected.map((t:any) => (
                          <li key={t.id} className="space-y-0.5">
                            <div className="text-slate-200 break-words whitespace-pre-wrap">
                              {t.course ? <span className="mr-2 inline-flex items-center text-[11px] px-1.5 py-0.5 rounded border border-[#1b2344] text-slate-300/80">{t.course}</span> : null}
                              {(() => { const raw = String(t.title || ''); const c = String(t.course||''); const lc = c.toLowerCase(); const lraw = raw.toLowerCase(); if (lc && (lraw.startsWith(lc+':') || lraw.startsWith(lc+' -') || lraw.startsWith(lc+' —') || lraw.startsWith(lc+' –'))) { return raw.slice(c.length+1).trimStart(); } return raw; })()}
                            </div>
                            {(() => { const chips = (() => { const arr = extractPageRanges(String(t.title||'')); if (arr.length===0 && typeof t.pagesRead==='number' && t.pagesRead>0) return [String(t.pagesRead)+'p']; return arr; })(); return chips.length ? (
                              <div className="flex flex-wrap gap-1 text-[11px] text-slate-300/80">
                                {chips.map((ch:string, i:number) => (<span key={i} className="px-1.5 py-0.5 rounded border border-[#1b2344]">{ch}</span>))}
                              </div>
                            ) : null; })()}
                            {typeof t.estimatedMinutes === 'number' ? <div className="text-xs text-slate-300/70">{minutesToHM(t.estimatedMinutes)}</div> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-slate-300/70 mb-2">Week of {selectedWeekKeys[0]}—{selectedWeekKeys[6]}</div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-slate-300/70 mb-1">Scheduled (Week)</div>
                    {weekBlocks.length===0 ? (
                      <div className="text-[11px] text-slate-300/60">—</div>
                    ) : (
                      <ul className="text-sm space-y-1">
                        {weekBlocks.map(b => (
                          <li key={b.id} className="flex items-center justify-between">
                            <span className="truncate">{b.day} · {b.course ? `${b.course}: ` : ''}{b.title}</span>
                            <span className="text-slate-300/70">{minutesToHM(b.plannedMinutes)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-slate-300/70 mb-1">Due (Week)</div>
                    {weekDueTasks.length===0 ? (
                      <div className="text-[11px] text-slate-300/60">—</div>
                    ) : (
                      <ul className="text-sm space-y-2">
                        {weekDueTasks.map((t:any) => (
                          <li key={t.id} className="space-y-0.5">
                            <div className="text-slate-200 break-words whitespace-pre-wrap">
                              <span className="mr-2 text-xs text-slate-300/70">{chicagoYmd(new Date(t.dueDate))}</span>
                              {t.course ? <span className="mr-2 inline-flex items-center text-[11px] px-1.5 py-0.5 rounded border border-[#1b2344] text-slate-300/80">{t.course}</span> : null}
                              {(() => { const raw = String(t.title || ''); const c = String(t.course||''); const lc = c.toLowerCase(); const lraw = raw.toLowerCase(); if (lc && (lraw.startsWith(lc+':') || lraw.startsWith(lc+' -') || lraw.startsWith(lc+' —') || lraw.startsWith(lc+' –'))) { return raw.slice(c.length+1).trimStart(); } return raw; })()}
                            </div>
                            {(() => { const chips = (() => { const arr = extractPageRanges(String(t.title||'')); if (arr.length===0 && typeof t.pagesRead==='number' && t.pagesRead>0) return [String(t.pagesRead)+'p']; return arr; })(); return chips.length ? (
                              <div className="flex flex-wrap gap-1 text-[11px] text-slate-300/80">
                                {chips.map((ch:string, i:number) => (<span key={i} className="px-1.5 py-0.5 rounded border border-[#1b2344]">{ch}</span>))}
                              </div>
                            ) : null; })()}
                            {typeof t.estimatedMinutes === 'number' ? <div className="text-xs text-slate-300/70">{minutesToHM(t.estimatedMinutes)}</div> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {logModal && (
          <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={()=>setLogModal(null)} />
            <div className="relative z-10 w-[92vw] max-w-lg bg-[#0b1020] border border-[#1b2344] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-lg font-medium">{logModal.mode==='finish' ? 'Complete Task' : 'Log Partial Progress'}</div>
                <button onClick={()=>setLogModal(null)} className="text-slate-400 hover:text-white text-lg">×</button>
              </div>
              
              {(() => {
                const it = plan.items.find(x => x.id === (logModal?.itemId||''));
                const total = it ? countPagesFromTitle(String(it.title||'')) : 0;
                const titleRangesStr = it ? (extractPageRanges(String(it.title||''))||[]).join(', ') : '';
                const titleIntervals = parseIntervalsFromRangeString(titleRangesStr);
                const readIntervals = parseIntervalsFromRangeString(logForm.pages||'');
                const pagesRead = pagesInIntervals(readIntervals);
                const remaining = subtractIntervals(titleIntervals, readIntervals);
                const remainLabel = intervalsToLabel(remaining);
                const pagesRemaining = pagesInIntervals(remaining);
                const parsedMin = parseMinutesFlexible(logForm.minutes||'');
                const minsHint = parsedMin!=null ? ` (${parsedMin}m)` : '';
                const mpp = it ? minutesPerPageForCourse(it.course) : minutesPerPage();
                const estMins = pagesRead>0 ? Math.max(1, Math.round(pagesRead * mpp)) : null;
                const remainingMins = pagesRemaining > 0 ? Math.max(1, Math.round(pagesRemaining * mpp)) : 0;
                
                return (
                  <div className="space-y-3">
                    {/* Task Info */}
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <div className="text-sm font-medium truncate">{it?.title || 'Task'}</div>
                      <div className="text-xs text-slate-300/70 mt-1">
                        {it?.course && <span className="mr-3">{it.course}</span>}
                        {total > 0 && <span>Total: {total} pages</span>}
                      </div>
                    </div>

                    {/* Time & Focus Row */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-300/70 mb-1">Time Spent</label>
                        <input type="text" placeholder="1:30 or 90" value={logForm.minutes} onChange={e=>setLogForm(f=>({...f, minutes: e.target.value}))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
                        <div className="text-[10px] text-slate-400 mt-1">Format: H:MM or minutes{minsHint}</div>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-300/70 mb-1">Focus Level</label>
                        <div className="flex items-center gap-2">
                          <input type="range" min={1} max={10} step={0.1} value={logForm.focus || 5} onChange={e=>setLogForm(f=>({...f, focus: e.target.value}))} className="flex-1" />
                          <span className="text-sm font-medium w-8">{logForm.focus}</span>
                        </div>
                      </div>
                    </div>

                    {/* Pages Read (for reading tasks) */}
                    {total > 0 && (
                      <div className="rounded-lg border border-emerald-600/30 bg-emerald-900/10 p-3 space-y-2">
                        <div className="text-xs text-emerald-400 font-medium">Reading Progress</div>
                        <div>
                          <label className="block text-xs text-slate-300/70 mb-1">Pages completed (ranges work: 241–247 or just 15)</label>
                          <input type="text" placeholder="e.g., 241–247 or 15" value={logForm.pages} onChange={e=>setLogForm(f=>({...f, pages: e.target.value}))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
                        </div>
                        {(() => {
                          const inp = (logForm.pages||'').trim();
                          let pr = pagesRead;
                          if (pr === 0 && /^\d+$/.test(inp)) pr = parseInt(inp, 10);
                          return pr > 0 ? (
                            <div className="text-xs text-slate-300/70">
                              Read: <span className="text-emerald-400 font-medium">{pr} pages</span>
                              {estMins && <span className="ml-2">· Est. time: ~{estMins}m</span>}
                            </div>
                          ) : null;
                        })()}
                        {remainLabel && pagesRemaining > 0 && (
                          <div className="text-xs text-slate-300/70">
                            Remaining: <span className="text-amber-400 font-medium">{remainLabel}</span>
                            <span className="ml-2">({pagesRemaining} pages · ~{remainingMins}m)</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Move to Different Day (only for partial) */}
                    {logModal.mode === 'partial' && pagesRemaining > 0 && (
                      <div className="rounded-lg border border-blue-600/30 bg-blue-900/10 p-3">
                        <div className="text-xs text-blue-400 font-medium mb-2">Move Remaining to Another Day?</div>
                        <div className="flex items-center gap-3">
                          <input type="date" value={logForm.moveDay} onChange={e=>setLogForm(f=>({...f, moveDay: e.target.value}))} min={chicagoYmd(new Date())} className="flex-1 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 text-sm" />
                          {logForm.moveDay && (
                            <button onClick={()=>setLogForm(f=>({...f, moveDay:''}))} className="text-xs text-slate-400 hover:text-white">Clear</button>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">
                          {logForm.moveDay ? `Remaining ${pagesRemaining} pages will be moved to ${new Date(logForm.moveDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Leave blank to keep remaining pages on today'}
                        </div>
                      </div>
                    )}

                    {/* Notes */}
                    <div>
                      <label className="block text-xs text-slate-300/70 mb-1">Notes (optional)</label>
                      <input value={logForm.notes} onChange={e=>setLogForm(f=>({...f, notes: e.target.value}))} placeholder="Any notes about this session..." className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
                    </div>
                  </div>
                );
              })()}
              
              <div className="flex items-center gap-3 pt-2">
                <button onClick={submitLog} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 font-medium">
                  {logModal.mode === 'finish' ? 'Complete Task' : 'Log Progress'}
                </button>
                <button onClick={()=>setLogModal(null)} className="px-4 py-2 rounded border border-[#1b2344] hover:bg-white/5">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* KPIs & Weekly Goal */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="rounded border border-[#1b2344] p-4">
            <div className="text-xs uppercase tracking-wide text-slate-300/60">Weekly Goal (Global)</div>
            <div className="flex items-center gap-2 mt-2">
              <label className="text-xs text-slate-300/70" htmlFor="global-goal">Goal (hrs)</label>
              <input id="global-goal" type="number" min={0} step={1} value={Math.round(globalGoalMinutes/60)} onChange={e=>setGlobalGoalHours(parseInt(e.target.value||'0',10)||0)} className="w-20 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
            </div>
            <div className="h-3 bg-[#0c1328] rounded mt-3 overflow-hidden border border-[#1b2344]" aria-label="Global goal progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(globalProgressPct*100)}>
              <div className="h-full bg-blue-600" style={{ width: `${Math.round(globalProgressPct*100)}%` }}></div>
            </div>
            <div className="text-xs text-slate-300/70 mt-2">
              {minutesStr(loggedWeek)} of {minutesStr(effectiveGoalMinutes)}
              {globalGoalMinutes<=0 ? <span className="text-slate-300/60"> · using availability</span> : null}
              · Hours/day needed: {hoursPerDayNeeded.toFixed(1)}
            </div>
          </div>
          <div className="rounded border border-[#1b2344] p-4">
            <div className="text-xs uppercase tracking-wide text-slate-300/60">Today Planned vs Done</div>
            <div className="text-2xl font-semibold text-slate-100 mt-2">{minutesStr(plannedToday)} · {minutesStr((sessions||[]).filter((s:any)=>chicagoYmd(new Date(s.when))===dateKey).reduce((sum:number,s:any)=>sum+(s.minutes||0),0))}</div>
          </div>
          <div className="rounded border border-[#1b2344] p-4">
            <div className="text-xs uppercase tracking-wide text-slate-300/60">Week On-Pace?</div>
            <div className="text-2xl font-semibold text-slate-100 mt-2">{weekOnPace.label}{weekOnPace.delta!==0 ? ` ${weekOnPace.delta>0?'+':''}${minutesStr(Math.abs(weekOnPace.delta))}`:''}</div>
          </div>
          <div className="rounded border border-[#1b2344] p-4">
            <div className="text-xs uppercase tracking-wide text-slate-300/60">Weekly Quota</div>
            <div className="text-sm text-slate-300/80 mt-2">Workdays Left: <span className="text-slate-100 font-semibold">{workdaysLeft}</span></div>
            <div className="text-sm text-slate-300/80">Daily Quota: <span className="text-slate-100 font-semibold">{dailyQuota}m</span></div>
            {dailyQuota > remainingTodayCapacity && (
              <div className="mt-2 text-xs text-amber-400">Warning: quota exceeds today’s remaining capacity ({remainingTodayCapacity}m). <a href="/week-plan?action=catchup" className="underline">Catch-Up</a></div>
            )}
          </div>
        </div>
        {/* Focus Insights */}
        <div className="rounded border border-[#1b2344] p-4">
          <div className="text-xs uppercase tracking-wide text-slate-300/60 mb-1">Focus Insights</div>
          <div className="text-sm text-slate-300/80">Averages: 7d <span className="text-slate-100 font-medium">{(focus7||0).toFixed(1)}</span> · 14d <span className="text-slate-100 font-medium">{(focus14||0).toFixed(1)}</span> · 30d <span className="text-slate-100 font-medium">{(focus30||0).toFixed(1)}</span></div>
          {bestWindow ? (
            <div className="text-sm text-slate-300/80">Best window: <span className="text-slate-100 font-medium">{fmtHourRange2(bestWindow.start)}</span> (avg {(bestWindow.avg||0).toFixed(1)} over {bestWindow.n} sessions)</div>
          ) : (
            <div className="text-sm text-slate-300/60">Best window: —</div>
          )}
          <div className="text-sm text-slate-300/80 mt-1">
            {slump.isSlump ? (
              <span className="text-amber-400">Slump detected.</span>
            ) : (
              <span className="text-slate-300/60">Slump: —</span>
            )}
          </div>
          <div className="text-xs text-slate-300/70 mt-1">
            {bestWindow && <div>Suggestion: schedule 45–60m blocks in your best window.</div>}
            {slump.isSlump && <div>Suggestion: shorten sessions (30–45m), add breaks, and prioritize high-focus work in best window.</div>}
            {!bestWindow && !slump.isSlump && <div>Suggestion: keep logging focus; we’ll surface patterns as you accumulate sessions.</div>}
          </div>
        </div>
      </section>
    </main>
  );
}
