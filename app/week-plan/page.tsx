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
const LS_SHOW_CONFLICTS = "weekPlanShowConflicts";

type WeeklyGoal = { id: string; scope: 'global'|'course'; weeklyMinutes: number; course?: string | null };

function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function loadGoals(): WeeklyGoal[] { if (typeof window==='undefined') return []; try { const raw=window.localStorage.getItem(LS_GOALS); const arr=raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; } catch { return []; } }
function chicagoYmd(d: Date): string { const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }); const parts = f.formatToParts(d); const y=parts.find(p=>p.type==='year')?.value||'0000'; const m=parts.find(p=>p.type==='month')?.value||'01'; const da=parts.find(p=>p.type==='day')?.value||'01'; return `${y}-${m}-${da}`; }
function mondayOfChicago(d: Date): Date { const ymd = chicagoYmd(d); const [yy,mm,dd]=ymd.split('-').map(x=>parseInt(x,10)); const local = new Date(yy,(mm as number)-1,dd); const dow = local.getDay(); const delta = (dow + 6) % 7; local.setDate(local.getDate()-delta); return local; }
function weekKeysChicago(d: Date): string[] { const monday = mondayOfChicago(d); return Array.from({length:7},(_,i)=>{const x=new Date(monday); x.setDate(x.getDate()+i); return chicagoYmd(x);}); }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function mondayOf(d: Date) { const x = startOfDay(d); const dow = x.getDay(); const delta = (dow + 6) % 7; x.setDate(x.getDate() - delta); return x; }
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function dayLabel(d: Date) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
function endOfDayIso(ymdStr: string) { const [y,m,da]=ymdStr.split('-').map(n=>parseInt(n,10)); const x=new Date(y,(m as number)-1,da,23,59,59,999); return x.toISOString(); }
function minutesPerPage(): number { if (typeof window==='undefined') return 3; const s=window.localStorage.getItem('minutesPerPage'); const n=s?parseFloat(s):NaN; return !isNaN(n)&&n>0?n:3; }

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
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [availability, setAvailability] = useState<AvailabilityTemplate>({ 0:120,1:240,2:240,3:240,4:240,5:240,6:120 });
  const [blocks, setBlocks] = useState<ScheduledBlock[]>([]);
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [goals, setGoals] = useState<WeeklyGoal[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [showConflicts, setShowConflicts] = useState<boolean>(true);
  const [undoSnapshot, setUndoSnapshot] = useState<ScheduledBlock[] | null>(null);
  const [showCatchup, setShowCatchup] = useState(false);
  const [catchupPreview, setCatchupPreview] = useState<{
    days: Array<{ day: string; total: number; usedBefore: number; usedAfter: number; items: Array<{ taskId: string; title: string; course: string; minutes: number; guessed: boolean }> }>;
    unschedulable: Array<{ taskId: string; title: string; remaining: number; dueYmd: string }>;
  } | null>(null);

  useEffect(() => { setAvailability(loadAvailability()); setBlocks(loadSchedule()); setBacklog(loadBacklog()); }, []);
  useEffect(() => { saveAvailability(availability); }, [availability]);
  useEffect(() => { saveSchedule(blocks); }, [blocks]);

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
  // Load courses for class times and showConflicts flag
  useEffect(() => {
    (async () => { try { const r = await fetch('/api/courses', { cache: 'no-store' }); const d = await r.json(); setCourses(Array.isArray(d?.courses)?d.courses:[]); } catch {} })();
    try { if (typeof window!=='undefined') setShowConflicts((window.localStorage.getItem(LS_SHOW_CONFLICTS)||'true')==='true'); } catch {}
  }, []);
  useEffect(() => { if (typeof window!=='undefined') window.localStorage.setItem(LS_SHOW_CONFLICTS, showConflicts ? 'true':'false'); }, [showConflicts]);

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
    const items: Record<string, Array<{ label: string; time?: string }>> = {};
    const keyOf = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    const fmt12 = (hhmm?: string | null) => {
      if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
      const [hStr, mStr] = hhmm.split(':'); const h = parseInt(hStr, 10); const m = parseInt(mStr, 10);
      const h12 = ((h + 11) % 12) + 1; const ampm = h < 12 ? 'AM' : 'PM';
      return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
    };
    const toMin = (hhmm?: string | null) => {
      if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
      const [h, mi] = hhmm.split(':').map(x=>parseInt(x,10)); return h*60+mi;
    };
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
            const sMin = toMin((b as any).start); const eMin = toMin((b as any).end);
            const dur = (sMin!=null && eMin!=null && eMin>sMin) ? (eMin - sMin) : 0;
            const k = keyOf(d); map[k] += dur; items[k].push({ label: c.title || c.code || 'Class', time: ((b as any).start && (b as any).end) ? `${fmt12((b as any).start)}–${fmt12((b as any).end)}` : undefined });
          }
        }
      }
    }
    // Timed events from tasks (start/end on dueDate day)
    for (const t of (tasks||[])) {
      const k = keyOf(new Date(t.dueDate));
      if (!(k in map)) continue;
      const sMin = toMin((t as any).startTime); const eMin = toMin((t as any).endTime);
      const dur = (sMin!=null && eMin!=null && eMin>sMin) ? (eMin - sMin) : 0;
      if (dur > 0) { map[k] += dur; items[k].push({ label: t.title, time: ((t as any).startTime && (t as any).endTime) ? `${fmt12((t as any).startTime)}–${fmt12((t as any).endTime)}` : undefined }); }
    }
    return { minutes: map, items };
  }, [courses, tasks, days]);

  function dayHasConflict(k: string, dow: number): boolean {
    if (!showConflicts) return false;
    const busy = busyByDay.minutes[k] || 0;
    const cap = availability[dow] || 0;
    const plan = plannedByDay[k] || 0;
    return (plan + busy) > cap;
  }

  function moveBlockLaterToday(b: ScheduledBlock) {
    // Just reorder to end if same-day slack allows (cap - busy - others >= minutes); else no-op
    const k = b.day; const dow = new Date(`${k}T12:00:00`).getDay();
    const cap = availability[dow] || 0; const busy = busyByDay.minutes[k] || 0;
    const others = (plannedByDay[k] || 0) - b.plannedMinutes;
    const slack = cap - busy - others;
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
      const cap = availability[dow] || 0; const busy = busyByDay.minutes[k] || 0; const planned = withoutThis.get(k) || 0;
      if (planned + busy + b.plannedMinutes <= cap) {
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
  const unscheduledTasks = useMemo(() => tasksTodo.filter(t => !scheduledIdsThisWeek.has(t.id)), [tasksTodo, scheduledIdsThisWeek]);
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
      const block: ScheduledBlock = { id: uid(), taskId: t.id, day: ymd(d), plannedMinutes: minutes, guessed, title: t.title, course: displayCourseFor(t) || '', pages: null, priority: t.priority ?? null };
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
    const avail = (d: Date) => availability[d.getDay()] ?? 0;
    const unscheduled = unscheduledSorted.filter(t => !existing.some(b => b.taskId === t.id));
    const nextBlocks: ScheduledBlock[] = [];
    for (const t of unscheduled) {
      const { minutes, guessed } = estimateMinutesForTask(t);
      let placed = false;
      for (const d of days) {
        const k = ymd(d); const cap = avail(d); const cur = planned.get(k)!;
        if (cur + minutes <= cap) { nextBlocks.push({ id: uid(), taskId: t.id, day: k, plannedMinutes: minutes, guessed, title: t.title, course: t.course || '', pages: null, priority: t.priority ?? null }); planned.set(k, cur + minutes); placed = true; break; }
      }
      if (!placed) {
        let bestDay = days[0]; let bestRem = -Infinity;
        for (const d of days) { const k = ymd(d); const cap = avail(d); const cur = planned.get(k)!; const rem = cap - cur; if (rem > bestRem) { bestRem = rem; bestDay = d; } }
        const k = ymd(bestDay);
        nextBlocks.push({ id: uid(), taskId: t.id, day: k, plannedMinutes: minutes, guessed, title: t.title, course: t.course || '', pages: null, priority: t.priority ?? null });
        planned.set(k, planned.get(k)! + minutes);
      }
    }
    if (nextBlocks.length) setBlocks(prev => [...prev, ...nextBlocks]);
  }

  function setAvailForDow(dow: number, val: number) { const v = Math.max(0, Math.round(val)); setAvailability(prev => ({ ...prev, [dow]: v })); }
  function shiftWeek(delta: number) { setWeekStart(prev => { const x = new Date(prev); x.setDate(x.getDate() + delta*7); return mondayOf(x); }); }
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
      <section className="card p-6 space-y-4 order-2">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <button aria-label="Previous week" onClick={()=>shiftWeek(-1)} className="px-2 py-1 rounded border border-[#1b2344] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">◀</button>
            <div className="text-sm" aria-live="polite">Week of {dayLabel(weekStart)}</div>
            <button aria-label="Jump to this week" onClick={()=>setWeekStart(mondayOf(new Date()))} className="px-2 py-1 rounded border border-[#1b2344] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">This week</button>
            <button aria-label="Next week" onClick={()=>shiftWeek(1)} className="px-2 py-1 rounded border border-[#1b2344] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">▶</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={autopackWeek} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Autopack Week</button>
            <button onClick={clearThisWeek} className="px-3 py-2 rounded border border-[#1b2344] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Clear This Week</button>
            <button onClick={promoteWeekToTasks} className="px-3 py-2 rounded border border-emerald-600 text-emerald-400 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Promote Week → Tasks</button>
            <button onClick={computeCatchUpPreview} className="px-3 py-2 rounded border border-[#1b2344] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Catch-Up</button>
            <button onClick={undoCatchUp} className="px-3 py-2 rounded border border-[#1b2344] text-sm disabled:opacity-50" disabled={!undoSnapshot}>Undo Last</button>
            <div className="text-xs text-slate-300/80 ml-2">Need ~{dailyQuotaCur}m/day to hit goal · <button onClick={autopackWeek} className="underline">Autopack</button></div>
            <label className="ml-2 inline-flex items-center gap-1 text-xs">
              <input type="checkbox" checked={showConflicts} onChange={e=>setShowConflicts(e.target.checked)} /> Show conflicts
            </label>
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs text-slate-300/70">Availability (minutes per weekday)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {[1,2,3,4,5,6,0].map(dow => (
              <div key={dow} className="rounded border border-[#1b2344] p-2">
                <label className="block text-xs mb-1" htmlFor={`avail-${dow}`}>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]}</label>
                <input id={`avail-${dow}`} type="number" min={0} value={availability[dow] ?? 0} onChange={e=>setAvailForDow(dow, parseInt(e.target.value||'0',10))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
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

      <section className="space-y-3 order-1">
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {days.map((d) => {
            const k = ymd(d);
            const planned = plannedByDay[k] || 0;
            const cap = availability[d.getDay()] ?? 0;
            const overBy = Math.max(0, planned - cap);
            const pct = cap>0 ? Math.min(100, Math.round((planned/cap)*100)) : (planned>0?100:0);
            const dayBlocks = blocks.filter(b => b.day === k);
            return (
              <div key={k} className={`rounded border ${overBy>0?'border-rose-600':'border-[#1b2344]'} p-3 min-h-[220px]`} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>onDropDay(e,d)} role="listbox" aria-label={`Planned items for ${dayLabel(d)}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-slate-200">{dayLabel(d)}</div>
                  <div className="text-xs text-slate-300/70 flex items-center gap-2">
                    <span>{planned} / {cap}m</span>
                    {dayHasConflict(k, d.getDay()) && (
                      <span className="px-1 py-0.5 rounded border border-rose-600 text-rose-400" title={(busyByDay.items[k]||[]).map(x=>`${x.label}${x.time?` · ${x.time}`:''}`).join('\n')}>conflict</span>
                    )}
                  </div>
                </div>
                <div className="h-2 w-full bg-[#0b1020] border border-[#1b2344] rounded overflow-hidden mb-2" role="progressbar" aria-valuemin={0} aria-valuemax={cap||0} aria-valuenow={planned} aria-label="Planned minutes">
                  <div className={`${overBy>0?'bg-rose-600':'bg-blue-600'}`} style={{ width: `${pct}%`, height: '100%' }} />
                </div>
                {overBy>0 ? <div className="text-[11px] text-rose-400 mb-2">Over by {overBy}m</div> : null}
                <ul className="space-y-1">
                  {dayBlocks.length===0 ? (
                    <li className="text-[11px] text-slate-300/50">Drop tasks here</li>
                  ) : dayBlocks.map(b => (
                    <li key={b.id} className="text-[11px] flex items-start gap-2">
                      <span className="mt-1 w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colorForCourse(b.course) }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-200 truncate">{b.course ? `${b.course}: ` : ''}{b.title}</div>
                        <div className="text-slate-300/70 flex items-center gap-2">
                          <span>{b.plannedMinutes}m{b.guessed ? <span className="ml-1 inline-block px-1 rounded border border-amber-500 text-amber-400">guessed</span> : null}</span>
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
                          <span>{it.minutes}m{it.guessed ? <span className="ml-1 inline-block px-1 rounded border border-amber-500 text-amber-400">guessed</span> : null}</span>
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
