"use client";

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { courseBlocks } from '@/lib/courseWorkspace';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';
import type { CalendarEvent, Course } from '@/lib/types';

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function mondayOf(date: Date) {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  const offset = copy.getDay() === 0 ? 6 : copy.getDay() - 1;
  copy.setDate(copy.getDate() - offset);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatWeekRange(start: Date) {
  const end = addDays(start, 6);
  const first = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(start);
  const second = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(end);
  return `${first} to ${second}`;
}

function formatTime(value?: string | null) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return '';
  const [hour, minute] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function courseOccurs(course: Course, date: Date) {
  const dayKey = ymd(date);
  if (course.startDate && dayKey < course.startDate.slice(0, 10)) return false;
  if (course.endDate && dayKey > course.endDate.slice(0, 10)) return false;
  return courseBlocks(course).some((block) => block.days.includes(date.getDay()));
}

export default function CalendarPage() {
  const { tasks } = useTasks();
  const { courses } = useCourses();
  const { activeSemester, currentTerm } = useSemester();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState(ymd(new Date()));
  const [eventStart, setEventStart] = useState('');
  const [eventEnd, setEventEnd] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [saving, setSaving] = useState(false);

  async function refreshEvents() {
    try {
      const data = await apiFetch<{ events: CalendarEvent[] }>('/api/events');
      setEvents(data.events || []);
    } catch {}
  }

  useEffect(() => { void refreshEvents(); }, []);

  const activeCourses = useMemo(() => activeSemester ? courses.filter((course) => course.semester === activeSemester.season && course.year === activeSemester.year) : courses, [courses, activeSemester]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const visibleTasks = useMemo(() => tasks.filter((task) => task.status !== 'done' && (!currentTerm || task.term === currentTerm)), [tasks, currentTerm]);

  const days = useMemo(() => weekDays.map((date) => {
    const key = ymd(date);
    const classes = activeCourses.flatMap((course) => courseBlocks(course)
      .filter((block) => block.days.includes(date.getDay()) && courseOccurs(course, date))
      .map((block) => ({ course, start: block.start, end: block.end, location: block.location || course.room || course.location || null })));
    const deadlines = visibleTasks.filter((task) => task.dueDate.slice(0, 10) === key);
    const dayEvents = events.filter((event) => event.date === key);
    return { date, key, classes: classes.sort((a, b) => a.start.localeCompare(b.start)), deadlines, events: dayEvents.sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99')) };
  }), [weekDays, activeCourses, visibleTasks, events]);

  const classCount = days.reduce((sum, day) => sum + day.classes.length, 0);
  const deadlineCount = days.reduce((sum, day) => sum + day.deadlines.length, 0);
  const busyDays = days.filter((day) => day.classes.length + day.deadlines.length + day.events.length >= 4).length;

  async function addEvent(event: FormEvent) {
    event.preventDefault();
    if (!eventTitle.trim() || !eventDate) return;
    setSaving(true);
    try {
      await apiFetch('/api/events', {
        method: 'POST',
        body: {
          title: eventTitle.trim(),
          category: 'school',
          date: eventDate,
          startTime: eventStart || null,
          endTime: eventEnd || null,
          allDay: !eventStart,
          location: eventLocation.trim() || null,
        },
      });
      setEventTitle('');
      setEventStart('');
      setEventEnd('');
      setEventLocation('');
      setShowAddEvent(false);
      await refreshEvents();
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-slate-700/70 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div><p className="text-sm font-medium text-sky-300">Weekly agenda</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Classes, deadlines, and commitments in one week</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">The calendar now answers what is happening this week. Planning controls, display density, bulk entry, and export settings are no longer mixed into the main view.</p></div>
          <button onClick={() => setShowAddEvent((value) => !value)} className="rounded-lg bg-sky-500 px-4 py-2.5 font-semibold text-slate-950">{showAddEvent ? 'Close' : 'Add commitment'}</button>
        </div>
      </section>

      {showAddEvent ? <form onSubmit={addEvent} className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4"><div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_130px_130px_minmax(180px,0.7fr)_auto]"><input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="Meeting, office hours, appointment" className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500" /><input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /><input type="time" value={eventStart} onChange={(event) => setEventStart(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /><input type="time" value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /><input value={eventLocation} onChange={(event) => setEventLocation(event.target.value)} placeholder="Location" className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500" /><button disabled={saving || !eventTitle.trim()} className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">Save</button></div></form> : null}

      <section className="flex flex-col gap-3 rounded-xl border border-slate-700/70 bg-slate-900/45 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2"><button onClick={() => setWeekStart((date) => addDays(date, -7))} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Previous</button><button onClick={() => setWeekStart(mondayOf(new Date()))} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">This week</button><button onClick={() => setWeekStart((date) => addDays(date, 7))} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Next</button></div>
        <h2 className="font-semibold text-slate-100">{formatWeekRange(weekStart)}</h2>
        <div className="flex gap-2 text-xs"><span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-300">{classCount} classes</span><span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-300">{deadlineCount} deadlines</span>{busyDays ? <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-rose-300">{busyDays} heavy days</span> : null}</div>
      </section>

      <section className="grid gap-4 xl:grid-cols-7">
        {days.map((day) => {
          const isToday = day.key === ymd(new Date());
          const empty = !day.classes.length && !day.deadlines.length && !day.events.length;
          return <article key={day.key} className={`min-h-56 rounded-xl border p-3 ${isToday ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-700 bg-slate-900/45'}`}>
            <div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-wide text-slate-500">{new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(day.date)}</p><p className={`text-lg font-semibold ${isToday ? 'text-emerald-300' : 'text-slate-100'}`}>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(day.date)}</p></div>{isToday ? <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-300">Today</span> : null}</div>
            <div className="mt-3 space-y-2">
              {day.classes.map((item, index) => <Link key={`${item.course.id}:${item.start}:${index}`} href={`/courses/${item.course.id}`} className="block rounded-lg border-l-4 bg-slate-950/45 p-2 hover:bg-slate-800" style={{ borderLeftColor: item.course.color || '#10b981' }}><p className="text-xs font-medium text-slate-200">{item.course.title}</p><p className="mt-1 text-[11px] text-slate-500">{formatTime(item.start)} to {formatTime(item.end)}</p>{item.location ? <p className="text-[11px] text-slate-600">{item.location}</p> : null}</Link>)}
              {day.deadlines.map((task) => <Link key={task.id} href={`/tasks?text=${encodeURIComponent(task.title)}`} className="block rounded-lg bg-amber-500/10 p-2 hover:bg-amber-500/15"><p className="text-xs font-medium text-amber-200">{task.title}</p><p className="mt-1 text-[11px] text-amber-300/70">{task.course || 'Deadline'}{task.startTime ? ` · ${formatTime(task.startTime)}` : ''}</p></Link>)}
              {day.events.map((event) => <div key={event.id} className="rounded-lg bg-sky-500/10 p-2"><p className="text-xs font-medium text-sky-200">{event.title}</p><p className="mt-1 text-[11px] text-sky-300/70">{event.startTime ? formatTime(event.startTime) : 'All day'}{event.location ? ` · ${event.location}` : ''}</p></div>)}
              {empty ? <p className="py-6 text-center text-xs text-slate-600">Open</p> : null}
            </div>
          </article>;
        })}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link href="/tasks" className="rounded-xl border border-slate-700 bg-slate-900/45 p-4 hover:bg-slate-800"><h3 className="font-semibold text-slate-100">Manage deadlines</h3><p className="mt-1 text-sm text-slate-500">Edit, complete, or move assignments in Tasks.</p></Link>
        <Link href="/courses" className="rounded-xl border border-slate-700 bg-slate-900/45 p-4 hover:bg-slate-800"><h3 className="font-semibold text-slate-100">Update class schedule</h3><p className="mt-1 text-sm text-slate-500">Class times come from each course workspace.</p></Link>
        <Link href="/week-plan" className="rounded-xl border border-slate-700 bg-slate-900/45 p-4 hover:bg-slate-800"><h3 className="font-semibold text-slate-100">Build study blocks</h3><p className="mt-1 text-sm text-slate-500">Use the separate planning tool only when a detailed schedule is needed.</p></Link>
      </section>
    </main>
  );
}
