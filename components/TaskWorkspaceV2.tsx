"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Course, StudySession, Task } from '@/lib/types';
import AddTaskPanel from '@/components/AddTaskPanel';
import MultiAddDrawer from '@/components/MultiAddDrawer';
import LogModal, { type LogSubmitData } from '@/components/LogModal';
import { apiFetch } from '@/lib/apiClient';
import { notifyToast } from '@/lib/toastBus';
import { notifyTasksChanged } from '@/lib/taskBus';

type ChecklistItem = { id: string; title: string; done: boolean; createdAt: string };
type ReadingMetrics = {
  originalPageRanges: string | null;
  remainingPageRanges: string | null;
  assignedPages: number;
  completedPages: number;
  remainingPages: number;
  percentComplete: number;
  loggedMinutes: number;
  estimatedMinutesRemaining: number;
  paceMinutesPerPage: number;
  paceSource: string;
};
type ScheduleBlock = { id: string; taskId: string; day: string; plannedMinutes: number; title: string; course: string; pages?: number | null; priority?: number | null };
type WorkspaceTask = Task & {
  workflowState: 'not-started' | 'in-progress' | 'done' | 'canceled';
  displayState: 'not-started' | 'in-progress' | 'done' | 'canceled' | 'blocked';
  blocked: boolean;
  blockedBy: Array<{ id: string; title: string }>;
  checklist: ChecklistItem[];
  checklistPercent: number;
  loggedMinutes: number;
  remainingMinutes: number;
  percentComplete: number;
  scheduledMinutes: number;
  scheduleBlocks: ScheduleBlock[];
  sessionCount: number;
  averageFocus: number | null;
  atRisk: boolean;
  atRiskReason: string | null;
  reading: ReadingMetrics | null;
};
type TrashedTask = Task & { deletedAt: string };
type WorkspaceResponse = {
  tasks: WorkspaceTask[];
  trash: TrashedTask[];
  summary: { open: number; inProgress: number; blocked: number; atRisk: number; done: number; canceled: number; trash: number };
  courses: Course[];
};

type EditState = {
  title: string;
  courseId: string;
  activity: string;
  originalPageRanges: string;
  due: string;
  estimate: string;
  estimateTouched: boolean;
  priority: string;
  tags: string;
  notes: string;
  dependsOn: Set<string>;
};

