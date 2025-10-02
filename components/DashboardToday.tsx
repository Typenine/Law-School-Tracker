"use client";
import { useEffect, useMemo, useState } from 'react';
import type { Task, Course, CourseMeetingBlock } from '@/lib/types';
import { courseColorClass } from '@/lib/colors';

function sameLocalDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toMin(hhmm: string | null | undefined) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(x => parseInt(x, 10));
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

export default function DashboardToday() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [tRes, cRes] = await Promise.all([
        fetch('/api/tasks', { cache: 'no-store' }),
        fetch('/api/courses', { cache: 'no-store' }),
      ]);
      const tJson = await tRes.json();
      const cJson = await cRes.json();
      setTasks(tJson.tasks || []);
      setCourses(cJson.courses || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const today = new Date();
  const dayIdx = today.getDay(); // 0..6

  const classesToday = useMemo(() => {
    const list: Array<{ key: string; title: string; code: string | null | undefined; startMin: number; endMin: number; location?: string | null }>= [];
    for (const c of courses) {
      const inRange = (() => {
        const s = c.startDate ? new Date(c.startDate) : null;
        const e = c.endDate ? new Date(c.endDate) : null;
        if (s && today < new Date(s.getFullYear(), s.getMonth(), s.getDate())) return false;
        if (e && today > new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23,59,59,999)) return false;
        return true;
      })();
      if (!inRange) continue;
      const blocks: CourseMeetingBlock[] = Array.isArray(c.meetingBlocks) && c.meetingBlocks.length
        ? (c.meetingBlocks as CourseMeetingBlock[])
        : ((Array.isArray(c.meetingDays) && c.meetingStart && c.meetingEnd) ? [{ days: c.meetingDays, start: c.meetingStart, end: c.meetingEnd, location: c.location || c.room || null }] as any : []);
      for (const b of blocks) {
        if (!b.days?.includes(dayIdx)) continue;
        const s = toMin((b as any).start); const e = toMin((b as any).end);
        if (s == null || e == null) continue;
        list.push({ key: `${c.id}-${s}-${e}`, title: c.title, code: c.code, startMin: s, endMin: e, location: (b as any).location || c.location || c.room || null });
      }
    }
    list.sort((a,b) => a.startMin - b.startMin);
    return list;
  }, [courses]);

  const tasksToday = useMemo(() => {
    return tasks.filter(t => sameLocalDate(new Date(t.dueDate), today));
  }, [tasks]);

  async function toggleDone(id: string, done: boolean) {
    await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: done ? 'done' : 'todo' }) });
    refresh();
  }

  const fmtTime = (m: number) => {
    const h = Math.floor(m/60); const mi = m%60;
    const hh = ((h + 11) % 12) + 1; const ap = h >= 12 ? 'PM' : 'AM';
    return `${hh}:${String(mi).padStart(2,'0')} ${ap}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-medium">Today</h2>
        <div className="text-sm text-slate-300/70">{today.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}</div>
      </div>
      {loading ? (
        <div className="text-sm">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-medium mb-1">Classes</div>
            {classesToday.length === 0 ? (
              <div className="text-sm text-slate-300/70">No classes today.</div>
            ) : (
              <ul className="space-y-1">
                {classesToday.map(c => (
                  <li key={c.key} className="flex items-center gap-2">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${courseColorClass(c.title || c.code || '', 'bg')}`}></span>
                    <span className="text-sm">{fmtTime(c.startMin)}–{fmtTime(c.endMin)} · {c.title}{c.code ? ` (${c.code})` : ''}{c.location ? ` · ${c.location}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-sm font-medium mb-1">Tasks due</div>
            {tasksToday.length === 0 ? (
              <div className="text-sm text-slate-300/70">No tasks due today.</div>
            ) : (
              <ul className="space-y-1">
                {tasksToday.sort((a,b) => a.title.localeCompare(b.title)).map(t => (
                  <li key={t.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={t.status === 'done'} onChange={e => toggleDone(t.id, e.target.checked)} />
                    {t.course ? <span className={`inline-block w-2.5 h-2.5 rounded-full ${courseColorClass(t.course, 'bg')}`}></span> : null}
                    <span className={`text-sm ${t.status === 'done' ? 'line-through text-slate-400' : ''}`}>{t.title}</span>
                    {typeof t.estimatedMinutes === 'number' ? <span className="text-xs text-slate-300/70">· {t.estimatedMinutes}m</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="mt-3 text-xs text-slate-300/70 flex gap-3">
        <a className="underline" href="/planner">Planner</a>
        <a className="underline" href="/calendar">Calendar</a>
        <a className="underline" href="/courses">Courses</a>
      </div>
    </div>
  );
}
