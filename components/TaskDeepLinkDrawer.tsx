'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';

type Task = {
  id: string; title: string; course?: string | null; courseId?: string | null; dueDate: string;
  workflowState?: string; displayState?: string; blocked?: boolean; blockedBy?: Array<{ id: string; title: string }>;
  atRisk?: boolean; atRiskReason?: string | null; percentComplete?: number; remainingMinutes?: number; loggedMinutes?: number;
  scheduleBlocks?: Array<{ id: string; day: string; plannedMinutes: number }>;
};
type Note = { id: string; title: string; sourceType?: string | null; section?: string | null };

type Workspace = { tasks: Task[] };

function fmtMinutes(value?: number | null) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  const h = Math.floor(n / 60), m = n % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

export default function TaskDeepLinkDrawer() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const taskId = params.get('taskId') || '';
  const [task, setTask] = useState<Task | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!taskId) { setTask(null); setNotes([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [workspace, noteData] = await Promise.all([
          apiFetch<Workspace>('/api/tasks/workspace?allTerms=true'),
          apiFetch<{ notes: Note[] }>(`/api/notes?taskId=${encodeURIComponent(taskId)}&limit=30`).catch(() => ({ notes: [] })),
        ]);
        if (cancelled) return;
        setTask((workspace.tasks || []).find(item => String(item.id) === String(taskId)) || null);
        setNotes(noteData.notes || []);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  const closeHref = useMemo(() => {
    const next = new URLSearchParams(params.toString());
    next.delete('taskId');
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [params, pathname]);

  if (!taskId) return null;
  return <div className="fixed inset-0 z-[1600] bg-black/55" onClick={() => router.push(closeHref)}>
    <aside role="dialog" aria-modal="true" aria-label="Task details" className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#0b1727] p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Task</div>
          <h2 className="mt-1 text-xl font-medium">{loading ? 'Loading…' : task?.title || 'Task not found'}</h2>
          {task?.course ? <div className="mt-1 text-sm text-slate-400">{task.course}</div> : null}
        </div>
        <button aria-label="Close task details" onClick={() => router.push(closeHref)} className="px-2 py-1 rounded border border-white/10">×</button>
      </div>

      {task ? <div className="mt-5 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Card label="State" value={task.displayState || task.workflowState || 'not started'} />
          <Card label="Due" value={new Date(task.dueDate).toLocaleString()} />
          <Card label="Progress" value={`${Math.max(0, Math.min(100, Math.round(task.percentComplete || 0)))}%`} />
          <Card label="Remaining" value={fmtMinutes(task.remainingMinutes)} />
        </div>

        {task.atRisk ? <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><div className="font-medium text-amber-200">At risk</div><div className="mt-1 text-xs text-amber-100/75">{task.atRiskReason || 'This work is at risk before its deadline.'}</div></div> : null}
        {task.blocked && task.blockedBy?.length ? <div className="rounded border border-rose-500/25 bg-rose-500/5 p-3"><div className="text-sm font-medium text-rose-200">Blocked by</div><div className="mt-2 space-y-1">{task.blockedBy.map(item => <Link key={item.id} href={`${pathname}?taskId=${encodeURIComponent(item.id)}`} className="block text-xs">{item.title} →</Link>)}</div></div> : null}

        <div className="rounded border border-white/10 p-3">
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">Linked study materials</h3><span className="text-xs text-slate-500">{notes.length}</span></div>
          <div className="mt-2 divide-y divide-white/10">
            {notes.length ? notes.map(note => <Link key={note.id} href={`/notes?pageId=${encodeURIComponent(note.id)}`} className="block py-2.5">
              <div className="text-sm">{note.title}</div><div className="text-xs text-slate-500">{note.sourceType || 'note'}{note.section ? ` · ${note.section}` : ''}</div>
            </Link>) : <div className="py-3 text-xs text-slate-400">No notes or case briefs are linked to this task yet.</div>}
          </div>
        </div>

        {task.scheduleBlocks?.length ? <div className="rounded border border-white/10 p-3"><h3 className="text-sm font-medium">Scheduled work</h3><div className="mt-2 space-y-2">{task.scheduleBlocks.map(block => <div key={block.id} className="flex justify-between text-xs text-slate-400"><span>{new Date(`${block.day}T12:00:00`).toLocaleDateString()}</span><span>{fmtMinutes(block.plannedMinutes)}</span></div>)}</div></div> : null}

        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={`/tasks?taskId=${encodeURIComponent(task.id)}`} className="px-3 py-2 rounded border border-white/10">Open in Tasks</Link>
          {task.courseId ? <Link href={`/courses/${encodeURIComponent(task.courseId)}`} className="px-3 py-2 rounded border border-white/10">Open course</Link> : null}
          {task.course ? <Link href={`/reading?course=${encodeURIComponent(task.course)}`} className="px-3 py-2 rounded border border-white/10">Course reading</Link> : null}
        </div>
      </div> : !loading ? <div className="mt-5 text-sm text-slate-400">This task is no longer available in the active workspace.</div> : null}
    </aside>
  </div>;
}

function Card({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-white/10 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-sm capitalize">{value}</div></div>;
}
