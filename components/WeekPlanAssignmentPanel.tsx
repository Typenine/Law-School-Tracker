"use client";

import { useEffect, useMemo, useState } from 'react';
import { useTasks } from '@/lib/useTasks';
import { useSchedule, type ScheduledBlock } from '@/lib/useSchedule';
import { estimateMinutesForTask } from '@/lib/taskEstimate';
import { notifyToast } from '@/lib/toastBus';

const LS_WEEK_START = 'weekPlanWeekStartYmd';

function uid(): string {
  try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

function saturdayOf(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const delta = (date.getDay() - 6 + 7) % 7;
  date.setDate(date.getDate() - delta);
  return date;
}

function parseWeekStart(value?: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : saturdayOf(date);
}

function currentPlannerWeek(): Date {
  if (typeof window !== 'undefined') {
    try {
      const stored = parseWeekStart(window.localStorage.getItem(LS_WEEK_START));
      if (stored) return stored;
    } catch {}
  }
  return saturdayOf(new Date());
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function dueLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function minutesLabel(value: number): string {
  const total = Math.max(0, Math.round(value));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export default function WeekPlanAssignmentPanel() {
  const { tasks, loading: tasksLoading } = useTasks();
  const { blocks, setBlocks, loading: scheduleLoading } = useSchedule();
  const [weekStart, setWeekStart] = useState<Date>(() => currentPlannerWeek());
  const [taskId, setTaskId] = useState('');
  const [dayKey, setDayKey] = useState('');

  useEffect(() => {
    const syncWeek = () => {
      const next = currentPlannerWeek();
      setWeekStart(prev => ymd(prev) === ymd(next) ? prev : next);
    };
    syncWeek();
    window.addEventListener('focus', syncWeek);
    const id = window.setInterval(syncWeek, 800);
    return () => {
      window.removeEventListener('focus', syncWeek);
      window.clearInterval(id);
    };
  }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    return date;
  }), [weekStart]);

  const weekKeys = useMemo(() => new Set(days.map(ymd)), [days]);
  const scheduledIds = useMemo(() => new Set(
    blocks.filter(block => weekKeys.has(block.day)).map(block => block.taskId)
  ), [blocks, weekKeys]);

  const candidates = useMemo(() => tasks
    .filter(task => task.status === 'todo' && !scheduledIds.has(task.id))
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()), [tasks, scheduledIds]);

  useEffect(() => {
    if (taskId && !candidates.some(task => task.id === taskId)) setTaskId('');
  }, [candidates, taskId]);

  useEffect(() => {
    if (dayKey && !weekKeys.has(dayKey)) setDayKey('');
  }, [dayKey, weekKeys]);

  const selectedTask = candidates.find(task => task.id === taskId) || null;

  function assign() {
    if (!selectedTask || !dayKey) return;
    if (scheduledIds.has(selectedTask.id)) {
      notifyToast({ kind: 'warning', message: 'That task is already planned this week.' });
      setTaskId('');
      return;
    }

    const { minutes, guessed } = estimateMinutesForTask(selectedTask);
    const pages = typeof selectedTask.pagesRead === 'number' && selectedTask.pagesRead > 0
      ? selectedTask.pagesRead
      : null;
    const block: ScheduledBlock = {
      id: uid(),
      taskId: selectedTask.id,
      day: dayKey,
      plannedMinutes: minutes,
      guessed,
      title: selectedTask.title,
      course: selectedTask.course || '',
      pages,
      priority: selectedTask.priority ?? null,
    };

    setBlocks(prev => [...prev, block]);
    const target = days.find(day => ymd(day) === dayKey);
    notifyToast({ kind: 'success', message: `Assigned to ${target ? dayLabel(target) : dayKey}.` });
    setTaskId('');
  }

  const loading = tasksLoading || scheduleLoading;

  return (
    <section className="card p-4 mb-4 space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium">Assign tasks to this week</h2>
          <p className="text-xs text-slate-400 mt-1">Choose the task and day directly. You do not need drag-and-drop.</p>
        </div>
        <div className="text-xs text-slate-500">Week of {dayLabel(weekStart)}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(260px,1fr)_220px_auto] gap-2 items-end">
        <label className="block">
          <span className="block text-xs mb-1">Task</span>
          <select
            value={taskId}
            onChange={event => setTaskId(event.target.value)}
            disabled={loading || candidates.length === 0}
            className="w-full px-3 py-2"
          >
            <option value="">{loading ? 'Loading tasks…' : candidates.length ? 'Choose a task…' : 'No unplanned tasks'}</option>
            {candidates.map(task => {
              const estimate = estimateMinutesForTask(task).minutes;
              return (
                <option key={task.id} value={task.id}>
                  {task.course ? `${task.course}: ` : ''}{task.title} · due {dueLabel(task.dueDate)} · {minutesLabel(estimate)}
                </option>
              );
            })}
          </select>
        </label>

        <label className="block">
          <span className="block text-xs mb-1">Day</span>
          <select value={dayKey} onChange={event => setDayKey(event.target.value)} className="w-full px-3 py-2">
            <option value="">Choose a day…</option>
            {days.map(day => <option key={ymd(day)} value={ymd(day)}>{dayLabel(day)}</option>)}
          </select>
        </label>

        <button
          type="button"
          onClick={assign}
          disabled={!selectedTask || !dayKey || loading}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-40"
        >
          Assign
        </button>
      </div>

      {selectedTask && (
        <div className="text-xs text-slate-500">
          {selectedTask.course || 'Unassigned'} · due {dueLabel(selectedTask.dueDate)} · estimated {minutesLabel(estimateMinutesForTask(selectedTask).minutes)}
        </div>
      )}
    </section>
  );
}
