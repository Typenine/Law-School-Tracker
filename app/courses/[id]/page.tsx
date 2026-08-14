"use client";
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Course, CourseDocument, CourseDocumentCategory, Task } from '@/lib/types';
import { resolveCourseColor } from '@/lib/colors';
import EditCourseModal from '@/components/EditCourseModal';

export const dynamic = 'force-dynamic';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LS_GOALS = 'weeklyGoalsV1';

type WeeklyGoal = { id: string; scope: 'global' | 'course'; weeklyMinutes: number; course?: string | null };

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

type Session = {
  id: string;
  taskId?: string | null;
  when: string;
  minutes: number;
  focus?: number | null;
  notes?: string | null;
  pagesRead?: number | null;
};

const CATEGORY_LABELS: Record<CourseDocumentCategory, string> = {
  syllabus: 'Syllabus',
  slides: 'Slides',
  reading: 'Reading',
  other: 'Other',
};
const CATEGORY_ORDER: CourseDocumentCategory[] = ['syllabus', 'slides', 'reading', 'other'];

function norm(s: string): string {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim();
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function chicagoYmd(d: Date): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = f.formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value || '0000';
  const m = parts.find(p => p.type === 'month')?.value || '01';
  const da = parts.find(p => p.type === 'day')?.value || '01';
  return `${y}-${m}-${da}`;
}
function mondayOfChicago(d: Date): Date {
  const ymd = chicagoYmd(d);
  const [yy, mm, dd] = ymd.split('-').map(x => parseInt(x, 10));
  const local = new Date(yy, (mm as number) - 1, dd);
  const dow = local.getDay();
  const delta = (dow + 6) % 7;
  local.setDate(local.getDate() - delta);
  return local;
}
function weekKeysChicago(d: Date): string[] {
  const monday = mondayOfChicago(d);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(monday); x.setDate(x.getDate() + i); return chicagoYmd(x); });
}
function loadGoals(): WeeklyGoal[] {
  if (typeof window === 'undefined') return [];
  try { const raw = window.localStorage.getItem(LS_GOALS); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch { return []; }
}
function saveGoals(goals: WeeklyGoal[]) {
  if (typeof window !== 'undefined') window.localStorage.setItem(LS_GOALS, JSON.stringify(goals));
}

export default function CourseDetailPage({ params }: { params: { id: string } }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [taskError, setTaskError] = useState('');

  const [addingNotebook, setAddingNotebook] = useState(false);
  const [notebookError, setNotebookError] = useState('');

  const [documents, setDocuments] = useState<CourseDocument[]>([]);
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState<CourseDocumentCategory>('other');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docError, setDocError] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);

  const [goals, setGoals] = useState<WeeklyGoal[]>([]);

  async function refresh() {
    setLoading(true);
    try {
      const [coursesRes, tasksRes, notebooksRes, sessionsRes] = await Promise.all([
        fetch(`/api/courses?_ts=${Date.now()}`, { cache: 'no-store' }),
        fetch('/api/tasks', { cache: 'no-store' }),
        fetch('/api/notes/notebooks', { cache: 'no-store' }),
        fetch('/api/sessions', { cache: 'no-store' }),
      ]);
      const coursesData = await coursesRes.json().catch(() => ({ courses: [] }));
      const found = ((coursesData.courses || []) as Course[]).find(c => c.id === params.id) || null;
      setCourse(found);
      setNotFound(!found);

      const tasksData = await tasksRes.json().catch(() => ({ tasks: [] }));
      setTasks((tasksData.tasks || []) as Task[]);

      const notebooksData = await notebooksRes.json().catch(() => ({ notebooks: [] }));
      setNotebooks((notebooksData.notebooks || []) as Notebook[]);

      const sessionsData = await sessionsRes.json().catch(() => ({ sessions: [] }));
      setSessions((sessionsData.sessions || []) as Session[]);

      if (found) {
        const [notesRes, docsRes] = await Promise.all([
          fetch(`/api/notes?course=${encodeURIComponent(found.title)}&limit=8`, { cache: 'no-store' }),
          fetch(`/api/courses/${found.id}/documents`, { cache: 'no-store' }),
        ]);
        const notesData = await notesRes.json().catch(() => ({ notes: [] }));
        setNotes((notesData.notes || []) as NoteSummary[]);
        const docsData = await docsRes.json().catch(() => ({ documents: [] }));
        setDocuments((docsData.documents || []) as CourseDocument[]);
      } else {
        setNotes([]);
        setDocuments([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); setGoals(loadGoals()); }, [params.id]);
  useEffect(() => { saveGoals(goals); }, [goals]);

  const courseKey = norm(course?.title || '');
  const codeKey = norm(course?.code || '');

  // Prefer the real courseId link; fall back to matching the free-text course
  // label for tasks that predate it (or were created outside this page).
  const courseTasks = useMemo(() => {
    if (!course) return [];
    return tasks.filter(t => {
      if (t.courseId) return t.courseId === course.id;
      const key = norm(t.course || '');
      if (!key) return false;
      return key === courseKey || (!!codeKey && key === codeKey);
    });
  }, [tasks, course, courseKey, codeKey]);

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
  const primaryNotebook = courseNotebooks[0] || null;

  const blocks = useMemo(() => {
    if (!course) return [];
    if (Array.isArray(course.meetingBlocks) && course.meetingBlocks.length) return course.meetingBlocks;
    if (Array.isArray(course.meetingDays) && course.meetingStart && course.meetingEnd) {
      return [{ days: course.meetingDays, start: course.meetingStart, end: course.meetingEnd, location: course.room || course.location || null }];
    }
    return [];
  }, [course]);

  // ---- Stats (mirrors the per-course numbers on the courses list page) ----
  const courseSessions = useMemo(() => {
    const taskIds = new Set(courseTasks.map(t => t.id));
    return sessions.filter(s => (s.taskId && taskIds.has(s.taskId)));
  }, [sessions, courseTasks]);

  const weekKeys = useMemo(() => weekKeysChicago(new Date()), []);
  const stats = useMemo(() => {
    const totalMinutes = courseSessions.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
    const totalPages = courseSessions.reduce((sum, s) => sum + (Number(s.pagesRead) || 0), 0);
    const timePerPage = totalPages > 0 ? totalMinutes / totalPages : 0;
    const weekSessions = courseSessions.filter(s => weekKeys.includes(chicagoYmd(new Date(s.when))));
    const weekMinutes = weekSessions.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
    const withFocus = courseSessions.filter(s => typeof s.focus === 'number' && (s.focus as number) > 0);
    const avgFocus = withFocus.length ? withFocus.reduce((sum, s) => sum + Number(s.focus), 0) / withFocus.length : 0;
    return { totalMinutes, totalPages, timePerPage, weekMinutes, avgFocus };
  }, [courseSessions, weekKeys]);

  const goalMin = course ? (goals.find(g => g.scope === 'course' && (g.course || '') === course.title)?.weeklyMinutes || 0) : 0;
  const goalPct = goalMin > 0 ? Math.min(1, stats.weekMinutes / goalMin) : 0;
  function setCourseGoalHours(hours: number) {
    if (!course) return;
    const mins = Math.max(0, Math.round(hours * 60));
    setGoals(prev => {
      const arr = prev.slice();
      const idx = arr.findIndex(g => g.scope === 'course' && (g.course || '') === course.title);
      if (idx >= 0) arr[idx] = { ...arr[idx], weeklyMinutes: mins };
      else arr.push({ id: `course:${course.title}`, scope: 'course', weeklyMinutes: mins, course: course.title });
      return arr;
    });
  }

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
          courseId: course.id,
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

  async function uploadDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!course || !docFile) return;
    setUploadingDoc(true);
    setDocError('');
    try {
      const form = new FormData();
      form.set('file', docFile);
      form.set('category', docCategory);
      if (docTitle.trim()) form.set('title', docTitle.trim());
      const res = await fetch(`/api/courses/${course.id}/documents`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text() || 'Could not upload the file');
      const data = await res.json();
      setDocuments(prev => [data.document, ...prev]);
      setDocTitle('');
      setDocFile(null);
      setDocCategory('other');
      const input = document.getElementById('course-doc-file') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (err: any) {
      setDocError(err?.message || 'Could not upload the file');
    } finally {
      setUploadingDoc(false);
    }
  }

  async function removeDocument(doc: CourseDocument) {
    if (!course) return;
    if (!confirm(`Delete "${doc.title}"?`)) return;
    const res = await fetch(`/api/courses/${course.id}/documents/${doc.id}`, { method: 'DELETE' });
    if (res.ok) {
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
      if (previewId === doc.id) setPreviewId(null);
    }
  }

  async function deleteCourse() {
    if (!course) return;
    if (!confirm(`Delete "${course.title}"? This will not delete related tasks.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/courses/${course.id}`, { method: 'DELETE' });
      if (res.ok) window.location.href = '/courses';
    } finally {
      setDeleting(false);
    }
  }

  const documentsByCategory = useMemo(() => {
    const map = new Map<CourseDocumentCategory, CourseDocument[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const d of documents) {
      const cat = (d.category && map.has(d.category)) ? d.category : 'other';
      map.get(cat)!.push(d);
    }
    return map;
  }, [documents]);

  function isPreviewable(d: CourseDocument): 'pdf' | 'image' | null {
    if (d.mimeType === 'application/pdf' || d.filename.toLowerCase().endsWith('.pdf')) return 'pdf';
    if (d.mimeType.startsWith('image/')) return 'image';
    return null;
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
        <div className="flex items-center gap-2">
          <Link href={`/calendar?course=${encodeURIComponent(course.title)}`} className="px-3 py-1 rounded border border-[#1b2344] text-sm hover:bg-[#1b2344]">
            View on Calendar
          </Link>
          <button onClick={() => setShowEdit(true)} className="px-3 py-1 rounded border border-[#1b2344] text-sm hover:bg-[#1b2344]">
            Edit
          </button>
          <button onClick={deleteCourse} disabled={deleting} className="px-3 py-1 rounded border border-[#1b2344] text-sm hover:bg-[#1b2344] disabled:opacity-50">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div className="text-sm text-slate-500">
              No meeting schedule set. <button onClick={() => setShowEdit(true)} className="underline">Add one</button>.
            </div>
          )}
        </div>

        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Stats</div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-slate-400">Time/Page</span>
            <span className="text-right font-medium">{stats.timePerPage > 0 ? `${stats.timePerPage.toFixed(1)} min` : '—'}</span>
            <span className="text-slate-400">This Week</span>
            <span className="text-right font-medium">{stats.weekMinutes > 0 ? fmtMinutes(stats.weekMinutes) : '—'}</span>
            <span className="text-slate-400">Total Time</span>
            <span className="text-right font-medium">{stats.totalMinutes > 0 ? fmtMinutes(stats.totalMinutes) : '—'}</span>
            <span className="text-slate-400">Total Pages</span>
            <span className="text-right font-medium">{stats.totalPages > 0 ? stats.totalPages : '—'}</span>
            <span className="text-slate-400">Avg Focus</span>
            <span className="text-right font-medium">{stats.avgFocus > 0 ? `${stats.avgFocus.toFixed(1)}/10` : '—'}</span>
          </div>
          <div className="pt-1">
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs text-slate-300/70">Weekly goal (hrs)</label>
              <input
                type="number" min={0} step={1}
                value={Math.round(goalMin / 60)}
                onChange={e => setCourseGoalHours(parseInt(e.target.value || '0', 10) || 0)}
                className="w-16 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-xs"
              />
            </div>
            <div className="h-2 bg-[#0c1328] rounded overflow-hidden border border-[#1b2344]">
              <div className="h-full bg-emerald-600" style={{ width: `${Math.round(goalPct * 100)}%` }}></div>
            </div>
            <div className="text-xs text-slate-300/70 mt-1">{Math.round(stats.weekMinutes / 60)}h of {Math.round(goalMin / 60)}h this week</div>
          </div>
        </div>
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
          <Link href={`/tasks?course=${encodeURIComponent(course.title)}`} className="text-xs underline text-slate-400">
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
          <Link href={primaryNotebook ? `/notes?notebookId=${primaryNotebook.id}` : '/notes'} className="text-xs underline text-slate-400">
            Open notebook
          </Link>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="text-sm font-medium">Documents</div>
        <div className="text-xs text-slate-500">Syllabus, slides, readings — PDF, Word, PowerPoint, Excel, text, or image files, up to 20 MB.</div>

        <form onSubmit={uploadDocument} className="flex flex-wrap items-center gap-2">
          <input
            id="course-doc-file"
            type="file"
            accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp"
            onChange={e => setDocFile(e.target.files?.[0] || null)}
            className="text-sm text-slate-300"
          />
          <select
            value={docCategory}
            onChange={e => setDocCategory(e.target.value as CourseDocumentCategory)}
            className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm"
          >
            {CATEGORY_ORDER.map(cat => (<option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>))}
          </select>
          <input
            value={docTitle}
            onChange={e => setDocTitle(e.target.value)}
            placeholder="Title (optional)"
            className="bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={uploadingDoc || !docFile}
            className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50"
          >
            {uploadingDoc ? 'Uploading…' : 'Upload'}
          </button>
        </form>
        {docError && <div className="text-xs text-rose-400">{docError}</div>}

        {documents.length === 0 ? (
          <div className="text-sm text-slate-500">No documents uploaded yet.</div>
        ) : (
          <div className="space-y-4">
            {CATEGORY_ORDER.filter(cat => (documentsByCategory.get(cat) || []).length > 0).map(cat => (
              <div key={cat}>
                <div className="text-xs font-medium text-slate-400 mb-1">{CATEGORY_LABELS[cat]}</div>
                <ul className="divide-y divide-[#1b2344]">
                  {(documentsByCategory.get(cat) || []).map(d => {
                    const kind = isPreviewable(d);
                    const previewOpen = previewId === d.id;
                    return (
                      <li key={d.id} className="py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline truncate">
                              {d.title}
                            </a>
                            <div className="text-xs text-slate-500">
                              {d.filename} · {fmtBytes(d.size)} · {new Date(d.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {kind && (
                              <button onClick={() => setPreviewId(previewOpen ? null : d.id)} className="px-2 py-1 rounded border border-[#1b2344] text-xs hover:bg-[#1b2344]">
                                {previewOpen ? 'Hide preview' : 'Preview'}
                              </button>
                            )}
                            <a href={d.url} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded border border-[#1b2344] text-xs hover:bg-[#1b2344]">
                              View
                            </a>
                            <button onClick={() => removeDocument(d)} className="px-2 py-1 rounded border border-[#1b2344] text-xs hover:bg-[#1b2344]">
                              Delete
                            </button>
                          </div>
                        </div>
                        {previewOpen && kind === 'pdf' && (
                          <iframe src={d.url} title={d.title} className="mt-2 w-full h-[70vh] rounded border border-[#1b2344] bg-white" />
                        )}
                        {previewOpen && kind === 'image' && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={d.url} alt={d.title} className="mt-2 max-h-[70vh] rounded border border-[#1b2344]" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {showEdit && (
        <EditCourseModal
          course={course}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { setCourse(updated); setShowEdit(false); }}
        />
      )}
    </main>
  );
}
