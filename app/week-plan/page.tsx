"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';
import {
  WEEKLY_AVAILABILITY_KEY,
  WEEKLY_PLAN_KEY,
  WeeklyAvailability,
  WeeklyPlanBlock,
  WeeklyPlanState,
  addDays,
  buildWeeklyPlan,
  dateKey,
  estimateTaskMinutes,
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

export default function WeekPlanPage() {
  const { tasks, loading } = useTasks();
  const { currentTerm, activeSemester } = useSemester();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [availability, setAvailability] = useState<WeeklyAvailability>(DEFAULT_AVAILABILITY);
  const [blocks, setBlocks] = useState<WeeklyPlanBlock[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const currentTasks = useMemo(() => tasks.filter((task) => task.status !== 'done' && (!currentTerm || task.term === currentTerm)), [tasks, currentTerm]);
  const relevantTasks = useMemo(() => {
    const end = addDays(weekStart, 13);
    end.setHours(23, 59, 59, 999);
    return currentTasks.filter((task) => new Date(task.dueDate) <= end);
  }, [currentTasks, weekStart]);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${WEEKLY_PLAN_KEY},${WEEKLY_AVAILABILITY_KEY}`);
        const savedAvailability = data.settings?.[WEEKLY_AVAILABILITY_KEY];
        const savedPlan = data.settings?.[WEEKLY_PLAN_KEY] as WeeklyPlanState | undefined;
        if (savedAvailability && typeof savedAvailability === 'object') setAvailability({ ...DEFAULT_AVAILABILITY, ...savedAvailability });
        if (savedPlan?.weekStart === dateKey(weekStart) && Array.isArray(savedPlan.blocks)) setBlocks(savedPlan.blocks);
      } catch {}
    })();
  }, [weekStart]);

  const byDay = useMemo(() => Object.fromEntries(days.map((day) => [dateKey(day), blocks.filter((block) => block.day === dateKey(day))])) as Record<string, WeeklyPlanBlock[]>, [days, blocks]);
  const scheduledIds = new Set(blocks.map((block) => block.taskId));
  const unscheduled = relevantTasks.filter((task) => !scheduledIds.has(task.id));
  const totalAvailable = days.reduce((sum, day) => sum + (availability[day.getDay()] || 0), 0);
  const totalPlanned = blocks.reduce((sum, block) => sum + block.plannedMinutes, 0);

  async function persist(nextBlocks = blocks, nextAvailability = availability) {
    setSaving(true);
    try {
      const state: WeeklyPlanState = { weekStart: dateKey(weekStart), blocks: nextBlocks, updatedAt: new Date().toISOString() };
      await apiFetch('/api/settings', { method: 'PATCH', body: { [WEEKLY_PLAN_KEY]: state, [WEEKLY_AVAILABILITY_KEY]: nextAvailability } });
      setMessage('Weekly plan saved.');
    } catch {
      setMessage('Weekly plan could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function buildPlan() {
    const next = buildWeeklyPlan(relevantTasks, weekStart, availability);
    setBlocks(next);
    await persist(next, availability);
  }

  async function clearPlan() {
    setBlocks([]);
    await persist([], availability);
  }

  async function moveBlock(blockId: string, day: string) {
    const next = blocks.map((block) => block.id === blockId ? { ...block, day } : block);
    setBlocks(next);
    await persist(next, availability);
  }

  function onDrop(event: React.DragEvent, day: string) {
    event.preventDefault();
    const blockId = event.dataTransfer.getData('text/plain');
    if (blockId) void moveBlock(blockId, day);
  }

  function updateAvailability(day: number, minutes: number) {
    setAvailability((previous) => ({ ...previous, [day]: Math.max(0, minutes) }));
  }

  async function changeWeek(offset: number) {
    const next = addDays(weekStart, offset * 7);
    setWeekStart(next);
    setBlocks([]);
  }

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
        <p className="text-sm font-medium text-violet-300">Plan my week</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-100">One weekly plan, built from real tasks</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Set the time available each day. The tracker proposes study blocks before their deadlines, then lets you make small drag-and-drop changes.</p>
      </section>

      {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}

      <section className="flex flex-col gap-3 rounded-xl border border-slate-700/70 bg-slate-900/45 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2"><button onClick={() => changeWeek(-1)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Previous</button><button onClick={() => { setWeekStart(mondayOf(new Date())); setBlocks([]); }} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">This week</button><button onClick={() => changeWeek(1)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Next</button></div>
        <div className="text-center"><p className="font-semibold text-slate-100">{formatDay(weekStart)} to {formatDay(addDays(weekStart, 6))}</p><p className="text-xs text-slate-500">{activeSemester?.name || 'Active semester'}</p></div>
        <div className="flex gap-2 text-xs"><span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">{formatMinutes(totalAvailable)} available</span><span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-violet-300">{formatMinutes(totalPlanned)} planned</span></div>
      </section>

      <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-semibold text-slate-100">Available study time</h2><p className="text-sm text-slate-400">These hours carry forward to future weeks and semesters unless changed.</p></div><div className="flex gap-2"><button disabled={saving || loading || !relevantTasks.length} onClick={buildPlan} className="rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Build proposed plan</button><button disabled={saving || !blocks.length} onClick={clearPlan} className="rounded-lg border border-slate-600 px-3 py-2.5 text-sm text-slate-200 disabled:opacity-50">Clear</button></div></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">{days.map((day) => <label key={dateKey(day)} className="rounded-lg bg-slate-950/45 p-3 text-sm text-slate-300"><span className="block font-medium">{formatDay(day)}</span><input type="number" min={0} step={30} value={availability[day.getDay()] || 0} onChange={(event) => updateAvailability(day.getDay(), Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-slate-100" /><span className="mt-1 block text-xs text-slate-500">minutes</span></label>)}</div>
      </section>

      {!loading && !relevantTasks.length ? <section className="rounded-xl border border-dashed border-slate-700 p-8 text-center"><p className="font-medium text-slate-200">No work is due in the next two weeks.</p><p className="mt-1 text-sm text-slate-500">Add tasks or import a syllabus before building a plan.</p><Link href="/tasks" className="mt-3 inline-flex rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Open Tasks</Link></section> : null}

      {blocks.length ? <section className="grid gap-4 xl:grid-cols-7">{days.map((day) => {
        const key = dateKey(day);
        const dayBlocks = byDay[key] || [];
        const planned = dayBlocks.reduce((sum, block) => sum + block.plannedMinutes, 0);
        return <article key={key} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, key)} className="min-h-64 rounded-xl border border-slate-700 bg-slate-900/45 p-3"><div className="flex items-center justify-between"><div><p className="text-xs uppercase text-slate-500">{new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(day)}</p><p className="font-semibold text-slate-100">{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(day)}</p></div><span className={`text-xs ${planned > (availability[day.getDay()] || 0) ? 'text-rose-300' : 'text-slate-500'}`}>{formatMinutes(planned)}</span></div><div className="mt-3 space-y-2">{dayBlocks.map((block) => <div key={block.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', block.id)} className="cursor-grab rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 active:cursor-grabbing"><p className="text-xs font-medium text-violet-100">{block.title}</p><p className="mt-1 text-[11px] text-violet-300/70">{block.course || 'General'} · {formatMinutes(block.plannedMinutes)}</p></div>)}{!dayBlocks.length ? <p className="py-8 text-center text-xs text-slate-600">Drop work here</p> : null}</div></article>;
      })}</section> : null}

      {unscheduled.length ? <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"><div className="flex items-end justify-between"><div><h2 className="font-semibold text-amber-200">Work that did not fit</h2><p className="text-sm text-slate-400">Increase availability, move lower-priority work, or use Recovery Mode.</p></div><Link href="/recovery" className="text-sm text-rose-300">Open Recovery Mode</Link></div><div className="mt-4 grid gap-2 md:grid-cols-2">{unscheduled.map((task) => <div key={task.id} className="rounded-lg bg-slate-950/40 p-3"><p className="text-sm font-medium text-slate-200">{task.title}</p><p className="mt-1 text-xs text-slate-500">{task.course || 'General'} · about {formatMinutes(estimateTaskMinutes(task))}</p></div>)}</div></section> : null}
    </main>
  );
}
