"use client";
import { useEffect, useRef, useState } from 'react';
import { Task } from '@/lib/types';

interface Notice { id: string; title: string; course?: string | null; dueDate: string }

export default function ReminderManager() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const timerRef = useRef<any>(null);

  function shouldNotify(t: Task, leadHours: number) {
    if (t.status === 'done') return false;
    const due = new Date(t.dueDate).getTime();
    const now = Date.now();
    const leadMs = leadHours * 3600 * 1000;
    return due > now && due <= now + leadMs;
  }

  function alreadyNotified(id: string) {
    if (typeof window === 'undefined') return false;
    const set = new Set<string>((JSON.parse(window.sessionStorage.getItem('notifiedTaskIds') || '[]')));
    return set.has(id);
  }

  function markNotified(id: string) {
    if (typeof window === 'undefined') return;
    const arr: string[] = JSON.parse(window.sessionStorage.getItem('notifiedTaskIds') || '[]');
    if (!arr.includes(id)) {
      arr.push(id);
      window.sessionStorage.setItem('notifiedTaskIds', JSON.stringify(arr));
    }
  }

  async function check() {
    if (typeof window === 'undefined') return;
    const enabled = window.localStorage.getItem('remindersEnabled') === 'true';
    if (!enabled) return;
    const lead = parseFloat(window.localStorage.getItem('remindersLeadHours') || '24');
    const leadHours = isNaN(lead) || lead <= 0 ? 24 : lead;
    try {
      const res = await fetch('/api/tasks', { cache: 'no-store' });
      const data = await res.json();
      const tasks: Task[] = data.tasks || [];
      const upcoming = tasks.filter(t => shouldNotify(t, leadHours) && !alreadyNotified(t.id));
      if (upcoming.length) {
        const newNotices = upcoming.slice(0, 5).map(t => ({ id: t.id, title: t.title, course: t.course, dueDate: t.dueDate }));
        newNotices.forEach(n => markNotified(n.id));
        setNotices(prev => [...prev, ...newNotices]);
      }
    } catch {}
  }

  useEffect(() => {
    check();
    timerRef.current = setInterval(check, 5 * 60 * 1000); // every 5 minutes
    return () => timerRef.current && clearInterval(timerRef.current);
  }, []);

  function dismiss(id: string) {
    setNotices(prev => prev.filter(n => n.id !== id));
  }

  if (!notices.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {notices.map(n => (
        <div key={n.id} className="max-w-sm card p-3 border border-[#1b2344]">
          <div className="text-sm mb-1">Upcoming: {new Date(n.dueDate).toLocaleString()}</div>
          <div className="font-medium mb-1">{n.course ? `[${n.course}] ` : ''}{n.title}</div>
          <button onClick={() => dismiss(n.id)} className="text-xs px-2 py-1 rounded border border-[#1b2344]">Dismiss</button>
        </div>
      ))}
    </div>
  );
}
