"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { courseBlocks } from '@/lib/courseWorkspace';
import { isActiveTask } from '@/lib/taskMetadata';
import type { CalendarEvent } from '@/lib/types';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';
import {
  WEEKLY_AVAILABILITY_KEY,
  WEEKLY_PLAN_KEY,
  type WeeklyAvailability,
  type WeeklyPlanBlock,
  type WeeklyPlanState,
  addDays,
  buildWeeklyPlanDetailed,
  dateKey,
  mondayOf,
} from '@/lib/weekPlan';

const DEFAULT_AVAILABILITY: WeeklyAvailability = { 0: 120, 1: 180, 2: 180, 3: 180, 4: 180, 5: 240, 6: 240 };

function formatDay(date: Date) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}
function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
function clockMinutes(value?: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}
function duration(start?: string | null, end?: string | null) {
  const from = clockMinutes(start); const to = clockMinutes(end);
  return from === null || to === null ? 0 : Math.max(0, to - from);
}

export default function WeekPlanPage() {
  const { tasks, loading } = useTasks();
  const { courses } = useCourses();
  const { currentTerm, activeSemester } = useSemester();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [availability, setAvailability] = useState<WeeklyAvailability>(DEFAULT_AVAILABILITY);
  const [blocks, setBlocks] = useState<WeeklyPlanBlock[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const activeCourses = useMemo(() => activeSemester ? courses.filter(course => course.semester === activeSemester.season && course.year === activeSemester.year) : courses, [courses, activeSemester]);
  const currentTasks = useMemo(() => tasks.filter(task => isActiveTask(task) && task.status !== 'done' && (!currentTerm || task.term === currentTerm)), [tasks, currentTerm]);
  const relevantTasks = useMemo(() => {
    const end = addDays(weekStart, 13); end.setHours(23, 59, 59, 999);
    return currentTasks.filter(task => new Date(task.dueDate) <= end);
  }, [currentTasks, weekStart]);

  useEffect(() => {
    void (async () => {
      try {
        const [settingsData, eventData] = await Promise.all([
          apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${WEEKLY_PLAN_KEY},${WEEKLY_AVAILABILITY_KEY}`),
          apiFetch<{ events: CalendarEvent[] }>('/api/events'),
        ]);
        const savedAvailability = settingsData.settings?.[WEEKLY_AVAILABILITY_KEY];
        const savedPlan = settingsData.settings?.[WEEKLY_PLAN_KEY] as WeeklyPlanState | undefined;
        if (savedAvailability && typeof savedAvailability === 'object') setAvailability({ ...DEFAULT_AVAILABILITY, ...savedAvailability });
        if (savedPlan?.weekStart === dateKey(weekStart) && Array.isArray(savedPlan.blocks)) setBlocks(savedPlan.blocks);
        setEvents(eventData.events || []);
      } catch {}
    })();
  }, [weekStart]);

  const busyMinutes = useMemo(() => {
    const busy: Record<string, number> = {};
    for (const day of days) {
      const key = dateKey(day);
      let total = 0;
      for (const course of activeCourses) {
        for (const block of courseBlocks(course)) if (block.days.includes(day.getDay())) total += duration(block.start, block.end);
      }
      for (const event of events) if (event.date === key && !event.allDay) total += duration(event.startTime, event.endTime);
      busy[key] = total;
    }
    return busy;
  }, [days, activeCourses, events]);

  const generated = useMemo(() => buildWeeklyPlanDetailed(relevantTasks, weekStart, availability, busyMinutes), [relevantTasks, weekStart, availability, busyMinutes]);
  const byDay = useMemo(() => Object.fromEntries(days.map(day => [dateKey(day), blocks.filter(block => block.day === dateKey(day))])) as Record<string, WeeklyPlanBlock[]>, [days, blocks]);
  const plannedByTask = useMemo(() => Object.fromEntries(relevantTasks.map(task => [task.id, blocks.filter(block => block.taskId === task.id).reduce((sum, block) => sum + block.plannedMinutes, 0)])) as Record<string, number>, [relevantTasks, blocks]);
  const remainders = useMemo(() => generated.remainders.map(item => ({ ...item, plannedMinutes: plannedByTask[item.taskId] || 0, remainingMinutes: Math.max(0, item.estimatedMinutes - (plannedByTask[item.taskId] || 0)) })), [generated.remainders, plannedByTask]);
  const didNotFit = remainders.filter(item => item.remainingMinutes > 0);
  const totalGross = days.reduce((sum, day) => sum + (availability[day.getDay()] || 0), 0);
  const totalBusy = Object.values(busyMinutes).reduce((sum, value) => sum + value, 0);
  const totalNet = Object.values(generated.availableByDay).reduce((sum, value) => sum + value, 0);
  const totalPlanned = blocks.reduce((sum, block) => sum + block.plannedMinutes, 0);

  async function persist(nextBlocks = blocks, nextAvailability = availability) {
    setSaving(true);
    try {
      const state: WeeklyPlanState = { weekStart: dateKey(weekStart), blocks: nextBlocks, updatedAt: new Date().toISOString() };
      await apiFetch('/api/settings', { method: 'PATCH', body: { [WEEKLY_PLAN_KEY]: state, [WEEKLY_AVAILABILITY_KEY]: nextAvailability } });
      setMessage('Weekly plan saved.');
    } catch { setMessage('Weekly plan could not be saved.'); }
    finally { setSaving(false); }
  }

  async function buildPlan() {
    setBlocks(generated.blocks);
    await persist(generated.blocks, availability);
  }
  async function clearPlan() { setBlocks([]); await persist([], availability); }
  async function moveBlock(blockId: string, day: string) {
    const block = blocks.find(item => item.id === blockId);
    if (!block) return;
    const currentDayMinutes = blocks.filter(item => item.day === day && item.id !== blockId).reduce((sum, item) => sum + item.plannedMinutes, 0);
    const capacity = generated.availableByDay[day] || 0;
    if (currentDayMinutes + block.plannedMinutes > capacity) {
      setMessage(`That move would exceed ${formatMinutes(capacity)} of net study capacity for the day.`);
      return;
    }
    const next = blocks.map(item => item.id === blockId ? { ...item, day } : item);
    setBlocks(next); await persist(next, availability);
  }
  function onDrop(event: React.DragEvent, day: string) { event.preventDefault(); const blockId = event.dataTransfer.getData('text/plain'); if (blockId) void moveBlock(blockId, day); }
  function updateAvailability(day: number, minutes: number) { setAvailability(previous => ({ ...previous, [day]: Math.max(0, minutes) })); }
  function changeWeek(offset: number) { setWeekStart(addDays(weekStart, offset * 7)); setBlocks([]); setMessage(''); }

  return <main className="space-y-6">
    <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6"><p className="text-sm font-medium text-violet-300">Plan my week</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Plan against real capacity</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">The proposed plan subtracts class meetings and timed commitments, then shows the exact minutes left unscheduled for every partially planned task.</p></section>
    {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}
    <section className="flex flex-col gap-3 rounded-xl border border-slate-700/70 bg-slate-900/45 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-2"><button onClick={() => changeWeek(-1)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Previous</button><button onClick={() => { setWeekStart(mondayOf(new Date())); setBlocks([]); }} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">This week</button><button onClick={() => changeWeek(1)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Next</button></div><div className="text-center"><p className="font-semibold text-slate-100">{formatDay(weekStart)} to {formatDay(addDays(weekStart, 6))}</p><p className="text-xs text-slate-500">{activeSemester?.name || 'Active semester'}</p></div><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">{formatMinutes(totalGross)} entered</span><span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-300">{formatMinutes(totalBusy)} fixed</span><span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-sky-300">{formatMinutes(totalNet)} net</span><span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-violet-300">{formatMinutes(totalPlanned)} planned</span></div></section>
    <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-semibold text-slate-100">Weekly capacity</h2><p className="text-sm text-slate-400">Enter the maximum study time before fixed classes and commitments are deducted.</p></div><div className="flex gap-2"><button disabled={saving || loading || !relevantTasks.length} onClick={buildPlan} className="rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Build proposed plan</button><button disabled={saving || !blocks.length} onClick={clearPlan} className="rounded-lg border border-slate-600 px-3 py-2.5 text-sm text-slate-200 disabled:opacity-50">Clear</button></div></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">{days.map(day => { const key = dateKey(day); return <label key={key} className="rounded-lg bg-slate-950/45 p-3 text-sm text-slate-300"><span className="block font-medium">{formatDay(day)}</span><input type="number" min={0} step={30} value={availability[day.getDay()] || 0} onChange={event => updateAvailability(day.getDay(), Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-slate-100" /><span className="mt-1 block text-xs text-slate-500">{formatMinutes(busyMinutes[key] || 0)} fixed · {formatMinutes(generated.availableByDay[key] || 0)} net</span></label>; })}</div></section>
    {!loading && !relevantTasks.length ? <section className="rounded-xl border border-dashed border-slate-700 p-8 text-center"><p className="font-medium text-slate-200">No work is due in the next two weeks.</p><Link href="/tasks" className="mt-3 inline-flex rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Open Tasks</Link></section> : null}
    {blocks.length ? <section className="grid gap-4 xl:grid-cols-7">{days.map(day => { const key = dateKey(day); const dayBlocks = byDay[key] || []; const planned = dayBlocks.reduce((sum, block) => sum + block.plannedMinutes, 0); const capacity = generated.availableByDay[key] || 0; return <article key={key} onDragOver={event => event.preventDefault()} onDrop={event => onDrop(event, key)} className="min-h-64 rounded-xl border border-slate-700 bg-slate-900/45 p-3"><div className="flex items-center justify-between"><div><p className="text-xs uppercase text-slate-500">{new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(day)}</p><p className="font-semibold text-slate-100">{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(day)}</p></div><span className={`text-xs ${planned > capacity ? 'text-rose-300' : 'text-slate-500'}`}>{formatMinutes(planned)} / {formatMinutes(capacity)}</span></div><div className="mt-3 space-y-2">{dayBlocks.map(block => <div key={block.id} draggable onDragStart={event => event.dataTransfer.setData('text/plain', block.id)} className="cursor-grab rounded-lg border border-violet-500/30 bg-violet-500/10 p-3"><p className="text-xs font-medium text-violet-100">{block.title}</p><p className="mt-1 text-[11px] text-violet-300/70">{block.course || 'General'} · {formatMinutes(block.plannedMinutes)}</p></div>)}{!dayBlocks.length ? <p className="py-8 text-center text-xs text-slate-600">Drop work here</p> : null}</div></article>; })}</section> : null}
    {didNotFit.length ? <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"><div className="flex items-end justify-between"><div><h2 className="font-semibold text-amber-200">Work that did not fully fit</h2><p className="text-sm text-slate-400">Partially scheduled tasks remain here until all estimated minutes are placed.</p></div><Link href="/recovery" className="text-sm text-rose-300">Open Recovery Mode</Link></div><div className="mt-4 grid gap-2 md:grid-cols-2">{didNotFit.map(item => <div key={item.taskId} className="rounded-lg bg-slate-950/40 p-3"><p className="text-sm font-medium text-slate-200">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.course || 'General'} · {formatMinutes(item.plannedMinutes)} placed · <span className="text-amber-300">{formatMinutes(item.remainingMinutes)} still unplanned</span></p></div>)}</div></section> : null}
  </main>;
}
