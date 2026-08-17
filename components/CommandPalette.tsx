'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { onTasksChanged } from '@/lib/taskBus';
import { useSemester } from '@/lib/useSemester';

export const COMMAND_PALETTE_EVENT = 'app:command-palette';
export function openCommandPalette(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(COMMAND_PALETTE_EVENT));
}

type TaskResult = {
  id: string; title: string; course?: string | null; courseId?: string | null; dueDate: string; term?: string | null;
  workflowState?: string; displayState?: string; blocked?: boolean; atRisk?: boolean; atRiskReason?: string | null;
};
type NoteResult = { id: string; title: string; course: string | null; notebookName?: string | null; section: string; excerpt?: string; sourceType?: string | null };
type CourseResult = { id: string; title: string; code?: string | null; semester?: string | null; year?: number | null };

function norm(value: string) { return (value || '').toLowerCase(); }

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [tasks, setTasks] = useState<TaskResult[]>([]);
  const [courses, setCourses] = useState<CourseResult[]>([]);
  const [notes, setNotes] = useState<NoteResult[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const { currentTerm, showAllTerms } = useSemester();
  const pathname = usePathname() || '/';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(v => !v); setQ(''); }
      else if (e.key === 'Escape') setOpen(false);
    };
    const onRequest = () => { setOpen(true); setQ(''); };
    window.addEventListener('keydown', onKey);
    window.addEventListener(COMMAND_PALETTE_EVENT, onRequest);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(COMMAND_PALETTE_EVENT, onRequest); };
  }, []);

  async function refreshCore() {
    try {
      const [taskRes, courseRes] = await Promise.all([
        fetch('/api/tasks/workspace?allTerms=true', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/courses', { cache: 'no-store' }).then(r => r.json()),
      ]);
      setTasks(Array.isArray(taskRes?.tasks) ? taskRes.tasks : []);
      setCourses(Array.isArray(courseRes?.courses) ? courseRes.courses : []);
    } catch {}
  }

  useEffect(() => { if (open) void refreshCore(); }, [open]);
  useEffect(() => { if (!open) return; return onTasksChanged(() => { void refreshCore(); }); }, [open]);

  useEffect(() => {
    if (!open) { setNotes([]); return; }
    const query = q.trim();
    if (!query) { setNotes([]); setNotesLoading(false); return; }
    setNotesLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/notes?q=${encodeURIComponent(query)}&limit=10`, { cache: 'no-store' });
        const data = await res.json();
        setNotes(Array.isArray(data?.notes) ? data.notes : []);
      } catch { setNotes([]); }
      finally { setNotesLoading(false); }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, q]);

  const taskResults = useMemo(() => {
    const needle = norm(q.trim());
    return tasks
      .filter(task => showAllTerms || !currentTerm || !task.term || task.term === currentTerm)
      .filter(task => !needle || norm(task.title).includes(needle) || norm(task.course || '').includes(needle) || norm(task.displayState || task.workflowState || '').includes(needle))
      .sort((a, b) => Number(Boolean(b.atRisk)) - Number(Boolean(a.atRisk)) || new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, q.trim() ? 12 : 8);
  }, [tasks, q, currentTerm, showAllTerms]);

  const courseResults = useMemo(() => {
    const needle = norm(q.trim());
    if (!needle) return [];
    return courses.filter(course => norm(course.title).includes(needle) || norm(course.code || '').includes(needle)).slice(0, 8);
  }, [courses, q]);

  function openTask(id: string) {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set('taskId', id);
    window.location.href = `${url.pathname}${url.search}`;
  }
  function openNote(id: string) { setOpen(false); window.location.href = `/notes?pageId=${encodeURIComponent(id)}`; }
  function openCourse(id: string) { setOpen(false); window.location.href = `/courses/${encodeURIComponent(id)}`; }

  if (!open) return null;
  return <div className="fixed inset-0 z-[1500] bg-black/55" onClick={() => setOpen(false)}>
    <div role="dialog" aria-modal="true" aria-label="Search and jump" className="mx-auto mt-20 max-w-2xl rounded-lg border border-[#22354f] bg-[#0b1727] p-3 shadow-2xl" onClick={e => e.stopPropagation()}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search tasks, courses, notes, case briefs…" className="w-full px-3 py-2 mb-2" />
      <div className="max-h-[65vh] overflow-y-auto">
        {taskResults.length ? <Group title="Tasks">{taskResults.map(task => <button key={task.id} type="button" onClick={() => openTask(task.id)} className="w-full text-left flex items-center justify-between gap-3 rounded px-2 py-2 hover:bg-white/5">
          <div className="min-w-0"><div className="text-sm truncate">{task.title}</div><div className="text-xs text-slate-500 truncate">{task.course || 'Unassigned'} · {new Date(task.dueDate).toLocaleDateString()}</div></div>
          <div className="shrink-0 text-[10px] uppercase tracking-wide"><span className={task.atRisk ? 'text-amber-300' : task.blocked ? 'text-rose-300' : 'text-slate-500'}>{task.atRisk ? 'At risk' : task.blocked ? 'Blocked' : task.displayState || task.workflowState || 'Open'}</span></div>
        </button>)}</Group> : null}

        {courseResults.length ? <Group title="Courses">{courseResults.map(course => <button key={course.id} type="button" onClick={() => openCourse(course.id)} className="w-full text-left rounded px-2 py-2 hover:bg-white/5"><div className="text-sm">{course.title}</div><div className="text-xs text-slate-500">{course.code || 'Course'}{course.semester && course.year ? ` · ${course.semester} ${course.year}` : ''}</div></button>)}</Group> : null}

        {q.trim() && (notes.length || notesLoading) ? <Group title={notesLoading ? 'Notes · searching…' : 'Notes & case briefs'}>{notes.map(note => <button key={note.id} type="button" onClick={() => openNote(note.id)} className="w-full text-left rounded px-2 py-2 hover:bg-white/5"><div className="text-sm truncate">{note.title}</div><div className="text-xs text-slate-500 truncate">{note.course || note.notebookName || 'Notes'} · {note.section || note.sourceType || 'Page'}</div></button>)}</Group> : null}

        {!taskResults.length && !courseResults.length && !notes.length && !notesLoading ? <div className="p-4 text-sm text-slate-400">No matching tasks, courses, or notes.</div> : null}
      </div>
      <div className="mt-2 border-t border-white/10 pt-2 text-[10px] text-slate-600">Current page: {pathname} · Esc closes</div>
    </div>
  </div>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="py-2"><div className="px-2 pb-1 text-[10px] uppercase tracking-[.12em] text-slate-500">{title}</div>{children}</section>;
}
