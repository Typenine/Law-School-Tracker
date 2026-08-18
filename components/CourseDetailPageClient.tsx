"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Course, CourseDocument, CourseDocumentCategory, Task } from '@/lib/types';
import { resolveCourseColor } from '@/lib/colors';
import EditCourseModal from '@/components/EditCourseModal';

export const dynamic = 'force-dynamic';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LS_GOALS = 'weeklyGoalsV1';
const CATEGORY_LABELS: Record<CourseDocumentCategory, string> = {
  syllabus: 'Syllabus',
  slides: 'Slides',
  reading: 'Reading',
  other: 'Other',
};
const CATEGORY_ORDER: CourseDocumentCategory[] = ['syllabus', 'slides', 'reading', 'other'];
const TABS = ['overview', 'tasks', 'readings', 'notes', 'documents'] as const;
type CourseTab = typeof TABS[number];
type WeeklyGoal = { id: string; scope: 'global' | 'course'; weeklyMinutes: number; course?: string | null };
type Notebook = { id: string; name: string; course: string | null; semester: string | null; noteCount: number; updatedAt: string };
type NoteSummary = { id: string; title: string; notebookName: string | null; preview: string; updatedAt: string };
type Session = { id: string; taskId?: string | null; when: string; minutes: number; focus?: number | null; notes?: string | null; pagesRead?: number | null };

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
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function fmtMinutes(mins: number): string {
  const total = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function chicagoYmd(d: Date): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = f.formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value || '0000';
  const m = parts.find(p => p.type === 'month')?.value || '01';
  const day = parts.find(p => p.type === 'day')?.value || '01';
  return `${y}-${m}-${day}`;
}
function mondayOfChicago(d: Date): Date {
  const [yy, mm, dd] = chicagoYmd(d).split('-').map(x => parseInt(x, 10));
  const local = new Date(yy, mm - 1, dd);
  local.setDate(local.getDate() - ((local.getDay() + 6) % 7));
  return local;
}
function weekKeysChicago(d: Date): string[] {
  const monday = mondayOfChicago(d);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday);
    x.setDate(x.getDate() + i);
    return chicagoYmd(x);
  });
}
function loadGoals(): WeeklyGoal[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LS_GOALS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveGoals(goals: WeeklyGoal[]) {
  if (typeof window !== 'undefined') window.localStorage.setItem(LS_GOALS, JSON.stringify(goals));
}
function isReadingTask(task: Task): boolean {
  return task.activity === 'reading' || Boolean(task.originalPageRanges) || Boolean(task.remainingPageRanges);
}
function taskDue(task: Task): number {
  const n = new Date(task.dueDate).getTime();
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export default function CourseDetailPage({ params }: { params: { id: string } }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [documents, setDocuments] = useState<CourseDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<CourseTab>('overview');

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [addingNotebook, setAddingNotebook] = useState(false);
  const [notebookError, setNotebookError] = useState('');
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
        fetch('/api/tasks?allTerms=true', { cache: 'no-store' }),
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

  useEffect(() => {
    void refresh();
    setGoals(loadGoals());
  }, [params.id]);
  useEffect(() => { saveGoals(goals); }, [goals]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncHash = () => {
      const hash = window.location.hash.replace('#', '') as CourseTab;
      if (TABS.includes(hash)) setActiveTab(hash);
    };
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  function openTab(tab: CourseTab) {
    setActiveTab(tab);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${tab}`);
  }

  const courseKey = norm(course?.title || '');
  const codeKey = norm(course?.code || '');
  const courseTasks = useMemo(() => {
    if (!course) return [];
    return tasks.filter(task => {
      if (task.courseId) return task.courseId === course.id;
      const key = norm(task.course || '');
      return Boolean(key && (key === courseKey || (!!codeKey && key === codeKey)));
    });
  }, [tasks, course, courseKey, codeKey]);

  const generalTasks = useMemo(() => courseTasks.filter(task => !isReadingTask(task)).sort((a, b) => taskDue(a) - taskDue(b)), [courseTasks]);
  const readingTasks = useMemo(() => courseTasks.filter(isReadingTask).sort((a, b) => taskDue(a) - taskDue(b)), [courseTasks]);
  const openGeneralTasks = useMemo(() => generalTasks.filter(task => task.status !== 'done'), [generalTasks]);
  const openReadings = useMemo(() => readingTasks.filter(task => task.status !== 'done'), [readingTasks]);
  const doneGeneralCount = generalTasks.length - openGeneralTasks.length;
  const doneReadingCount = readingTasks.length - openReadings.length;
  const now = Date.now();

  const courseNotebooks = useMemo(() => notebooks.filter(nb => norm(nb.course || nb.name) === courseKey), [notebooks, courseKey]);
  const primaryNotebook = courseNotebooks[0] || null;
  const noteCount = Math.max(notes.length, courseNotebooks.reduce((sum, nb) => sum + (nb.noteCount || 0), 0));

  const blocks = useMemo(() => {
    if (!course) return [];
    if (Array.isArray(course.meetingBlocks) && course.meetingBlocks.length) return course.meetingBlocks;
    if (Array.isArray(course.meetingDays) && course.meetingStart && course.meetingEnd) {
      return [{ days: course.meetingDays, start: course.meetingStart, end: course.meetingEnd, location: course.room || course.location || null }];
    }
    return [];
  }, [course]);

  const courseSessions = useMemo(() => {
    const taskIds = new Set(courseTasks.map(task => task.id));
    return sessions.filter(session => Boolean(session.taskId && taskIds.has(session.taskId)));
  }, [sessions, courseTasks]);
  const weekKeys = useMemo(() => weekKeysChicago(new Date()), []);
  const stats = useMemo(() => {
    const totalMinutes = courseSessions.reduce((sum, session) => sum + (Number(session.minutes) || 0), 0);
    const totalPages = courseSessions.reduce((sum, session) => sum + (Number(session.pagesRead) || 0), 0);
    const weekMinutes = courseSessions.filter(session => weekKeys.includes(chicagoYmd(new Date(session.when)))).reduce((sum, session) => sum + (Number(session.minutes) || 0), 0);
    const focusSessions = courseSessions.filter(session => typeof session.focus === 'number' && Number(session.focus) > 0);
    const avgFocus = focusSessions.length ? focusSessions.reduce((sum, session) => sum + Number(session.focus), 0) / focusSessions.length : 0;
    return {
      totalMinutes,
      totalPages,
      timePerPage: totalPages > 0 ? totalMinutes / totalPages : 0,
      weekMinutes,
      avgFocus,
    };
  }, [courseSessions, weekKeys]);

  const goalMin = course ? (goals.find(goal => goal.scope === 'course' && (goal.course || '') === course.title)?.weeklyMinutes || 0) : 0;
  const goalPct = goalMin > 0 ? Math.min(1, stats.weekMinutes / goalMin) : 0;
  function setCourseGoalHours(hours: number) {
    if (!course) return;
    const mins = Math.max(0, Math.round(hours * 60));
    setGoals(prev => {
      const next = [...prev];
      const index = next.findIndex(goal => goal.scope === 'course' && (goal.course || '') === course.title);
      if (index >= 0) next[index] = { ...next[index], weeklyMinutes: mins };
      else next.push({ id: `course:${course.title}`, scope: 'course', weeklyMinutes: mins, course: course.title });
      return next;
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
      setTasks(prev => prev.map(item => item.id === task.id ? data.task : item));
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
    } catch (error: any) {
      setTaskError(error?.message || 'Could not add task');
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
    } catch (error: any) {
      setNotebookError(error?.message || 'Could not create notebook');
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
    } catch (error: any) {
      setDocError(error?.message || 'Could not upload the file');
    } finally {
      setUploadingDoc(false);
    }
  }

  async function removeDocument(doc: CourseDocument) {
    if (!course || !confirm(`Delete "${doc.title}"?`)) return;
    const res = await fetch(`/api/courses/${course.id}/documents/${doc.id}`, { method: 'DELETE' });
    if (res.ok) {
      setDocuments(prev => prev.filter(item => item.id !== doc.id));
      if (previewId === doc.id) setPreviewId(null);
    }
  }

  async function deleteCourse() {
    if (!course || !confirm(`Delete "${course.title}"? This will not delete related tasks.`)) return;
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
    for (const category of CATEGORY_ORDER) map.set(category, []);
    for (const doc of documents) {
      const category = doc.category && map.has(doc.category) ? doc.category : 'other';
      map.get(category)!.push(doc);
    }
    return map;
  }, [documents]);

  function isPreviewable(doc: CourseDocument): 'pdf' | 'image' | null {
    if (doc.mimeType === 'application/pdf' || doc.filename.toLowerCase().endsWith('.pdf')) return 'pdf';
    if (doc.mimeType.startsWith('image/')) return 'image';
    return null;
  }

  if (loading) return <main className="space-y-4"><div className="text-sm text-slate-400">Loading course…</div></main>;
  if (notFound || !course) {
    return <main className="space-y-4"><div className="text-sm text-slate-400">Course not found.</div><Link href="/courses" className="text-sm underline">Back to courses</Link></main>;
  }

  const tabCounts: Record<CourseTab, number | null> = {
    overview: null,
    tasks: openGeneralTasks.length,
    readings: openReadings.length,
    notes: noteCount,
    documents: documents.length,
  };
  const nextItems = [...openGeneralTasks, ...openReadings].sort((a, b) => taskDue(a) - taskDue(b)).slice(0, 4);

  return (
    <main className="space-y-4">
      <section className="card overflow-hidden">
        <div className="h-1" style={{ backgroundColor: resolveCourseColor(course) }} />
        <div className="p-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link href="/courses" className="text-xs text-slate-400 hover:underline">&larr; All courses</Link>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: resolveCourseColor(course) }} />
              <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
              {course.code && <span className="text-sm text-slate-400">{course.code}</span>}
            </div>
            <div className="text-sm text-slate-400 mt-1">
              {course.instructor ? `${course.instructor} · ` : ''}{course.semester && course.year ? `${course.semester} ${course.year}` : 'No term set'}
            </div>
            <div className="flex flex-wrap gap-2 mt-3 text-xs">
              <button type="button" onClick={() => openTab('tasks')} className="rounded-full border border-white/10 px-2.5 py-1 text-slate-300 hover:bg-white/5">{openGeneralTasks.length} open task{openGeneralTasks.length === 1 ? '' : 's'}</button>
              <button type="button" onClick={() => openTab('readings')} className="rounded-full border border-white/10 px-2.5 py-1 text-slate-300 hover:bg-white/5">{openReadings.length} reading{openReadings.length === 1 ? '' : 's'}</button>
              <button type="button" onClick={() => openTab('notes')} className="rounded-full border border-white/10 px-2.5 py-1 text-slate-300 hover:bg-white/5">{noteCount} note{noteCount === 1 ? '' : 's'}</button>
              <button type="button" onClick={() => openTab('documents')} className="rounded-full border border-white/10 px-2.5 py-1 text-slate-300 hover:bg-white/5">{documents.length} document{documents.length === 1 ? '' : 's'}</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openTab('documents')} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm">Documents</button>
            <Link href={`/calendar?course=${encodeURIComponent(course.title)}`} className="px-3 py-2 rounded border border-[#1b2344] text-sm hover:bg-[#1b2344]">Calendar</Link>
            <button type="button" onClick={() => setShowEdit(true)} className="px-3 py-2 rounded border border-[#1b2344] text-sm hover:bg-[#1b2344]">Edit course</button>
            <button type="button" onClick={deleteCourse} disabled={deleting} className="px-3 py-2 rounded border border-rose-900/70 text-rose-300 text-sm hover:bg-rose-950/40 disabled:opacity-50">{deleting ? 'Deleting…' : 'Delete'}</button>
          </div>
        </div>
      </section>

      <nav className="card p-2 flex gap-1 overflow-x-auto" aria-label="Course sections">
        {TABS.map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => openTab(tab)}
            className={`flex items-center gap-2 whitespace-nowrap rounded px-3 py-2 text-sm capitalize ${activeTab === tab ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
          >
            {tab}
            {tabCounts[tab] !== null && <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[10px] text-slate-300">{tabCounts[tab]}</span>}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="card p-4">
              <div className="text-sm font-medium mb-3">Schedule</div>
              {blocks.length ? (
                <ul className="space-y-2 text-sm text-slate-300">
                  {blocks.map((block: any, i: number) => (
                    <li key={i} className="rounded border border-white/10 bg-white/[0.02] px-3 py-2">
                      {(block.days || []).map((day: number) => DAYS[day]).join(', ')}
                      {block.start && block.end ? ` · ${fmt12(String(block.start))} – ${fmt12(String(block.end))}` : ''}
                      {block.location ? ` · ${block.location}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-slate-500">No meeting schedule set. <button type="button" onClick={() => setShowEdit(true)} className="underline">Add one</button>.</div>
              )}
            </section>

            <section className="card p-4 space-y-3">
              <div className="flex items-center justify-between"><div className="text-sm font-medium">Study progress</div><span className="text-xs text-slate-500">This semester</span></div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  ['Time/page', stats.timePerPage > 0 ? `${stats.timePerPage.toFixed(1)}m` : '—'],
                  ['This week', stats.weekMinutes > 0 ? fmtMinutes(stats.weekMinutes) : '—'],
                  ['Total time', stats.totalMinutes > 0 ? fmtMinutes(stats.totalMinutes) : '—'],
                  ['Pages', stats.totalPages > 0 ? String(stats.totalPages) : '—'],
                  ['Focus', stats.avgFocus > 0 ? `${stats.avgFocus.toFixed(1)}/10` : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border border-white/10 bg-white/[0.02] p-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 font-medium">{value}</div>
                  </div>
                ))}
              </div>
              <div className="pt-1">
                <div className="flex items-center gap-2 mb-1"><label className="text-xs text-slate-400">Weekly goal</label><input type="number" min={0} step={1} value={Math.round(goalMin / 60)} onChange={e => setCourseGoalHours(parseInt(e.target.value || '0', 10) || 0)} className="w-16 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-xs" /><span className="text-xs text-slate-500">hours</span></div>
                <div className="h-2 bg-[#0c1328] rounded overflow-hidden border border-[#1b2344]"><div className="h-full bg-emerald-600" style={{ width: `${Math.round(goalPct * 100)}%` }} /></div>
                <div className="text-xs text-slate-500 mt-1">{fmtMinutes(stats.weekMinutes)} of {fmtMinutes(goalMin)} this week</div>
              </div>
            </section>
          </div>

          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['tasks', 'Tasks', `${openGeneralTasks.length} open`, 'Plan assignments, outlines, practice, and admin work.'],
              ['readings', 'Readings', `${openReadings.length} open`, 'Track assigned pages and reading completion.'],
              ['notes', 'Notes', `${noteCount} pages`, 'Open the course notebook and recent notes.'],
              ['documents', 'Documents', `${documents.length} files`, 'Upload syllabi, slides, readings, and reference files.'],
            ].map(([tab, label, count, description]) => (
              <button key={tab} type="button" onClick={() => openTab(tab as CourseTab)} className="card p-4 text-left hover:bg-white/[0.035] transition-colors">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{label}</span><span className="text-xs text-slate-400">{count}</span></div>
                <div className="text-xs text-slate-500 mt-2 leading-relaxed">{description}</div>
              </button>
            ))}
          </section>

          <section className="card p-4 space-y-3">
            <div className="flex items-center justify-between"><div className="text-sm font-medium">Coming up</div><Link href={`/calendar?course=${encodeURIComponent(course.title)}`} className="text-xs text-slate-400 hover:underline">Course calendar</Link></div>
            {nextItems.length === 0 ? <div className="text-sm text-slate-500">Nothing upcoming for this course.</div> : (
              <div className="divide-y divide-white/10">
                {nextItems.map(task => (
                  <button key={task.id} type="button" onClick={() => openTab(isReadingTask(task) ? 'readings' : 'tasks')} className="w-full py-2 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02]">
                    <div className="min-w-0"><div className="text-sm font-medium truncate">{task.title}</div><div className="text-xs text-slate-500 capitalize">{isReadingTask(task) ? 'Reading' : (task.activity || 'Task')}</div></div>
                    <div className={`text-xs shrink-0 ${taskDue(task) < now ? 'text-rose-400' : 'text-slate-400'}`}>{new Date(task.dueDate).toLocaleDateString()}</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'tasks' && (
        <section className="card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-medium">Tasks</h2><div className="text-xs text-slate-500 mt-1">{openGeneralTasks.length} open · {doneGeneralCount} done</div></div><Link href={`/tasks?course=${encodeURIComponent(course.title)}`} className="px-3 py-1.5 rounded border border-[#1b2344] text-xs hover:bg-[#1b2344]">Open task workspace</Link></div>
          <form onSubmit={addTask} className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
            <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Quick-add a task…" className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 text-sm" />
            <input type="date" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 text-sm" />
            <button type="submit" disabled={addingTask || !newTaskTitle.trim() || !newTaskDue} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50">{addingTask ? 'Adding…' : 'Add task'}</button>
          </form>
          {taskError && <div className="text-xs text-rose-400">{taskError}</div>}
          {generalTasks.length === 0 ? <div className="text-sm text-slate-500">No non-reading tasks for this course yet.</div> : (
            <div className="divide-y divide-white/10">
              {generalTasks.map(task => {
                const overdue = task.status !== 'done' && taskDue(task) < now;
                return <div key={task.id} className="py-3 flex items-center gap-3"><input type="checkbox" checked={task.status === 'done'} onChange={() => toggleTaskDone(task)} /><div className="min-w-0 flex-1"><div className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-slate-500' : ''}`}>{task.title}</div><div className="text-xs text-slate-500 capitalize">{task.activity || 'Task'}{task.estimatedMinutes ? ` · ${fmtMinutes(task.estimatedMinutes)}` : ''}</div></div><div className={`text-xs shrink-0 ${overdue ? 'text-rose-400' : 'text-slate-400'}`}>{new Date(task.dueDate).toLocaleDateString()}</div></div>;
              })}
            </div>
          )}
        </section>
      )}

      {activeTab === 'readings' && (
        <section className="card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-medium">Readings</h2><div className="text-xs text-slate-500 mt-1">{openReadings.length} open · {doneReadingCount} done</div></div><Link href={`/reading?course=${encodeURIComponent(course.title)}`} className="px-3 py-1.5 rounded border border-[#1b2344] text-xs hover:bg-[#1b2344]">Open reading tracker</Link></div>
          {readingTasks.length === 0 ? <div className="text-sm text-slate-500">No readings assigned to this course yet.</div> : (
            <div className="space-y-2">
              {readingTasks.map(task => {
                const overdue = task.status !== 'done' && taskDue(task) < now;
                const pages = task.remainingPageRanges || task.originalPageRanges || null;
                return <div key={task.id} className="rounded-lg border border-white/10 bg-white/[0.015] p-3 flex items-start gap-3"><input className="mt-1" type="checkbox" checked={task.status === 'done'} onChange={() => toggleTaskDone(task)} /><div className="min-w-0 flex-1"><div className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-slate-500' : ''}`}>{task.title}</div><div className="text-xs text-slate-500 mt-1">{pages ? `Pages ${pages}` : 'Reading assignment'}{task.estimatedMinutes ? ` · ${fmtMinutes(task.estimatedMinutes)} remaining/estimated` : ''}</div></div><div className={`text-xs shrink-0 ${overdue ? 'text-rose-400' : 'text-slate-400'}`}>{new Date(task.dueDate).toLocaleDateString()}</div></div>;
              })}
            </div>
          )}
        </section>
      )}

      {activeTab === 'notes' && (
        <section className="card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-medium">Notes</h2><div className="text-xs text-slate-500 mt-1">Course notebook and recent pages</div></div><div className="flex gap-2"><button type="button" onClick={addNotebook} disabled={addingNotebook || courseNotebooks.length > 0} className="px-3 py-1.5 rounded border border-[#1b2344] text-xs hover:bg-[#1b2344] disabled:opacity-50">{courseNotebooks.length > 0 ? 'Notebook linked' : (addingNotebook ? 'Creating…' : '+ New notebook')}</button><Link href={primaryNotebook ? `/notes?notebookId=${primaryNotebook.id}` : '/notes'} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs">Open notebook</Link></div></div>
          {notebookError && <div className="text-xs text-rose-400">{notebookError}</div>}
          {courseNotebooks.length > 0 && <div className="rounded border border-white/10 bg-white/[0.02] p-3 text-sm"><div className="font-medium">{courseNotebooks.map(nb => nb.name).join(', ')}</div><div className="text-xs text-slate-500 mt-1">{courseNotebooks.reduce((sum, nb) => sum + (nb.noteCount || 0), 0)} page(s)</div></div>}
          {notes.length === 0 ? <div className="text-sm text-slate-500">No notes for this course yet.</div> : (
            <div className="divide-y divide-white/10">
              {notes.map(note => <div key={note.id} className="py-3"><div className="font-medium text-sm">{note.title}</div>{note.preview && <div className="text-xs text-slate-400 mt-1 line-clamp-2">{note.preview}</div>}<div className="text-xs text-slate-500 mt-1">{new Date(note.updatedAt).toLocaleDateString()}</div></div>)}
            </div>
          )}
        </section>
      )}

      {activeTab === 'documents' && (
        <section className="space-y-4">
          <div className="card p-4 space-y-3">
            <div><h2 className="font-medium">Documents</h2><div className="text-xs text-slate-500 mt-1">Syllabus, slides, readings, reference materials, and other course files.</div></div>
            <form onSubmit={uploadDocument} className="grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_160px_minmax(180px,1fr)_auto] gap-2 items-center">
              <input id="course-doc-file" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp" onChange={e => setDocFile(e.target.files?.[0] || null)} className="text-sm text-slate-300" />
              <select value={docCategory} onChange={e => setDocCategory(e.target.value as CourseDocumentCategory)} className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 text-sm">{CATEGORY_ORDER.map(category => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select>
              <input value={docTitle} onChange={e => setDocTitle(e.target.value)} placeholder="Title (optional)" className="bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2 text-sm" />
              <button type="submit" disabled={uploadingDoc || !docFile} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50">{uploadingDoc ? 'Uploading…' : 'Upload file'}</button>
            </form>
            <div className="text-[11px] text-slate-500">PDF, Word, PowerPoint, Excel, text, and image files up to 20 MB.</div>
            {docError && <div className="text-xs text-rose-400">{docError}</div>}
          </div>

          {documents.length === 0 ? <div className="card p-8 text-center"><div className="font-medium">No documents uploaded yet</div><div className="text-sm text-slate-500 mt-1">Upload a syllabus, reading, slide deck, or reference file above.</div></div> : (
            <div className="space-y-4">
              {CATEGORY_ORDER.filter(category => (documentsByCategory.get(category) || []).length > 0).map(category => (
                <section key={category} className="card p-4">
                  <div className="flex items-center justify-between mb-2"><div className="font-medium text-sm">{CATEGORY_LABELS[category]}</div><div className="text-xs text-slate-500">{(documentsByCategory.get(category) || []).length} file(s)</div></div>
                  <div className="divide-y divide-white/10">
                    {(documentsByCategory.get(category) || []).map(doc => {
                      const kind = isPreviewable(doc);
                      const previewOpen = previewId === doc.id;
                      return <div key={doc.id} className="py-3"><div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div className="min-w-0"><a href={doc.url} target="_blank" rel="noopener noreferrer" className="font-medium text-sm hover:underline break-words">{doc.title}</a><div className="text-xs text-slate-500 mt-1">{doc.filename} · {fmtBytes(doc.size)} · {new Date(doc.createdAt).toLocaleDateString()}</div></div><div className="flex items-center gap-2 shrink-0">{kind && <button type="button" onClick={() => setPreviewId(previewOpen ? null : doc.id)} className="px-2.5 py-1.5 rounded border border-[#1b2344] text-xs hover:bg-[#1b2344]">{previewOpen ? 'Hide preview' : 'Preview'}</button>}<a href={doc.url} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1.5 rounded border border-[#1b2344] text-xs hover:bg-[#1b2344]">Open</a><button type="button" onClick={() => removeDocument(doc)} className="px-2.5 py-1.5 rounded border border-rose-900/70 text-rose-300 text-xs hover:bg-rose-950/40">Delete</button></div></div>{previewOpen && kind === 'pdf' && <iframe src={doc.url} title={doc.title} className="mt-3 w-full h-[70vh] rounded border border-[#1b2344] bg-white" />}{previewOpen && kind === 'image' && <img src={doc.url} alt={doc.title} className="mt-3 max-h-[70vh] rounded border border-[#1b2344]" />}</div>;
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      )}

      {showEdit && <EditCourseModal course={course} onClose={() => setShowEdit(false)} onSaved={(updated) => { setCourse(updated); setShowEdit(false); }} />}
    </main>
  );
}