function fmtMinutes(value: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function dueLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function localInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

function stateLabel(state: WorkspaceTask['displayState']): string {
  if (state === 'not-started') return 'Not started';
  if (state === 'in-progress') return 'In progress';
  if (state === 'blocked') return 'Blocked';
  if (state === 'canceled') return 'Canceled';
  return 'Done';
}

function stateClass(state: WorkspaceTask['displayState']): string {
  if (state === 'done') return 'border-emerald-700/50 text-emerald-300 bg-emerald-950/30';
  if (state === 'in-progress') return 'border-blue-700/50 text-blue-300 bg-blue-950/30';
  if (state === 'blocked') return 'border-amber-700/50 text-amber-300 bg-amber-950/30';
  if (state === 'canceled') return 'border-slate-600 text-slate-400 bg-slate-900/40';
  return 'border-white/10 text-slate-300 bg-white/[0.03]';
}

function editStateFor(task: WorkspaceTask): EditState {
  return {
    title: task.title || '',
    courseId: task.courseId || '',
    activity: task.activity || 'other',
    originalPageRanges: task.reading?.originalPageRanges || task.originalPageRanges || '',
    due: localInput(task.dueDate),
    estimate: task.estimatedMinutes == null ? '' : String(task.estimatedMinutes),
    estimateTouched: false,
    priority: task.priority == null ? '' : String(task.priority),
    tags: (task.tags || []).join(', '),
    notes: task.notes || '',
    dependsOn: new Set((task.dependsOn || []).map(String)),
  };
}

export default function TaskWorkspaceV2() {
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('open');
  const [textFilter, setTextFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<'overview'|'progress'|'sessions'|'notes'|'schedule'|'details'>('overview');
  const [multiAdd, setMultiAdd] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [logTask, setLogTask] = useState<WorkspaceTask | null>(null);
  const [logMode, setLogMode] = useState<'partial'|'finish'>('partial');
  const [newChecklist, setNewChecklist] = useState('');
  const [bulkDue, setBulkDue] = useState('');
  const [bulkCourse, setBulkCourse] = useState('');
  const [edit, setEdit] = useState<EditState | null>(null);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [workspace, sessionResponse, notesResponse] = await Promise.all([
        apiFetch<WorkspaceResponse>('/api/tasks/workspace'),
        apiFetch<{ sessions: StudySession[] }>('/api/sessions'),
        apiFetch<{ counts: Record<string, number> }>('/api/notes/by-task').catch(() => ({ counts: {} })),
      ]);
      setData(workspace);
      setSessions(Array.isArray(sessionResponse?.sessions) ? sessionResponse.sessions : []);
      setNoteCounts(notesResponse?.counts || {});
      setSelected(prev => new Set(Array.from(prev).filter(id => workspace.tasks.some(task => task.id === id))));
      if (activeId && !workspace.tasks.some(task => task.id === activeId)) setActiveId(null);
    } catch (e: any) {
      setError(e?.message || 'Unable to load tasks.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const tasks = data?.tasks || [];
  const activeTask = activeId ? tasks.find(task => task.id === activeId) || null : null;

  useEffect(() => {
    if (!activeTask) { setEdit(null); return; }
    setEdit(editStateFor(activeTask));
    setNewChecklist('');
  }, [activeId, activeTask?.updatedAt]);

  const filtered = useMemo(() => tasks.filter(task => {
    if (courseFilter && (task.course || '').toLowerCase() !== courseFilter.toLowerCase()) return false;
    if (textFilter) {
      const haystack = `${task.title} ${task.course || ''} ${(task.tags || []).join(' ')}`.toLowerCase();
      if (!haystack.includes(textFilter.toLowerCase())) return false;
    }
    if (stateFilter === 'all') return true;
    if (stateFilter === 'open') return !['done', 'canceled'].includes(task.workflowState);
    if (stateFilter === 'at-risk') return task.atRisk;
    return task.displayState === stateFilter || task.workflowState === stateFilter;
  }), [tasks, courseFilter, textFilter, stateFilter]);

  async function mutate(label: string, fn: () => Promise<any>) {
    try {
      await fn();
      notifyToast({ kind: 'success', message: label });
      try { notifyTasksChanged(); } catch {}
      await refresh();
    } catch (e: any) {
      notifyToast({ kind: 'error', message: e?.message || 'Unable to update task.' });
    }
  }

  function openTask(task: WorkspaceTask) {
    setActiveId(task.id);
    setDrawerTab('overview');
    setNewChecklist('');
  }

  function openLog(task: WorkspaceTask, mode: 'partial'|'finish') {
    setLogTask(task);
    setLogMode(mode);
  }

  async function submitLog(payload: LogSubmitData) {
    if (!logTask) return;
    await mutate(payload.isPartial ? 'Progress logged.' : 'Task completed.', async () => {
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
      setLogTask(null);
    });
  }

  async function trash(task: WorkspaceTask) {
    await mutate('Moved to Trash.', () => apiFetch(`/api/tasks/${task.id}`, { method: 'DELETE' }));
  }

  async function cancel(task: WorkspaceTask, reactivate = false) {
    await mutate(reactivate ? 'Task reactivated.' : 'Task canceled.', () => apiFetch(`/api/tasks/${task.id}/cancel`, { method: 'POST', body: { reactivate } }));
  }

  async function reopen(task: WorkspaceTask) {
    await mutate('Task reopened.', () => apiFetch(`/api/tasks/${task.id}/reopen`, { method: 'POST', body: {} }));
  }

  async function smartSplit(task: WorkspaceTask) {
    await mutate('Reading plan updated.', () => apiFetch(`/api/tasks/${task.id}/smart-split`, { method: 'POST', body: {} }));
  }

  async function reconcile(task: WorkspaceTask) {
    await mutate('Schedule reconciled.', () => apiFetch(`/api/tasks/${task.id}/reconcile`, { method: 'POST', body: {} }));
  }

  async function saveChecklist(items: ChecklistItem[]) {
    if (!activeTask) return;
    await mutate('Checklist updated.', () => apiFetch(`/api/tasks/${activeTask.id}/checklist`, { method: 'PUT', body: { items } }));
  }

  async function addChecklist() {
    if (!activeTask || !newChecklist.trim()) return;
    const item: ChecklistItem = { id: crypto.randomUUID(), title: newChecklist.trim(), done: false, createdAt: new Date().toISOString() };
    setNewChecklist('');
    await saveChecklist([...(activeTask.checklist || []), item]);
  }

  async function saveDetails() {
    if (!activeTask || !edit) return;
    const rangeChanged = (edit.originalPageRanges || '') !== (activeTask.reading?.originalPageRanges || activeTask.originalPageRanges || '');
    const body: any = {
      title: edit.title.trim(),
      courseId: edit.courseId || null,
      activity: edit.activity || null,
      dueDate: edit.due ? new Date(edit.due).toISOString() : activeTask.dueDate,
      priority: edit.priority ? Number(edit.priority) : null,
      tags: edit.tags.split(',').map(tag => tag.trim()).filter(Boolean),
      notes: edit.notes.trim() || null,
      dependsOn: Array.from(edit.dependsOn),
    };
    if (edit.activity === 'reading') body.originalPageRanges = edit.originalPageRanges.trim() || null;
    if (edit.estimateTouched || !rangeChanged || activeTask.estimateOrigin === 'manual') body.estimatedMinutes = edit.estimate ? Math.max(0, Number(edit.estimate)) : null;
    let updatedTask: Task | null = null;
    await mutate('Task updated.', async () => {
      const response = await apiFetch<{ task: Task }>(`/api/tasks/${activeTask.id}`, { method: 'PATCH', body });
      updatedTask = response.task || null;
      return response;
    });
    if (updatedTask) {
      setData(prev => prev ? {
        ...prev,
        tasks: prev.tasks.map(task => task.id === updatedTask!.id ? { ...task, ...updatedTask, loggedMinutes: task.loggedMinutes, percentComplete: task.percentComplete } : task),
      } : prev);
    }
  }

  async function bulkTrash() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    await mutate(`Moved ${ids.length} task${ids.length === 1 ? '' : 's'} to Trash.`, async () => {
      for (const id of ids) await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
      setSelected(new Set());
    });
  }

  async function bulkCancel() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    await mutate(`Canceled ${ids.length} task${ids.length === 1 ? '' : 's'}.`, async () => {
      for (const id of ids) await apiFetch(`/api/tasks/${id}/cancel`, { method: 'POST', body: { reactivate: false } });
      setSelected(new Set());
    });
  }

  async function bulkApply() {
    const ids = Array.from(selected);
    if (!ids.length || (!bulkDue && !bulkCourse)) return;
    await mutate(`Updated ${ids.length} task${ids.length === 1 ? '' : 's'}.`, async () => {
      for (const id of ids) {
        const body: any = {};
        if (bulkDue) body.dueDate = new Date(`${bulkDue}T23:59:00`).toISOString();
        if (bulkCourse) body.courseId = bulkCourse;
        await apiFetch(`/api/tasks/${id}`, { method: 'PATCH', body });
      }
      setSelected(new Set());
      setBulkDue('');
      setBulkCourse('');
    });
  }

  const taskSessions = activeTask
    ? sessions.filter(session => String(session.taskId || '') === String(activeTask.id)).sort((a, b) => +new Date(b.when) - +new Date(a.when))
    : [];

  return (
    <div className="space-y-4">
      <section className="card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-medium">Task workspace</h2>
            <p className="text-sm text-slate-400 mt-1">Plan work, record progress, manage prerequisites, and keep the weekly schedule synchronized.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/reading" className="px-3 py-2 rounded border border-white/10 text-sm">Reading tracker</Link>
            <button onClick={() => setTrashOpen(v => !v)} className="px-3 py-2 rounded border border-white/10 text-sm">Trash{data?.summary.trash ? ` · ${data.summary.trash}` : ''}</button>
            <button onClick={() => setMultiAdd(v => !v)} className="px-3 py-2 rounded border border-white/10 text-sm">{multiAdd ? 'Close multi-add' : 'Multi-add'}</button>
          </div>
        </div>

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {[
              ['Open', data.summary.open],
              ['In progress', data.summary.inProgress],
              ['Blocked', data.summary.blocked],
              ['At risk', data.summary.atRisk],
              ['Done', data.summary.done],
              ['Canceled', data.summary.canceled],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
                <div className="mt-1 text-lg font-medium">{value}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-4">
        <AddTaskPanel onCreated={refresh} />
        {multiAdd && <div className="mt-3"><MultiAddDrawer onCreated={refresh} /></div>}
      </section>

      {trashOpen && (
        <section className="card p-4 space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-medium">Trash</h3><span className="text-xs text-slate-500">Restore keeps the original task ID, sessions, note links, and saved schedule.</span></div>
          {!data?.trash.length ? <p className="text-sm text-slate-400">Trash is empty.</p> : data.trash.map(task => (
            <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-white/10 p-3">
              <div><div className="font-medium">{task.title}</div><div className="text-xs text-slate-500">{task.course || 'Unassigned'} · deleted {new Date(task.deletedAt).toLocaleString()}</div></div>
              <div className="flex gap-2">
                <button onClick={() => mutate('Task restored.', () => apiFetch(`/api/tasks/${task.id}/restore`, { method: 'POST', body: {} }))} className="px-3 py-1.5 rounded border border-white/10 text-xs">Restore</button>
                <button onClick={async () => { if (!window.confirm('Delete this task permanently? Its task relationship cannot be restored after this.')) return; await mutate('Task permanently deleted.', () => apiFetch(`/api/tasks/${task.id}/purge`, { method: 'DELETE' })); }} className="px-3 py-1.5 rounded border border-rose-700 text-rose-300 text-xs">Delete permanently</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className="px-3 py-2">
            <option value="open">Open</option><option value="not-started">Not started</option><option value="in-progress">In progress</option><option value="blocked">Blocked</option><option value="at-risk">At risk</option><option value="done">Done</option><option value="canceled">Canceled</option><option value="all">All</option>
          </select>
          <select value={courseFilter} onChange={e => setCourseFilter(e.target.value)} className="px-3 py-2"><option value="">All courses</option>{(data?.courses || []).map(course => <option key={course.id} value={course.title}>{course.title}</option>)}</select>
          <input value={textFilter} onChange={e => setTextFilter(e.target.value)} placeholder="Search tasks…" className="px-3 py-2" />
          <button onClick={refresh} className="px-3 py-2 rounded border border-white/10">Refresh</button>
        </div>

        {selected.size > 0 && (
          <div className="rounded-lg border border-blue-900/50 bg-blue-950/20 p-3 flex flex-wrap items-end gap-2">
            <div className="text-sm mr-2">{selected.size} selected</div>
            <button onClick={bulkCancel} className="px-2.5 py-1.5 rounded border border-white/10 text-xs">Cancel</button>
            <button onClick={bulkTrash} className="px-2.5 py-1.5 rounded border border-rose-700 text-rose-300 text-xs">Trash</button>
            <input type="date" value={bulkDue} onChange={e => setBulkDue(e.target.value)} className="px-2 py-1.5 text-xs" />
            <select value={bulkCourse} onChange={e => setBulkCourse(e.target.value)} className="px-2 py-1.5 text-xs"><option value="">Keep course</option>{(data?.courses || []).map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select>
            <button onClick={bulkApply} disabled={!bulkDue && !bulkCourse} className="px-2.5 py-1.5 rounded border border-white/10 text-xs disabled:opacity-40">Apply changes</button>
            <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-slate-400">Clear selection</button>
          </div>
        )}

        {error && <div className="rounded border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-300">{error}</div>}
        {loading && !data ? <div className="p-6 text-sm text-slate-400">Loading tasks…</div> : filtered.length === 0 ? <div className="p-6 text-sm text-slate-400">No tasks match this view.</div> : (
          <div className="space-y-2">
            {filtered.map(task => (
              <div key={task.id} onClick={() => openTask(task)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTask(task); } }} role="button" tabIndex={0} aria-label={`Open ${task.title}`} className="rounded-lg border border-white/10 bg-white/[0.015] p-3 hover:bg-white/[0.035] cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/60">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_190px_135px_250px] gap-3 items-center">
                  <input type="checkbox" checked={selected.has(task.id)} onChange={e => { e.stopPropagation(); setSelected(prev => { const next = new Set(prev); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next; }); }} onClick={e => e.stopPropagation()} aria-label={`Select ${task.title}`} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><button type="button" className="font-medium truncate text-left hover:underline focus:outline-none focus:underline" onClick={e => { e.stopPropagation(); openTask(task); }}>{task.title}</button><span className={`text-[10px] px-2 py-0.5 rounded-full border ${stateClass(task.displayState)}`}>{stateLabel(task.displayState)}</span>{task.atRisk && <span className="text-[10px] px-2 py-0.5 rounded-full border border-rose-700/60 text-rose-300 bg-rose-950/30">At risk</span>}</div>
                    <div className="text-xs text-slate-500 mt-1">{task.course || 'Unassigned'}{task.activity ? ` · ${task.activity}` : ''}{task.blockedBy.length ? ` · waiting on ${task.blockedBy.map(item => item.title).join(', ')}` : ''}</div>
                    <div className="mt-2 h-1.5 rounded bg-white/10 overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, task.percentComplete))}%` }} /></div>
                  </div>
                  <div className="hidden lg:block text-xs"><div className="text-slate-500">Due</div><div>{dueLabel(task.dueDate)}</div></div>
                  <div className="hidden lg:block text-xs"><div className="text-slate-500">Remaining</div><div>{fmtMinutes(task.remainingMinutes)}</div><div className="text-slate-500">{task.percentComplete}% complete</div></div>
                  <div className="hidden lg:flex justify-end gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
                    {!task.blocked && !['done', 'canceled'].includes(task.workflowState) && <button onClick={() => openLog(task, 'partial')} className="px-2 py-1 rounded border border-white/10 text-xs">Log progress</button>}
                    {!task.blocked && !['done', 'canceled'].includes(task.workflowState) && <button onClick={() => openLog(task, 'finish')} className="px-2 py-1 rounded border border-emerald-700 text-emerald-300 text-xs">Finish</button>}
                    {task.workflowState === 'done' && <button onClick={() => reopen(task)} className="px-2 py-1 rounded border border-white/10 text-xs">Reopen</button>}
                    {task.workflowState === 'canceled' ? <button onClick={() => cancel(task, true)} className="px-2 py-1 rounded border border-white/10 text-xs">Reactivate</button> : task.workflowState !== 'done' && <button onClick={() => cancel(task)} className="px-2 py-1 rounded border border-white/10 text-xs">Cancel</button>}
                    <button onClick={() => trash(task)} className="px-2 py-1 rounded border border-rose-800 text-rose-300 text-xs">Trash</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {activeTask && (
        <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/60" onClick={() => setActiveId(null)} aria-label="Close task details" />
          <aside className="relative z-10 h-full w-full max-w-2xl bg-[#07111f] border-l border-white/10 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 z-20 bg-[#07111f]/95 backdrop-blur border-b border-white/10 px-5 py-4">
              <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap gap-2 items-center"><h2 className="text-xl font-medium truncate">{activeTask.title}</h2><span className={`text-[10px] px-2 py-0.5 rounded-full border ${stateClass(activeTask.displayState)}`}>{stateLabel(activeTask.displayState)}</span></div><div className="text-xs text-slate-500 mt-1">{activeTask.course || 'Unassigned'} · due {dueLabel(activeTask.dueDate)}</div></div><button onClick={() => setActiveId(null)} aria-label="Close task details" className="text-xl text-slate-400">×</button></div>
              <div className="flex gap-1 mt-4 overflow-x-auto">{(['overview','progress','sessions','notes','schedule','details'] as const).map(tab => <button key={tab} onClick={() => setDrawerTab(tab)} className={`px-3 py-1.5 rounded text-xs capitalize ${drawerTab === tab ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5'}`}>{tab}</button>)}</div>
            </div>

            <div className="p-5 space-y-4">
              {drawerTab === 'overview' && <>
                {activeTask.atRisk && <div className="rounded border border-rose-800/60 bg-rose-950/25 p-3 text-sm text-rose-200"><b>At risk:</b> {activeTask.atRiskReason}</div>}
                {activeTask.blocked && <div className="rounded border border-amber-800/60 bg-amber-950/25 p-3 text-sm text-amber-200"><b>Blocked:</b> complete {activeTask.blockedBy.map(item => item.title).join(', ')} first.</div>}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{[
                  ['Progress', `${activeTask.percentComplete}%`], ['Logged', fmtMinutes(activeTask.loggedMinutes)], ['Remaining', fmtMinutes(activeTask.remainingMinutes)], ['Scheduled', fmtMinutes(activeTask.scheduledMinutes)],
                ].map(([label,value]) => <div key={label} className="rounded border border-white/10 p-3"><div className="text-[10px] uppercase text-slate-500">{label}</div><div className="mt-1 font-medium">{value}</div></div>)}</div>
                <div className="rounded border border-white/10 p-4 space-y-2 text-sm"><div><span className="text-slate-500">Activity:</span> {activeTask.activity || 'Other'}</div><div><span className="text-slate-500">Priority:</span> {activeTask.priority || '—'}</div><div><span className="text-slate-500">Study sessions:</span> {activeTask.sessionCount}</div><div><span className="text-slate-500">Average focus:</span> {activeTask.averageFocus ?? '—'}</div>{activeTask.tags?.length ? <div><span className="text-slate-500">Tags:</span> {activeTask.tags.join(', ')}</div> : null}{activeTask.notes ? <div className="pt-2 border-t border-white/10 whitespace-pre-wrap">{activeTask.notes}</div> : null}</div>
                {activeTask.reading && <div className="rounded border border-white/10 p-4 space-y-2 text-sm"><h3 className="font-medium">Reading progress</h3><div><span className="text-slate-500">Assigned:</span> {activeTask.reading.originalPageRanges || '—'} ({activeTask.reading.assignedPages} pages)</div><div><span className="text-slate-500">Remaining:</span> {activeTask.reading.remainingPageRanges || 'Complete'} ({activeTask.reading.remainingPages} pages)</div><div><span className="text-slate-500">Pace:</span> {activeTask.reading.paceMinutesPerPage} min/page · {activeTask.reading.paceSource}</div></div>}
              </>}

              {drawerTab === 'progress' && <>
                <div className="flex flex-wrap gap-2">{!activeTask.blocked && !['done','canceled'].includes(activeTask.workflowState) && <><button onClick={() => openLog(activeTask, 'partial')} className="px-3 py-2 rounded border border-white/10">Log partial progress</button><button onClick={() => openLog(activeTask, 'finish')} className="px-3 py-2 rounded border border-emerald-700 text-emerald-300">Finish task</button></>}{activeTask.workflowState === 'done' && <button onClick={() => reopen(activeTask)} className="px-3 py-2 rounded border border-white/10">Reopen task</button>}</div>
                <div className="rounded border border-white/10 p-4 space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium">Checklist</h3><span className="text-xs text-slate-500">{activeTask.checklistPercent}%</span></div>{activeTask.checklist.map(item => <div key={item.id} className="flex items-center gap-2"><input type="checkbox" checked={item.done} onChange={() => saveChecklist(activeTask.checklist.map(x => x.id === item.id ? { ...x, done: !x.done } : x))} /><span className={`flex-1 text-sm ${item.done ? 'line-through text-slate-500' : ''}`}>{item.title}</span><button onClick={() => saveChecklist(activeTask.checklist.filter(x => x.id !== item.id))} className="text-xs text-rose-300">Remove</button></div>)}<div className="flex gap-2"><input value={newChecklist} onChange={e => setNewChecklist(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addChecklist(); } }} placeholder="Add a step…" className="flex-1 px-3 py-2" /><button onClick={addChecklist} className="px-3 py-2 rounded border border-white/10">Add</button></div></div>
              </>}

              {drawerTab === 'sessions' && <div className="space-y-2">{!taskSessions.length ? <p className="text-sm text-slate-400">No study sessions logged yet.</p> : taskSessions.map(session => <div key={session.id} className="rounded border border-white/10 p-3 text-sm"><div className="flex justify-between gap-3"><span>{new Date(session.when).toLocaleString()}</span><b>{fmtMinutes(session.minutes)}</b></div><div className="text-xs text-slate-500 mt-1">Focus {session.focus ?? '—'}{session.pagesRead ? ` · ${session.pagesRead} pages` : ''}{session.practiceQs ? ` · ${session.practiceQs} practice questions` : ''}</div>{session.notes && <div className="mt-2 text-slate-300">{session.notes}</div>}</div>)}</div>}

              {drawerTab === 'notes' && <div className="rounded border border-white/10 p-4 space-y-3"><div className="text-sm">{noteCounts[activeTask.id] || 0} linked note page{(noteCounts[activeTask.id] || 0) === 1 ? '' : 's'}.</div><p className="text-xs text-slate-500">Linked class notes, reading notes, and case briefs stay attached to this task even if the task is moved to Trash and restored.</p><Link href={`/notes?taskId=${encodeURIComponent(activeTask.id)}`} className="inline-flex px-3 py-2 rounded border border-white/10 text-sm">Open linked notes</Link></div>}

              {drawerTab === 'schedule' && <div className="space-y-3"><div className="flex flex-wrap gap-2">{activeTask.reading && <button disabled={activeTask.blocked || ['done','canceled'].includes(activeTask.workflowState)} onClick={() => smartSplit(activeTask)} className="px-3 py-2 rounded border border-white/10 disabled:opacity-40">Smart split reading</button>}<button onClick={() => reconcile(activeTask)} className="px-3 py-2 rounded border border-white/10">Reconcile schedule</button><Link href="/week-plan" className="px-3 py-2 rounded border border-white/10">Open week plan</Link></div>{!activeTask.scheduleBlocks.length ? <p className="text-sm text-slate-400">This task is not currently scheduled.</p> : activeTask.scheduleBlocks.slice().sort((a,b)=>a.day.localeCompare(b.day)).map(block => <div key={block.id} className="rounded border border-white/10 p-3 flex justify-between gap-3"><div><div className="font-medium">{new Date(`${block.day}T12:00:00`).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</div><div className="text-xs text-slate-500">{block.pages ? `${block.pages} pages · ` : ''}{block.title}</div></div><b>{fmtMinutes(block.plannedMinutes)}</b></div>)}</div>}

              {drawerTab === 'details' && edit && <div className="space-y-4">
                <div><label className="block text-xs text-slate-500 mb-1">Title</label><input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} className="w-full px-3 py-2" /></div>
                <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs text-slate-500 mb-1">Course</label><select value={edit.courseId} onChange={e => setEdit({ ...edit, courseId: e.target.value })} className="w-full px-3 py-2"><option value="">Unassigned</option>{(data?.courses || []).map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></div><div><label className="block text-xs text-slate-500 mb-1">Activity</label><select value={edit.activity} onChange={e => setEdit({ ...edit, activity: e.target.value })} className="w-full px-3 py-2"><option value="reading">Reading</option><option value="assignment">Assignment</option><option value="review">Review</option><option value="outline">Outline</option><option value="practice">Practice</option><option value="other">Other</option></select></div></div>
                {edit.activity === 'reading' && <div><label className="block text-xs text-slate-500 mb-1">Assigned page ranges</label><input value={edit.originalPageRanges} onChange={e => setEdit({ ...edit, originalPageRanges: e.target.value })} placeholder="100-150, 160-175" className="w-full px-3 py-2" /><div className="text-xs text-slate-500 mt-1">Already-completed pages are preserved when the assigned range changes.</div></div>}
                <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs text-slate-500 mb-1">Due</label><input type="datetime-local" value={edit.due} onChange={e => setEdit({ ...edit, due: e.target.value })} className="w-full px-3 py-2" /></div><div><label className="block text-xs text-slate-500 mb-1">Priority</label><input type="number" min={1} max={5} value={edit.priority} onChange={e => setEdit({ ...edit, priority: e.target.value })} className="w-full px-3 py-2" /></div></div>
                <div><label className="block text-xs text-slate-500 mb-1">Remaining estimate (minutes)</label><input type="number" min={0} value={edit.estimate} onChange={e => setEdit({ ...edit, estimate: e.target.value, estimateTouched: true })} className="w-full px-3 py-2" /><div className="text-xs text-slate-500 mt-1">For readings, changing page ranges recalculates this automatically unless you edit the estimate manually.</div></div>
                <div><label className="block text-xs text-slate-500 mb-1">Tags</label><input value={edit.tags} onChange={e => setEdit({ ...edit, tags: e.target.value })} placeholder="exam-prep, important" className="w-full px-3 py-2" /></div>
                <div><label className="block text-xs text-slate-500 mb-1">Notes</label><textarea value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} rows={4} className="w-full px-3 py-2" /></div>
                <div><label className="block text-xs text-slate-500 mb-2">Prerequisites</label><div className="max-h-48 overflow-y-auto rounded border border-white/10 p-2 space-y-1">{tasks.filter(task => task.id !== activeTask.id && task.workflowState !== 'canceled').map(task => <label key={task.id} className="flex items-center gap-2 text-sm p-1.5 rounded hover:bg-white/5"><input type="checkbox" checked={edit.dependsOn.has(task.id)} onChange={() => setEdit(prev => { if (!prev) return prev; const next = new Set(prev.dependsOn); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return { ...prev, dependsOn: next }; })} /><span className="flex-1">{task.title}</span><span className="text-xs text-slate-500">{stateLabel(task.displayState)}</span></label>)}</div></div>
                <div className="flex flex-wrap justify-between gap-2 pt-3 border-t border-white/10"><div className="flex gap-2">{activeTask.workflowState === 'canceled' ? <button onClick={() => cancel(activeTask, true)} className="px-3 py-2 rounded border border-white/10">Reactivate</button> : activeTask.workflowState !== 'done' && <button onClick={() => cancel(activeTask)} className="px-3 py-2 rounded border border-white/10">Cancel task</button>}<button onClick={() => trash(activeTask)} className="px-3 py-2 rounded border border-rose-800 text-rose-300">Move to Trash</button></div><button onClick={saveDetails} className="px-4 py-2 rounded bg-blue-600 text-white">Save changes</button></div>
              </div>}
            </div>
          </aside>
        </div>
      )}

      <LogModal isOpen={Boolean(logTask)} onClose={() => setLogTask(null)} onSubmit={submitLog} task={logTask} mode={logMode} />
    </div>
  );
}
