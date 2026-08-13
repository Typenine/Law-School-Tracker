"use client";
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Course, Task } from '@/lib/types';
import { resolveCourseColor } from '@/lib/colors';

export const dynamic = 'force-dynamic';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Notebook = {
  id: string;
  name: string;
  course: string | null;
  semester: string | null;
  noteCount: number;
  updatedAt: string;
};

type NoteSummary = {
  id: string;
  title: string;
  notebookName: string | null;
  preview: string;
  updatedAt: string;
};

function norm(s: string): string {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim();
}

function fmt12(hhmm?: string | null): string {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return '';
  const h12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function CourseDetailPage({ params }: { params: { id: string } }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [taskError, setTaskError] = useState('');

  const [addingNotebook, setAddingNotebook] = useState(false);
  const [notebookError, setNotebookError] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const [coursesRes, tasksRes, notebooksRes] = await Promise.all([
        fetch(`/api/courses?_ts=${Date.now()}`, { cache: 'no-store' }),
        fetch('/api/tasks', { cache: 'no-store' }),
        fetch('/api/notes/notebooks', { cache: 'no-store' }),
      ]);
      const coursesData = await coursesRes.json().catch(() => ({ courses: [] }));
      const found = ((coursesData.courses || []) as Course[]).find(c => c.id === params.id) || null;
      setCourse(found);
      setNotFound(!found);

      const tasksData = await tasksRes.json().catch(() => ({ tasks: [] }));
      setTasks((tasksData.tasks || []) as Task[]);

      const notebooksData = await notebooksRes.json().catch(() => ({ notebooks: [] }));
      setNotebooks((notebooksData.notebooks || []) as Notebook[]);

      if (found) {
        const notesRes = await fetch(`/api/notes?course=${encodeURIComponent(found.title)}&limit=8`, { cache: 'no-store' });
        const notesData = await notesRes.json().catch(() => ({ notes: [] }));
        setNotes((notesData.notes || []) as NoteSummary[]);
      } else {
        setNotes([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [params.id]);

  const courseKey = norm(course?.title || '');
  const codeKey = norm(course?.code || '');

  const courseTasks = useMemo(() => {
    return tasks.filter(t => {
      const key = norm(t.course || '');
      if (!key) return false;
      return key === courseKey || (!!codeKey && key === codeKey);
    });
  }, [tasks, courseKey, codeKey]);

  const upcomingTasks = useMemo(
    () => courseTasks.filter(t => t.status !== 'done').sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()),
    [courseTasks],
  );
  const doneCount = courseTasks.length - upcomingTasks.length;

  const now = Date.now();

  const courseNotebooks = useMemo(
    () => notebooks.filter(nb => norm(nb.course || nb.name) === courseKey),
    [notebooks, courseKey],
  );

  const blocks = useMemo(() => {
    if (!course) return [];
    if (Array.isArray(course.meetingBlocks) && course.meetingBlocks.length) return course.meetingBlocks;
    if (Array.isArray(course.meetingDays) && course.meetingStart && course.meetingEnd) {
      return [{ days: course.meetingDays, start: course.meetingStart, end: course.meetingEnd, location: course.room || course.location || null }];
    }
    return [];
  }, [course]);

  async function toggleTaskDone(task: Task) {
    const nextStatus = task.status === 'done' ? 'todo' : 'done';
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      const data = await res.json();
      setTasks(prev => prev.map(t => (t.id === task.id ? data.task : t)));
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!course || !newTaskTitle.trim() || !newTaskDue) return;
    setAddingTask(true);
    setTaskError('');
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTaskTitle.trim(),
          course: course.title,
          dueDate: new Date(`${newTaskDue}T09:00`).toISOString(),
          status: 'todo',
        }),
      });
      if (!res.ok) throw new Error(await res.text() || 'Could not add task');
      const data = await res.json();
      setTasks(prev => [...prev, data.task]);
      setNewTaskTitle('');
      setNewTaskDue('');
    } catch (e: any) {
      setTaskError(e?.message || 'Could not add task');
    } finally {
      setAddingTask(false);
    }
  }

  async function addNotebook() {
    if (!course) return;
    setAddingNotebook(true);
    setNotebookError('');
    try {
      const res = await fetch('/api/notes/notebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: course.title, course: course.title, semester: course.semester || null }),
      });
      if (!res.ok) throw new Error(await res.text() || 'Could not create notebook');
      const data = await res.json();
      setNotebooks(prev => [...prev, data.notebook]);
    } catch (e: any) {
      setNotebookError(e?.message || 'Could not create notebook');
    } finally {
      setAddingNotebook(false);
    }
  }

  if (loading) {
    return <main className="space-y-4"><div className="text-sm text-slate-400">Loading course…</div></main>;
  }

  if (notFound || !course) {
    return (
      <main className="space-y-4">
        <div className="text-sm text-slate-400">Course not found.</div>
        <Link href="/courses" className="text-sm underline">Back to courses</Link>
      </main>
    );
  }

  return (
    <main className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/courses" className="text-xs text-slate-400 hover:underline">&larr; All courses</Link>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: resolveCourseColor(course) }}></span>
            <h2 className="text-lg font-medium">{course.title}</h2>
            {course.code && <span className="text-sm text-slate-400">{course.code}</span>}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {course.instructor ? `${course.instructor} · ` : ''}
            {course.semester && course.year ? `${course.semester} ${course.year}` : 'No term set'}
          </div>
        </div>
        <Link href={`/calendar?course=${encodeURIComponent(course.title)}`} className="px-3 py-1 rounded border border-[#1b2344] text-sm hover:bg-[#1b2344]">
          View on Calendar
        </Link>
      </div>

      <div className="card p-4">
        <div className="text-sm font-medium mb-2">Schedule</div>
        {blocks.length ? (
          <ul className="space-y-1 text-sm text-slate-300">
            {blocks.map((b: any, i: number) => (
              <li key={i}>
                {(b.days || []).map((d: number) => DAYS[d]).join(', ')}
                {b.start && b.end ? ` · ${fmt12(String(b.start))} – ${fmt12(String(b.end))}` : ''}
                {b.location ? ` · ${b.location}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-slate-500">No meeting schedule set.</div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Tasks</div>
            <div className="text-xs text-slate-400">{upcomingTasks.length} open · {doneCount} done</div>
          </div>

          <form onSubmit={addTask} className="flex items-center gap-2">
            <input
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              placeholder="Quick-add a task…"
              className="flex-1 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm"
            />
            <input
              type="date"
              value={newTaskDue}
              onChange={e => setNewTaskDue(e.target.value)}
              className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm"
            />
            <button
              type="submit"
              disabled={addingTask || !newTaskTitle.trim() || !newTaskDue}
              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50"
            >
              Add
            </button>
          </form>
          {taskError && <div className="text-xs text-rose-400">{taskError}</div>}

          {upcomingTasks.length === 0 ? (
            <div className="text-sm text-slate-500">No open tasks for this course.</div>
          ) : (
            <ul className="space-y-1">
              {upcomingTasks.map(t => {
                const overdue = new Date(t.dueDate).getTime() < now;
                return (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={t.status === 'done'} onChange={() => toggleTaskDone(t)} />
                    <span className="flex-1">{t.title}</span>
                    <span className={`text-xs ${overdue ? 'text-rose-400' : 'text-slate-400'}`}>
                      {new Date(t.dueDate).toLocaleDateString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <Link href="/tasks" className="text-xs underline text-slate-400">
            View all tasks
          </Link>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Notes</div>
            <button
              onClick={addNotebook}
              disabled={addingNotebook || courseNotebooks.length > 0}
              className="px-2 py-1 rounded border border-[#1b2344] text-xs hover:bg-[#1b2344] disabled:opacity-50"
            >
              {courseNotebooks.length > 0 ? 'Notebook linked' : (addingNotebook ? 'Creating…' : '+ New notebook')}
            </button>
          </div>
          {notebookError && <div className="text-xs text-rose-400">{notebookError}</div>}

          {courseNotebooks.length > 0 && (
            <div className="text-xs text-slate-400">
              {courseNotebooks.map(nb => nb.name).join(', ')} · {courseNotebooks.reduce((s, nb) => s + (nb.noteCount || 0), 0)} page(s)
            </div>
          )}

          {notes.length === 0 ? (
            <div className="text-sm text-slate-500">No notes for this course yet.</div>
          ) : (
            <ul className="space-y-2">
              {notes.map(n => (
                <li key={n.id} className="text-sm border-t border-[#1b2344] pt-2 first:border-0 first:pt-0">
                  <div className="font-medium">{n.title}</div>
                  {n.preview && <div className="text-xs text-slate-400 line-clamp-2">{n.preview}</div>}
                  <div className="text-xs text-slate-500">{new Date(n.updatedAt).toLocaleDateString()}</div>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notes" className="text-xs underline text-slate-400">
            Open notebook
          </Link>
        </div>
      </div>
    </main>
  );
}
