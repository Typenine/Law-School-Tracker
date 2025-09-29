"use client";
import { useEffect, useMemo, useState } from 'react';
import { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function keyOf(d: Date) { const x = startOfDay(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; }

export default function CalendarPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const res = await fetch('/api/tasks', { cache: 'no-store' });
    const data = await res.json();
    setTasks(data.tasks as Task[]);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  const firstDow = first.getDay(); // 0 Sun
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - ((firstDow + 6) % 7)); // back to Monday start
  const weeks = useMemo(() => {
    const rows: Date[][] = [];
    let cursor = new Date(gridStart);
    for (let r = 0; r < 6; r++) {
      const row: Date[] = [];
      for (let c = 0; c < 7; c++) { row.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }
      rows.push(row);
    }
    return rows;
  }, [year, month]);

  const byDay = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of tasks) {
      const k = keyOf(new Date(t.dueDate));
      (m[k] ||= []).push(t);
    }
    for (const k of Object.keys(m)) m[k].sort((a,b) => a.title.localeCompare(b.title));
    return m;
  }, [tasks]);

  return (
    <main className="space-y-4">
      <h2 className="text-lg font-medium">Calendar (Current Month)</h2>
      {loading && <div className="text-xs text-slate-300/70">Loading…</div>}
      <div className="grid grid-cols-7 gap-2">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
          <div key={d} className="text-center text-xs text-slate-300/70">{d}</div>
        ))}
        {weeks.flat().map((d, idx) => {
          const k = keyOf(d);
          const monthClass = d.getMonth() === month ? '' : 'opacity-50';
          const list = byDay[k] || [];
          return (
            <div key={idx} className={`border border-[#1b2344] rounded p-2 min-h-[100px] ${monthClass}`}>
              <div className="text-xs text-slate-300/70 mb-1">{d.getDate()}</div>
              {list.length === 0 ? (
                <div className="text-[11px] text-slate-300/50">—</div>
              ) : (
                <ul className="space-y-1">
                  {list.slice(0,4).map(t => (
                    <li key={t.id} className="text-[11px]">
                      <span className="text-slate-200">{t.title}</span>
                      {t.course ? <span className="text-slate-300/60"> · {t.course}</span> : null}
                      {typeof t.estimatedMinutes === 'number' ? <span className="text-slate-300/60"> · {t.estimatedMinutes}m</span> : null}
                    </li>
                  ))}
                  {list.length > 4 && (
                    <li className="text-[11px] text-slate-300/60">+{list.length - 4} more…</li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
