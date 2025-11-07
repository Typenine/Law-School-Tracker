"use client";
import { useEffect, useMemo, useState } from "react";

type BacklogItem = {
  id: string;
  title: string;
  course: string;
  dueDate?: string | null; // YYYY-MM-DD
  pages?: number | null;
  estimatedMinutes?: number | null;
  priority?: number | null; // 1-5 higher = more important
  tags?: string[] | null;
};

type AvailabilityTemplate = Record<number, number>; // 0..6 => minutes

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

const LS_BACKLOG = "backlogItemsV1";
const LS_AVAIL = "availabilityTemplateV1";
const LS_SCHEDULE = "weekScheduleV1";

function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function mondayOf(d: Date) { const x = startOfDay(d); const dow = x.getDay(); const delta = (dow + 6) % 7; x.setDate(x.getDate() - delta); return x; }
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function dayLabel(d: Date) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
function endOfDayIso(ymdStr: string) { const [y,m,da]=ymdStr.split('-').map(n=>parseInt(n,10)); const x=new Date(y,(m as number)-1,da,23,59,59,999); return x.toISOString(); }
function minutesPerPage(): number { if (typeof window==='undefined') return 3; const s=window.localStorage.getItem('minutesPerPage'); const n=s?parseFloat(s):NaN; return !isNaN(n)&&n>0?n:3; }

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
  if (typeof item.estimatedMinutes === 'number' && item.estimatedMinutes > 0) return { minutes: item.estimatedMinutes, guessed: false };
  if (typeof item.pages === 'number' && item.pages > 0) return { minutes: Math.round(item.pages * minutesPerPage()), guessed: false };
  return { minutes: 30, guessed: true };
}

export default function WeekPlanPage() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [availability, setAvailability] = useState<AvailabilityTemplate>({ 0:120,1:240,2:240,3:240,4:240,5:240,6:120 });
  const [blocks, setBlocks] = useState<ScheduledBlock[]>([]);
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);

  useEffect(() => { setAvailability(loadAvailability()); setBlocks(loadSchedule()); setBacklog(loadBacklog()); }, []);
  useEffect(() => { saveAvailability(availability); }, [availability]);
  useEffect(() => { saveSchedule(blocks); }, [blocks]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate()+i); return d; }), [weekStart]);

  const plannedByDay = useMemo(() => {
    const m: Record<string, number> = {}; for (const d of days) m[ymd(d)] = 0;
    for (const b of blocks) if (m[b.day] !== undefined) m[b.day] += b.plannedMinutes;
    return m;
  }, [blocks, days]);

  const backlogSorted = useMemo(() => {
    const arr = backlog.slice();
    arr.sort((a,b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      const ap = a.priority ?? 0; const bp = b.priority ?? 0; return (bp - ap);
    });
    return arr;
  }, [backlog]);

  const scheduledIdsThisWeek = useMemo(() => {
    const keys = new Set(days.map(d => ymd(d))); return new Set(blocks.filter(b => keys.has(b.day)).map(b => b.taskId));
  }, [blocks, days]);

  function onDragStartBacklog(e: React.DragEvent, it: BacklogItem) { e.dataTransfer.setData('text/plain', it.id); }
  function onDropDay(e: React.DragEvent, d: Date) {
    e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (!id) return;
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
    const unscheduled = backlogSorted.filter(it => !existing.some(b => b.taskId === it.id));
    const nextBlocks: ScheduledBlock[] = [];
    for (const it of unscheduled) {
      const { minutes, guessed } = estimateMinutesFor(it);
      let placed = false;
      for (const d of days) {
        const k = ymd(d); const cap = avail(d); const cur = planned.get(k)!;
        if (cur + minutes <= cap) { nextBlocks.push({ id: uid(), taskId: it.id, day: k, plannedMinutes: minutes, guessed, title: it.title, course: it.course, pages: it.pages ?? null, priority: it.priority ?? null }); planned.set(k, cur + minutes); placed = true; break; }
      }
      if (!placed) {
        let bestDay = days[0]; let bestRem = -Infinity;
        for (const d of days) { const k = ymd(d); const cap = avail(d); const cur = planned.get(k)!; const rem = cap - cur; if (rem > bestRem) { bestRem = rem; bestDay = d; } }
        const k = ymd(bestDay);
        nextBlocks.push({ id: uid(), taskId: it.id, day: k, plannedMinutes: minutes, guessed, title: it.title, course: it.course, pages: it.pages ?? null, priority: it.priority ?? null });
        planned.set(k, planned.get(k)! + minutes);
      }
    }
    if (nextBlocks.length) setBlocks(prev => [...prev, ...nextBlocks]);
  }

  function setAvailForDow(dow: number, val: number) { const v = Math.max(0, Math.round(val)); setAvailability(prev => ({ ...prev, [dow]: v })); }
  function shiftWeek(delta: number) { setWeekStart(prev => { const x = new Date(prev); x.setDate(x.getDate() + delta*7); return mondayOf(x); }); }
  function clearThisWeek() {
    const keys = new Set(days.map(d => ymd(d))); setBlocks(prev => prev.filter(b => !keys.has(b.day)));
  }
  async function promoteWeekToTasks() {
    const keys = new Set(days.map(d => ymd(d)));
    const batch = blocks.filter(b => keys.has(b.day));
    let ok = 0, fail = 0;
    for (const b of batch) {
      const body: any = { title: b.title, course: b.course || null, dueDate: endOfDayIso(b.day), status: 'todo', estimatedMinutes: b.plannedMinutes, priority: b.priority ?? null, tags: ['week-plan'] };
      try { const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (res.ok) ok++; else fail++; } catch { fail++; }
    }
    if (typeof window !== 'undefined') window.alert(`Promoted ${ok} task(s)${fail?`, ${fail} failed`:''}`);
  }

  const noBacklog = backlogSorted.length === 0;

  return (
    <main className="space-y-6">
      <section className="card p-6 space-y-4">
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

      <section className="card p-6 space-y-4">
        <div>
          <h3 className="text-sm font-medium mb-2">Backlog (drag to a day)</h3>
          {noBacklog ? (
            <div className="rounded border border-dashed border-[#1b2344] p-4 text-sm text-slate-300/80">No backlog items yet. Add some in <a href="/backlog" className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Backlog Intake</a> and return.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {backlogSorted.map(it => (
                <div key={it.id} draggable onDragStart={(e)=>onDragStartBacklog(e,it)} className={`p-2 rounded border focus-within:outline focus-within:outline-2 focus-within:outline-blue-500 ${scheduledIdsThisWeek.has(it.id)?'border-emerald-700 bg-emerald-900/10':'border-[#1b2344]'}`} aria-grabbed="false">
                  <div className="text-sm text-slate-200 truncate">{it.course ? `${it.course}: ` : ''}{it.title}</div>
                  <div className="text-xs text-slate-300/70 flex items-center gap-2 mt-1">
                    {it.dueDate ? <span>due {it.dueDate}</span> : <span>no due</span>}
                    {typeof it.priority==='number' ? <span>p{it.priority}</span> : null}
                    {typeof it.pages==='number' ? <span>{it.pages}p</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
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
                  <div className="text-xs text-slate-300/70">{planned} / {cap}m</div>
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
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-200 truncate">{b.course ? `${b.course}: ` : ''}{b.title}</div>
                        <div className="text-slate-300/70">{b.plannedMinutes}m{b.guessed ? <span className="ml-1 inline-block px-1 rounded border border-amber-500 text-amber-400">guessed</span> : null}</div>
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
    </main>
  );
}
