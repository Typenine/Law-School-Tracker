"use client";

import { useEffect, useMemo, useState } from 'react';
import LogModal, { type LogSubmitData } from '@/components/LogModal';
import { apiFetch } from '@/lib/apiClient';
import { notifyScheduleChanged } from '@/lib/scheduleBus';
import { notifySessionsChanged } from '@/lib/sessionsBus';
import { notifyTasksChanged } from '@/lib/taskBus';
import { notifyToast } from '@/lib/toastBus';
import { useTaskTimers } from '@/lib/useTaskTimers';
import { useTasks, type SurfaceTask } from '@/lib/useTasks';

function clockLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function dueLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function TaskTimerBar() {
  const { tasks, loading } = useTasks();
  const { timers, ready, runningTaskId, elapsedMs, toggleTimer, clearTimer } = useTaskTimers();
  const [taskId, setTaskId] = useState('');
  const [logTask, setLogTask] = useState<SurfaceTask | null>(null);
  const [logMode, setLogMode] = useState<'partial' | 'finish'>('partial');
  const [saving, setSaving] = useState(false);

  const availableTasks = useMemo(() => tasks
    .filter(task => task.status === 'todo' && !task.blocked && !['done', 'canceled'].includes(task.workflowState || 'not-started'))
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()), [tasks]);

  useEffect(() => {
    if (runningTaskId && availableTasks.some(task => task.id === runningTaskId)) {
      setTaskId(runningTaskId);
      return;
    }
    setTaskId(current => current && availableTasks.some(task => task.id === current)
      ? current
      : (availableTasks[0]?.id || ''));
  }, [availableTasks, runningTaskId]);

  const selectedTask = availableTasks.find(task => task.id === taskId) || null;
  const selectedTimer = selectedTask ? timers[selectedTask.id] : null;
  const selectedElapsed = selectedTask ? elapsedMs(selectedTask.id) : 0;

  function openLog(mode: 'partial' | 'finish') {
    if (!selectedTask) return;
    if (timers[selectedTask.id]?.running) toggleTimer(selectedTask.id);
    setLogTask(selectedTask);
    setLogMode(mode);
  }

  async function submitLog(payload: LogSubmitData) {
    if (!logTask || saving) return;
    setSaving(true);
    try {
      await apiFetch(`/api/tasks/${logTask.id}/progress`, {
        method: 'POST',
        body: {
          mode: payload.isPartial ? 'partial' : 'finish',
          minutes: payload.minutes,
          focus: payload.focus,
          notes: payload.notes || null,
          pagesCompleted: payload.pagesCompleted || null,
          moveToDay: payload.moveToDay || null,
          completionDate: payload.completionDate || null,
        },
      });
      if (!payload.isPartial) clearTimer(logTask.id);
      setLogTask(null);
      notifySessionsChanged();
      notifyTasksChanged();
      notifyScheduleChanged();
      notifyToast({ kind: 'success', message: payload.isPartial ? 'Progress logged.' : 'Task completed.' });
    } catch (error: any) {
      notifyToast({ kind: 'error', message: error?.message || 'Unable to log task progress.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 lg:w-48">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Task timer</div>
            <div className="text-sm text-slate-400 mt-1">Start work from the Tasks page.</div>
          </div>

          <select
            value={taskId}
            onChange={event => setTaskId(event.target.value)}
            disabled={loading || !ready || !availableTasks.length}
            className="min-w-0 flex-1 px-3 py-2"
            aria-label="Task to time"
          >
            {!availableTasks.length && <option value="">No available tasks</option>}
            {availableTasks.map(task => (
              <option key={task.id} value={task.id}>
                {task.course ? `${task.course}: ` : ''}{task.title} · due {dueLabel(task.dueDate)}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 flex-wrap lg:justify-end">
            <div className={`min-w-24 px-3 py-2 rounded border text-center font-mono text-sm ${selectedTimer?.running ? 'border-emerald-700/60 text-emerald-300 bg-emerald-950/25' : 'border-white/10 text-slate-200'}`}>
              {clockLabel(selectedElapsed)}
            </div>
            <button
              type="button"
              onClick={() => selectedTask && toggleTimer(selectedTask.id)}
              disabled={!selectedTask || !ready}
              className={`px-4 py-2 rounded disabled:opacity-40 ${selectedTimer?.running ? 'border border-amber-700 text-amber-300' : 'bg-blue-600 text-white'}`}
            >
              {selectedTimer?.running ? 'Pause' : selectedElapsed > 0 ? 'Resume' : 'Start timer'}
            </button>
            {selectedElapsed > 0 && !selectedTimer?.running && (
              <button type="button" onClick={() => selectedTask && clearTimer(selectedTask.id)} className="px-3 py-2 rounded border border-white/10 text-sm">Reset</button>
            )}
            <button type="button" onClick={() => openLog('partial')} disabled={!selectedTask || selectedElapsed < 1000} className="px-3 py-2 rounded border border-white/10 text-sm disabled:opacity-40">Log progress</button>
            <button type="button" onClick={() => openLog('finish')} disabled={!selectedTask} className="px-3 py-2 rounded border border-emerald-700 text-emerald-300 text-sm disabled:opacity-40">Finish</button>
          </div>
        </div>

        {runningTaskId && selectedTask?.id === runningTaskId && (
          <div className="mt-3 text-xs text-emerald-300">Timer running for {selectedTask.title}. Starting another task pauses this timer automatically.</div>
        )}
      </section>

      <LogModal
        isOpen={Boolean(logTask)}
        onClose={() => setLogTask(null)}
        onSubmit={submitLog}
        task={logTask}
        mode={logMode}
        defaultMinutes={logTask && elapsedMs(logTask.id) >= 60000 ? Math.max(1, Math.round(elapsedMs(logTask.id) / 60000)) : undefined}
      />
    </>
  );
}
