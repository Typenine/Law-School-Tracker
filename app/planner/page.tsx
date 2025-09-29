import { ensureSchema, listTasks } from '@/lib/storage';
import { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function keyOf(d: Date) {
  const x = startOfDay(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function labelOf(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default async function PlannerPage() {
  await ensureSchema();
  const tasks: Task[] = await listTasks();
  const today = startOfDay(new Date());

  // next 7 days buckets
  const days: { date: Date; key: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    days.push({ date: d, key: keyOf(d), label: labelOf(d) });
  }

  const bucket: Record<string, Task[]> = {};
  for (const day of days) bucket[day.key] = [];

  for (const t of tasks) {
    const due = new Date(t.dueDate);
    const k = keyOf(due);
    if (bucket[k]) bucket[k].push(t);
  }

  return (
    <main className="space-y-4">
      <h2 className="text-lg font-medium">Planner (Next 7 days)</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {days.map(day => (
          <div key={day.key} className="card p-4">
            <div className="text-slate-300/80 text-sm mb-2">{day.label}</div>
            {bucket[day.key].length === 0 ? (
              <div className="text-sm text-slate-300/70">No tasks.</div>
            ) : (
              <ul className="space-y-2">
                {bucket[day.key]
                  .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                  .map(t => (
                  <li key={t.id} className="border border-[#1b2344] rounded p-2">
                    <div className="text-sm font-medium">{t.title}</div>
                    <div className="text-xs text-slate-300/70">{t.course || '-'} • {new Date(t.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {t.status}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
