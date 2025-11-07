"use client";
import { useEffect, useMemo, useRef, useState } from "react";

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

const LS_SCHEDULE = "weekScheduleV1";
const LS_BACKLOG = "backlogItemsV1";
const LS_AVAIL = "availabilityTemplateV1";
const LS_TODAY = "todayPlanV1";
const LS_GOALS = "weeklyGoalsV1";

function minutesPerPage(): number { if (typeof window==='undefined') return 3; const s=window.localStorage.getItem('minutesPerPage'); const n=s?parseFloat(s):NaN; return !isNaN(n)&&n>0?n:3; }

function ymdAddDays(ymd: string, delta: number): string {
  const [y,m,d] = ymd.split('-').map(x=>parseInt(x,10));
  const dt = new Date(y,(m as number)-1,d); dt.setDate(dt.getDate()+delta);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
function estimateMinutes(it: BacklogItem): { minutes: number; guessed: boolean } {
  if (typeof it.estimatedMinutes==='number' && it.estimatedMinutes>0) return { minutes: it.estimatedMinutes, guessed:false };
  if (typeof it.pages==='number' && it.pages>0) return { minutes: Math.round(it.pages * minutesPerPage()), guessed:false };
  return { minutes: 30, guessed: true };
}

function chicagoYmd(d: Date): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = f.formatToParts(d);
  const y = parts.find(p=>p.type==='year')?.value || '0000';
  const m = parts.find(p=>p.type==='month')?.value || '01';
  const da = parts.find(p=>p.type==='day')?.value || '01';
  return `${y}-${m}-${da}`;
}
function mondayOfChicago(d: Date): Date { const ymd = chicagoYmd(d); const [yy,mm,dd]=ymd.split('-').map(x=>parseInt(x,10)); const local = new Date(yy,(mm as number)-1,dd); const dow = local.getDay(); const delta = (dow + 6) % 7; local.setDate(local.getDate()-delta); return local; }
function weekKeysChicago(d: Date): string[] { const monday = mondayOfChicago(d); return Array.from({length:7},(_,i)=>{const x=new Date(monday); x.setDate(x.getDate()+i); return chicagoYmd(x);}); }
function minutesStr(mins: number): string { const h=Math.floor(mins/60), m=mins%60; return `${h>0?`${h}h `:''}${m}m`.trim(); }

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
  const [availability, setAvailability] = useState<Record<number, number>>({ 0:120,1:240,2:240,3:240,4:240,5:240,6:120 });
  const [sessions, setSessions] = useState<any[]>([]);
  const [goals, setGoals] = useState<WeeklyGoal[]>([]);

  // Timer state
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const tickRef = useRef<NodeJS.Timeout|null>(null);
  const [logCourse, setLogCourse] = useState("");
  const [logMinutes, setLogMinutes] = useState(0);
  const [logFocus, setLogFocus] = useState<number>(5);
  const [logNotes, setLogNotes] = useState("");

  // Load persisted
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
  }, []);
  useEffect(() => { if (typeof window!=='undefined') window.localStorage.setItem(LS_TODAY, JSON.stringify(plan)); }, [plan]);
  useEffect(() => { saveGoals(goals); }, [goals]);

  // Sessions fetch for KPIs
  useEffect(() => {
    let mounted = true;
    (async () => {
      try { const r = await fetch('/api/sessions', { cache: 'no-store' }); const d = await r.json(); if (mounted) setSessions(Array.isArray(d.sessions)?d.sessions:[]); }
      catch {}
    })();
    return () => { mounted = false; };
  }, [dateKey]);

  // Compute today's scheduled blocks (from weekly schedule)
  const todaysBlocks = useMemo(() => (schedule || []).filter(b => b.day === dateKey), [schedule, dateKey]);

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

  // Timer logic
  useEffect(() => {
    if (running) {
      tickRef.current = setInterval(() => setSeconds(s => s + 1), 1000) as any;
    } else if (tickRef.current) {
      clearInterval(tickRef.current); tickRef.current = null;
    }
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  }, [running]);
  useEffect(() => { setLogMinutes(Math.max(0, Math.floor(seconds/60))); }, [seconds]);
  function resetTimer() { setRunning(false); setSeconds(0); }

  async function quickLog() {
    const mins = Math.max(1, logMinutes || Math.floor(seconds/60) || 0);
    const body: any = { when: new Date().toISOString(), minutes: mins, focus: Math.min(10, Math.max(1, Number(logFocus)||5)), notes: logNotes || null, activity: 'other' };
    if (logCourse.trim()) body.notes = body.notes ? `[${logCourse.trim()}] ${body.notes}` : `[${logCourse.trim()}]`;
    try { const r = await fetch('/api/sessions', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); if (r.ok) { resetTimer(); setLogMinutes(0); setLogNotes(""); setLogCourse(""); /* refresh */ const g=await fetch('/api/sessions',{cache:'no-store'}); const d=await g.json(); setSessions(Array.isArray(d.sessions)?d.sessions:[]); } else { if (typeof window!=='undefined') window.alert('Failed to log'); } } catch {}
  }

  // KPIs & Goals
  const plannedToday = useMemo(() => plan.items.reduce((s,it)=>s+(Number(it.minutes)||0),0), [plan.items]);
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
  const loggedToDate = useMemo(() => {
    const todayIdx = weekKeys.indexOf(dateKey);
    return (sessions||[]).filter((s:any) => { const k = chicagoYmd(new Date(s.when)); const i = weekKeys.indexOf(k); return i !== -1 && i <= todayIdx; }).reduce((sum:number, s:any)=>sum+(s.minutes||0),0);
  }, [sessions, weekKeys, dateKey]);
  const weeklyNeeded = useMemo(() => Math.max(0, globalGoalMinutes - loggedToDate), [globalGoalMinutes, loggedToDate]);
  const dailyQuota = useMemo(() => Math.ceil(weeklyNeeded / Math.max(workdaysLeft, 1)), [weeklyNeeded, workdaysLeft]);
  const hoursPerDayNeeded = useMemo(() => {
    if (globalGoalMinutes <= 0) return 0;
    const remaining = Math.max(0, globalGoalMinutes - loggedToDate);
    const daysLeft = Math.max(1, workdaysLeft);
    return Math.max(0, remaining / daysLeft) / 60;
  }, [globalGoalMinutes, loggedToDate, workdaysLeft]);
  const globalProgressPct = useMemo(() => {
    if (globalGoalMinutes <= 0) return 0;
    return Math.min(1, loggedWeek / globalGoalMinutes);
  }, [loggedWeek, globalGoalMinutes]);

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

  const totalPlannedLabel = minutesStr(plannedToday);

  // UI
  return (
    <main className="space-y-6">
      <section className="card p-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-medium">Today</h2>
            <p className="text-xs text-slate-300/60">Central time · {dateKey}</p>
          </div>
          {!plan.locked ? (
            <button aria-label="Open Plan Today" onClick={()=>setStep(1)} className="inline-flex items-center justify-center px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Plan Today</button>
          ) : (
            <div className="text-sm text-slate-300/80">Planned {totalPlannedLabel}</div>
          )}
        </div>

        {/* Wizard */}
        {!plan.locked && (
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
                          <span className="truncate">{b.course ? `${b.course}: ` : ''}{b.title} · {b.plannedMinutes}m</span>
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
                  {plan.items.map((it, idx) => (
                    <li key={it.id} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-200 truncate">{it.course ? `${it.course}: `:''}{it.title}</div>
                        <div className="text-xs text-slate-300/70">{it.guessed? 'minutes (guessed)' : 'minutes'}</div>
                      </div>
                      <label htmlFor={`minutes-${it.id}`} className="sr-only">Minutes for {it.title}</label>
                      <input id={`minutes-${it.id}`} type="number" min={5} step={5} value={it.minutes} onChange={e=>setPlan(p=>({ ...p, items: p.items.map(x=>x.id===it.id?{...x, minutes: parseInt(e.target.value||'0',10)||0}:x) }))} className="w-20 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
                      <div className="flex items-center gap-1">
                        <button aria-label="Move up" onClick={()=>moveItem(it.id,-1)} className="px-2 py-1 rounded border border-[#1b2344] text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" disabled={idx===0}>↑</button>
                        <button aria-label="Move down" onClick={()=>moveItem(it.id, 1)} className="px-2 py-1 rounded border border-[#1b2344] text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" disabled={idx===plan.items.length-1}>↓</button>
                        <button aria-label="Remove item" onClick={()=>removeItem(it.id)} className="px-2 py-1 rounded border border-rose-600 text-rose-400 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  <button aria-label="Back to Step 1" onClick={()=>setStep(1)} className="px-3 py-2 rounded border border-[#1b2344] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Back</button>
                  <button aria-label="Lock plan" onClick={lockPlan} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" disabled={plan.items.length===0}>Lock Plan · {minutesStr(plan.items.reduce((s,it)=>s+it.minutes,0))}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Timer & Quick Log */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded border border-[#1b2344] p-4">
            <h3 className="text-sm font-medium mb-2">Focus Timer</h3>
            <div className="text-3xl font-semibold mb-2" aria-live="polite">{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</div>
            <div className="flex items-center gap-2 mb-2">
              {!running ? (
                <button aria-label="Start timer" onClick={()=>setRunning(true)} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Start</button>
              ) : (
                <button aria-label="Pause timer" onClick={()=>setRunning(false)} className="px-3 py-2 rounded border border-[#1b2344] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Pause</button>
              )}
              <button aria-label="Reset timer" onClick={resetTimer} className="px-3 py-2 rounded border border-[#1b2344] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Reset</button>
            </div>
            <div className="space-y-2">
              <div>
                <label className="block text-xs mb-1" htmlFor="log-course">Course</label>
                <input id="log-course" value={logCourse} onChange={e=>setLogCourse(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
              </div>
              <div className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <label className="block text-xs mb-1" htmlFor="log-minutes">Minutes</label>
                  <input id="log-minutes" type="number" min={0} step={1} value={logMinutes} onChange={e=>setLogMinutes(parseInt(e.target.value||'0',10)||0)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
                </div>
                <div>
                  <label className="block text-xs mb-1" htmlFor="log-focus">Focus (1–10)</label>
                  <input id="log-focus" type="number" min={1} max={10} step={1} value={logFocus} onChange={e=>setLogFocus(Math.min(10, Math.max(1, parseInt(e.target.value||'5',10))))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" />
                </div>
                <div>
                  <label className="block text-xs mb-1" htmlFor="quick-log">&nbsp;</label>
                  <button id="quick-log" onClick={quickLog} className="w-full px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Quick Log</button>
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1" htmlFor="log-notes">Notes</label>
                <textarea id="log-notes" value={logNotes} onChange={e=>setLogNotes(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" rows={3} />
              </div>
            </div>
          </div>
          <div className="rounded border border-[#1b2344] p-4 min-h-[140px]">
            <h3 className="text-sm font-medium mb-2">Today’s Plan</h3>
            {plan.items.length===0 ? (
              <div className="text-xs text-slate-300/80">No items in plan yet. Press <button onClick={()=>setStep(1)} className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Plan Today</button> or add tasks in <a href="/tasks?tag=inbox" className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Inbox</a>.</div>
            ) : (
              <ul className="space-y-1 text-sm">
                {plan.items.map((it, i) => (
                  <li key={it.id} className="flex items-center justify-between">
                    <span className="truncate">{i+1}. {it.course ? `${it.course}: `:''}{it.title}</span>
                    <span className="text-slate-300/70">{it.minutes}m</span>
                  </li>
                ))}
              </ul>
            )}
            {plan.locked && (
              <div className="text-xs text-slate-300/70 mt-2">Locked · Total {totalPlannedLabel}</div>
            )}
          </div>
        </div>

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
            <div className="text-xs text-slate-300/70 mt-2">{minutesStr(loggedWeek)} of {minutesStr(globalGoalMinutes)} · Hours/day needed: {hoursPerDayNeeded.toFixed(1)}</div>
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
