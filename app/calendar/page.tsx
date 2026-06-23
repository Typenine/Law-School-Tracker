"use client";

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { COURSE_WORKSPACES_KEY, CourseWorkspaceMap, courseBlocks } from '@/lib/courseWorkspace';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';
import type { CalendarEvent, Course } from '@/lib/types';

function ymd(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function mondayOf(date: Date) { const copy = new Date(date); copy.setHours(12, 0, 0, 0); const offset = copy.getDay() === 0 ? 6 : copy.getDay() - 1; copy.setDate(copy.getDate() - offset); return copy; }
function addDays(date: Date, days: number) { const copy = new Date(date); copy.setDate(copy.getDate() + days); return copy; }
function formatTime(value?: string | null) { if (!value || !/^\d{2}:\d{2}$/.test(value)) return ''; const [hour, minute] = value.split(':').map(Number); const date = new Date(); date.setHours(hour, minute); return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function courseOccurs(course: Course, date: Date) { const key = ymd(date); if (course.startDate && key < course.startDate.slice(0, 10)) return false; if (course.endDate && key > course.endDate.slice(0, 10)) return false; return courseBlocks(course).some((block) => block.days.includes(date.getDay())); }
function majorTask(title: string) { return /(exam|final|midterm|memo|brief|paper|presentation|submit)/i.test(title); }

export default function CalendarPage() {
  const { tasks } = useTasks();
  const { courses } = useCourses();
  const { activeSemester, currentTerm } = useSemester();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [workspaces, setWorkspaces] = useState<CourseWorkspaceMap>({});
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(ymd(new Date()));
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    try {
      const [eventData, settingsData] = await Promise.all([
        apiFetch<{ events: CalendarEvent[] }>('/api/events'),
        apiFetch<{ settings: Record<string, any> }>(`/api/settings?keys=${COURSE_WORKSPACES_KEY}`),
      ]);
      setEvents(eventData.events || []);
      setWorkspaces((settingsData.settings?.[COURSE_WORKSPACES_KEY] || {}) as CourseWorkspaceMap);
    } catch {}
  }
  useEffect(() => { void refresh(); }, []);

  const activeCourses = useMemo(() => activeSemester ? courses.filter((course) => course.semester === activeSemester.season && course.year === activeSemester.year) : courses, [courses, activeSemester]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const visibleTasks = useMemo(() => tasks.filter((task) => task.status !== 'done' && (!currentTerm || task.term === currentTerm)), [tasks, currentTerm]);
  const days = useMemo(() => weekDays.map((day) => {
    const key = ymd(day);
    const classes = activeCourses.flatMap((course) => courseBlocks(course).filter((block) => block.days.includes(day.getDay()) && courseOccurs(course, day)).map((block) => ({ course, ...block })));
    return {
      date: day,
      key,
      classes: classes.sort((a, b) => a.start.localeCompare(b.start)),
      deadlines: visibleTasks.filter((task) => task.dueDate.slice(0, 10) === key),
      events: events.filter((event) => event.date === key).sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99')),
      exams: activeCourses.filter((course) => workspaces[course.id]?.examDate === key),
    };
  }), [weekDays, activeCourses, visibleTasks, events, workspaces]);

  function openNew(day = ymd(new Date())) { setEditingId(null); setTitle(''); setDate(day); setStart(''); setEnd(''); setLocation(''); setShowForm(true); }
  function openEdit(event: CalendarEvent) { setEditingId(event.id); setTitle(event.title); setDate(event.date); setStart(event.startTime || ''); setEnd(event.endTime || ''); setLocation(event.location || ''); setShowForm(true); }
  async function saveEvent(event: FormEvent) {
    event.preventDefault(); if (!title.trim() || !date) return; setSaving(true);
    try {
      const body = { title: title.trim(), category: 'school', date, startTime: start || null, endTime: end || null, allDay: !start, location: location.trim() || null };
      await apiFetch(editingId ? `/api/events/${editingId}` : '/api/events', { method: editingId ? 'PATCH' : 'POST', body });
      setShowForm(false); setEditingId(null); await refresh();
    } finally { setSaving(false); }
  }
  async function removeEvent(id: string) { if (!window.confirm('Delete this calendar commitment?')) return; await apiFetch(`/api/events/${id}`, { method: 'DELETE' }); await refresh(); }

  const classCount = days.reduce((sum, day) => sum + day.classes.length, 0);
  const deadlineCount = days.reduce((sum, day) => sum + day.deadlines.length + day.exams.length, 0);

  return <main className="space-y-6">
    <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6"><div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="text-sm font-medium text-sky-300">Weekly agenda</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Classes, deadlines, exams, and commitments</h2><p className="mt-2 text-sm text-slate-400">Click any day to add a commitment. Exams and major assignments are emphasized automatically.</p></div><button onClick={() => showForm ? setShowForm(false) : openNew()} className="rounded-lg bg-sky-500 px-4 py-2.5 font-semibold text-slate-950">{showForm ? 'Close' : 'Add commitment'}</button></div></section>

    {showForm ? <form onSubmit={saveEvent} className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-sky-200">{editingId ? 'Edit commitment' : 'Add commitment'}</h2>{editingId ? <button type="button" onClick={() => removeEvent(editingId)} className="text-sm text-rose-300">Delete</button> : null}</div><div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_130px_130px_minmax(180px,0.7fr)_auto]"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Meeting, office hours, appointment" className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /><input type="time" value={start} onChange={(event) => setStart(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /><input type="time" value={end} onChange={(event) => setEnd(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location" className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /><button disabled={saving || !title.trim()} className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">Save</button></div></form> : null}

    <section className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-900/45 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-2"><button onClick={() => setWeekStart((value) => addDays(value, -7))} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Previous</button><button onClick={() => setWeekStart(mondayOf(new Date()))} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">This week</button><button onClick={() => setWeekStart((value) => addDays(value, 7))} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Next</button></div><h2 className="font-semibold text-slate-100">{weekStart.toLocaleDateString()} to {addDays(weekStart, 6).toLocaleDateString()}</h2><div className="flex gap-2 text-xs"><span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">{classCount} classes</span><span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-300">{deadlineCount} deadlines</span></div></section>

    <section className="grid gap-4 xl:grid-cols-7">{days.map((day) => {
      const today = day.key === ymd(new Date());
      const empty = !day.classes.length && !day.deadlines.length && !day.events.length && !day.exams.length;
      return <article key={day.key} className={`min-h-56 rounded-xl border p-3 ${today ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-700 bg-slate-900/45'}`}>
        <button onClick={() => openNew(day.key)} className="flex w-full items-center justify-between text-left"><div><p className="text-xs uppercase text-slate-500">{day.date.toLocaleDateString(undefined, { weekday: 'short' })}</p><p className={today ? 'text-lg font-semibold text-emerald-300' : 'text-lg font-semibold text-slate-100'}>{day.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p></div><span className="text-xs text-slate-600">+</span></button>
        <div className="mt-3 space-y-2">{day.exams.map((course) => <Link key={`exam:${course.id}`} href="/exam" className="block rounded-lg border border-rose-500/40 bg-rose-500/10 p-2"><p className="text-xs font-semibold text-rose-200">{course.title} exam</p><p className="text-[11px] text-rose-300/70">Major deadline</p></Link>)}{day.classes.map((item, index) => <Link key={`${item.course.id}:${index}`} href={`/courses/${item.course.id}`} className="block rounded-lg border-l-4 bg-slate-950/45 p-2" style={{ borderLeftColor: item.course.color || '#10b981' }}><p className="text-xs text-slate-200">{item.course.title}</p><p className="text-[11px] text-slate-500">{formatTime(item.start)} to {formatTime(item.end)}</p></Link>)}{day.deadlines.map((task) => <Link key={task.id} href={`/work?task=${task.id}`} className={`block rounded-lg p-2 ${majorTask(task.title) ? 'border border-amber-500/40 bg-amber-500/15' : 'bg-amber-500/10'}`}><p className="text-xs font-medium text-amber-200">{task.title}</p><p className="text-[11px] text-amber-300/70">{task.course || 'Deadline'}</p></Link>)}{day.events.map((item) => <button key={item.id} onClick={() => openEdit(item)} className="block w-full rounded-lg bg-sky-500/10 p-2 text-left"><p className="text-xs text-sky-200">{item.title}</p><p className="text-[11px] text-sky-300/70">{item.startTime ? formatTime(item.startTime) : 'All day'}{item.location ? ` · ${item.location}` : ''}</p></button>)}{empty ? <p className="py-6 text-center text-xs text-slate-600">Open</p> : null}</div>
      </article>;
    })}</section>

    <section className="grid gap-4 md:grid-cols-3"><Link href="/tasks" className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><h3 className="font-semibold text-slate-100">Manage deadlines</h3><p className="mt-1 text-sm text-slate-500">Start, edit, or move assignments.</p></Link><Link href="/courses" className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><h3 className="font-semibold text-slate-100">Update class schedule</h3><p className="mt-1 text-sm text-slate-500">Class times come from Courses.</p></Link><Link href="/week-plan" className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><h3 className="font-semibold text-slate-100">Plan study blocks</h3><p className="mt-1 text-sm text-slate-500">Build a realistic plan from available time.</p></Link></section>
  </main>;
}
