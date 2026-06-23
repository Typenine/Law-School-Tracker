"use client";

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { courseBlocks } from '@/lib/courseWorkspace';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';

function key(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(date: Date, days: number) { const copy = new Date(date); copy.setDate(copy.getDate() + days); return copy; }
function monday(date: Date) { const copy = new Date(date); const offset = copy.getDay() === 0 ? 6 : copy.getDay() - 1; copy.setDate(copy.getDate() - offset); copy.setHours(12, 0, 0, 0); return copy; }

export default function CourseTimelinePage() {
  const courseId = useSearchParams().get('course') || '';
  const { courses, loading: coursesLoading } = useCourses();
  const { tasks, loading: tasksLoading } = useTasks();
  const { activeSemester, currentTerm } = useSemester();
  const course = courses.find((item) => item.id === courseId) || null;

  const weeks = useMemo(() => {
    if (!course) return [];
    const start = monday(new Date(course.startDate || activeSemester?.startDate || new Date().toISOString()));
    const end = new Date(course.endDate || activeSemester?.endDate || addDays(new Date(), 120).toISOString());
    const result: any[] = [];
    for (let cursor = new Date(start); cursor <= end && result.length < 24; cursor = addDays(cursor, 7)) {
      const weekEnd = addDays(cursor, 6);
      const meetings: any[] = [];
      for (let offset = 0; offset < 7; offset++) {
        const date = addDays(cursor, offset);
        for (const block of courseBlocks(course)) {
          if (block.days.includes(date.getDay())) meetings.push({ date, ...block });
        }
      }
      const weekTasks = tasks.filter((task) => {
        if ((task.course || '').toLowerCase() !== course.title.toLowerCase()) return false;
        if (currentTerm && task.term && task.term !== currentTerm) return false;
        const due = new Date(task.dueDate);
        return due >= cursor && due <= new Date(`${key(weekEnd)}T23:59:59`);
      }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      result.push({ start: new Date(cursor), end: weekEnd, meetings, tasks: weekTasks });
    }
    return result;
  }, [course, tasks, currentTerm, activeSemester]);

  if (coursesLoading || tasksLoading) return <main className="rounded-xl border border-slate-700 p-6 text-slate-400">Loading timeline…</main>;
  if (!course) return <main><Link href="/courses" className="text-emerald-300">Select a course from Courses.</Link></main>;

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-violet-500/30 bg-slate-950 p-6">
        <Link href={`/courses/${course.id}`} className="text-sm text-slate-400">Back to workspace</Link>
        <p className="mt-4 text-sm text-violet-300">Semester timeline</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-100">{course.title}</h2>
      </section>
      <section className="space-y-4">{weeks.map((week, index) => {
        const current = new Date() >= week.start && new Date() <= new Date(`${key(week.end)}T23:59:59`);
        return <article key={key(week.start)} className={`rounded-xl border p-5 ${current ? 'border-violet-500/50 bg-violet-500/5' : 'border-slate-700 bg-slate-900/45'}`}>
          <div className="flex items-center justify-between"><div><p className="text-xs uppercase text-slate-500">Week {index + 1}</p><h3 className="font-semibold text-slate-100">{week.start.toLocaleDateString()} to {week.end.toLocaleDateString()}</h3></div>{current ? <span className="rounded-full bg-violet-500/15 px-2 py-1 text-xs text-violet-300">Current</span> : null}</div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div><p className="text-xs uppercase text-slate-500">Classes</p><div className="mt-2 space-y-2">{week.meetings.map((meeting: any, meetingIndex: number) => <div key={`${key(meeting.date)}:${meetingIndex}`} className="rounded-lg bg-slate-950/40 p-3"><p className="text-sm text-slate-200">{meeting.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</p><p className="text-xs text-slate-500">{meeting.start} to {meeting.end}</p></div>)}{!week.meetings.length ? <p className="text-sm text-slate-600">No class.</p> : null}</div></div>
            <div><p className="text-xs uppercase text-slate-500">Assigned work</p><div className="mt-2 space-y-2">{week.tasks.map((task: any) => <div key={task.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-950/40 p-3"><div><p className={`text-sm ${task.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{task.title}</p><p className="mt-1 text-xs text-slate-500">Due {new Date(task.dueDate).toLocaleDateString()}</p></div><Link href={`/work?task=${task.id}`} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200">Start</Link></div>)}{!week.tasks.length ? <p className="text-sm text-slate-600">No assignments.</p> : null}</div></div>
          </div>
        </article>;
      })}</section>
    </main>
  );
}
