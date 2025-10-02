"use client";
import { useEffect, useMemo, useState } from 'react';
import { Task, StudySession } from '@/lib/types';
import { courseColorClass } from '@/lib/colors';
import TaskAddForm from '@/components/TaskAddForm';

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function keyOf(d: Date) { const x = startOfDay(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; }
function labelOf(d: Date) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }

export default function PlannerBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentTerm, setCurrentTerm] = useState<string>('');
  const [courseScales, setCourseScales] = useState<Record<string, number>>({});
  const [openLogKey, setOpenLogKey] = useState<string | null>(null);
  const [logTaskId, setLogTaskId] = useState<string>('');
  const [logActivity, setLogActivity] = useState<string>('reading');
  const [logHours, setLogHours] = useState<string>('1.0');
  const [logFocus, setLogFocus] = useState<string>('5');
  const [logNotes, setLogNotes] = useState<string>('');
  const [logPages, setLogPages] = useState<string>('');
  const [logOutlinePages, setLogOutlinePages] = useState<string>('');
  const [logPracticeQs, setLogPracticeQs] = useState<string>('');

  async function refresh() {
    setLoading(true);
    const [tRes, sRes] = await Promise.all([
      fetch('/api/tasks', { cache: 'no-store' }),
      fetch('/api/sessions', { cache: 'no-store' }),
    ]);
    const [tData, sData] = await Promise.all([tRes.json(), sRes.json()]);
    setTasks(tData.tasks as Task[]);
    setSessions(sData.sessions as StudySession[]);
    setLoading(false);
  }

  async function applyAllSuggestions() {
    for (const s of suggestions) {
      await applySuggestion(s);
    }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCurrentTerm(window.localStorage.getItem('currentTerm') || '');
      try {
        const raw = window.localStorage.getItem('courseMppMap') || '{}';
        const map = JSON.parse(raw) as Record<string, number>;
        const def = parseFloat(window.localStorage.getItem('minutesPerPage') || '3') || 3;
        const scales: Record<string, number> = {};
        for (const [k, v] of Object.entries(map)) {
          const key = k.toLowerCase();
          const n = typeof v === 'number' && v > 0 ? v : def;
          scales[key] = n / def; // scale relative to default MPP
        }
        setCourseScales(scales);
      } catch {}
    }
  }, []);

  // (no additional course-loading needed now that bulk add is removed)

  const days = useMemo(() => {
    const today = startOfDay(new Date());
    const arr: { date: Date; key: string; label: string }[] = [];
    for (let i=0;i<7;i++) { const d = new Date(today); d.setDate(d.getDate()+i); arr.push({ date: d, key: keyOf(d), label: labelOf(d) }); }
    return arr;
  }, []);

  // Load-balancing assist: move tasks from heavy to lighter days within +/-2 days
  async function balanceWeek() {
    const heavy = (typeof window !== 'undefined') ? parseFloat(window.localStorage.getItem('heavyDayThreshold') || '240') : 240;
    const dayKeys = days.map(d => d.key);
    const indexOf: Record<string, number> = Object.fromEntries(dayKeys.map((k, i) => [k, i] as const));
    const loads: Record<string, number> = Object.fromEntries(dayKeys.map(k => [k, 0] as const));
    const bucketTasks: Record<string, Task[]> = Object.fromEntries(dayKeys.map(k => [k, [] as Task[]] as const));
    for (const t of tasks) {
      if (t.status === 'done') continue;
      const key = keyOf(new Date(t.dueDate));
      if (loads[key] === undefined) continue;
      loads[key] += (t.estimatedMinutes || 0);
      bucketTasks[key].push(t);
    }
    const moves: Array<{ id: string; toKey: string }> = [];
    for (const k of dayKeys) {
      if ((loads[k] || 0) <= heavy) continue;
      const tasksBySize = bucketTasks[k].slice().sort((a, b) => (b.estimatedMinutes || 0) - (a.estimatedMinutes || 0));
      for (const t of tasksBySize) {
        if ((loads[k] || 0) <= heavy) break;
        const i = indexOf[k];
        for (const off of [-2, -1, 1, 2]) {
          const j = i + off;
          if (j < 0 || j >= dayKeys.length) continue;
          const targetKey = dayKeys[j];
          const due = startOfDay(new Date(t.dueDate));
          const targetDate = new Date(days[j].date);
          if (targetDate > due) continue;
          const est = t.estimatedMinutes || 0;
          if ((loads[targetKey] || 0) + est <= heavy) {
            loads[k] -= est; loads[targetKey] += est;
            moves.push({ id: t.id, toKey: targetKey });
            break;
          }
        }
      }
    }
    for (const m of moves) {
      const [y, mo, d] = m.toKey.split('-').map(n => parseInt(n, 10));
      const nd = new Date(y, mo - 1, d, 23, 59, 59, 999);
      await fetch(`/api/tasks/${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate: nd.toISOString() }) });
    }
    if (moves.length) await refresh();
  }

  const filteredTasks = useMemo(() => tasks.filter(t => (!currentTerm || (t.term || '') === currentTerm)), [tasks, currentTerm]);

  const buckets = useMemo(() => {
    const map: Record<string, Task[]> = Object.fromEntries(days.map(d => [d.key, [] as Task[]]));
    for (const t of filteredTasks) {
      const k = keyOf(new Date(t.dueDate));
      if (map[k]) map[k].push(t);
    }
    for (const k of Object.keys(map)) map[k].sort((a,b) => a.dueDate.localeCompare(b.dueDate));
    return map;
  }, [filteredTasks, days]);

  const sessionsByKey = useMemo(() => {
    const m: Record<string, StudySession[]> = Object.fromEntries(days.map(d => [d.key, [] as StudySession[]]));
    for (const s of sessions) {
      const d = new Date(s.when);
      const key = keyOf(d);
      if (m[key]) m[key].push(s);
    }
    for (const k of Object.keys(m)) m[k].sort((a,b) => b.when.localeCompare(a.when));
    return m;
  }, [sessions, days]);

  // Suggestions: split large readings/assignments across days before due (informational only)
  const suggestions = useMemo(() => {
    const today = startOfDay(new Date());
    const out: Array<{ id: string; title: string; course: string | null | undefined; dueKey: string; plan: Array<{ key: string; minutes: number }> }> = [];
    for (const t of filteredTasks) {
      if (t.status === 'done') continue;
      const base = t.estimatedMinutes || 0;
      const scale = (t.course && courseScales[(t.course || '').toLowerCase()]) || 1;
      const est = Math.max(0, Math.round(base * scale));
      if (est < 120) continue; // threshold for suggesting splits
      const due = startOfDay(new Date(t.dueDate));
      if (due < today) continue;
      const daysBefore = Math.max(0, Math.floor((due.getTime() - today.getTime()) / (24*60*60*1000)));
      if (daysBefore < 1) continue; // nothing to split before due
      const splits = Math.min(3, Math.max(2, Math.ceil(est / 90))); // 90m chunks, 2-3 parts
      const per = Math.round(est / splits);
      const plan: Array<{ key: string; minutes: number }> = [];
      for (let i = splits - 1; i >= 1; i--) { // allocate to preceding days; keep final work on due day implicitly
        const d = new Date(due); d.setDate(d.getDate() - i);
        if (d < today) continue;
        plan.push({ key: keyOf(d), minutes: per });
      }
      if (plan.length) out.push({ id: t.id, title: t.title, course: t.course, dueKey: keyOf(due), plan });
    }
    return out;
  }, [filteredTasks, courseScales]);

  // Suggested allocation per day using per-course scales
  const suggestedDaily = useMemo(() => {
    const daily: Record<string, number> = Object.fromEntries(days.map(d => [d.key, 0] as const));
    const today = startOfDay(new Date());
    for (const t of filteredTasks) {
      if (t.status === 'done') continue;
      const base = t.estimatedMinutes || 0;
      const scale = (t.course && courseScales[(t.course || '').toLowerCase()]) || 1;
      const est = Math.max(0, Math.round(base * scale));
      const due = startOfDay(new Date(t.dueDate));
      if (due < today) continue;
      // distribute in 90m chunks across preceding days
      const CHUNK = 90;
      const splits = Math.max(1, Math.ceil(est / CHUNK));
      for (let i = splits - 1; i >= 0; i--) {
        const d = new Date(due); d.setDate(d.getDate() - i);
        const key = keyOf(d);
        if (daily[key] !== undefined) daily[key] += Math.min(CHUNK, est - (splits - 1 - i) * CHUNK);
      }
    }
    return daily;
  }, [filteredTasks, courseScales, days]);

  async function applySuggestion(s: { id: string; title: string; course: string | null | undefined; dueKey: string; plan: Array<{ key: string; minutes: number }> }) {
    try {
      // Create prep subtasks
      const createdIds: string[] = [];
      const total = s.plan.length;
      for (let i = 0; i < s.plan.length; i++) {
        const p = s.plan[i];
        const [y, m, d] = p.key.split('-').map(n => parseInt(n, 10));
        const due = new Date(y, m - 1, d, 23, 59, 59, 999);
        const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          title: `[Prep] ${s.title} (part ${i+1}/${total})`,
          course: s.course || null,
          dueDate: due.toISOString(),
          status: 'todo',
          estimatedMinutes: p.minutes,
          term: currentTerm || null,
        })});
        if (!res.ok) throw new Error('failed to create prep');
        const data = await res.json();
        createdIds.push(data.task.id);
      }
      // Update main task dependsOn
      const main = tasks.find(t => t.id === s.id);
      const prev = (main?.dependsOn || []) as string[];
      const patch = await fetch(`/api/tasks/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dependsOn: [...prev, ...createdIds] }) });
      if (!patch.ok) throw new Error('failed to update main task');
      await refresh();
    } catch { /* ignore for now, could add toast */ }
  }

  function onDragStart(e: React.DragEvent, t: Task) {
    e.dataTransfer.setData('text/plain', t.id);
  }

  async function moveTaskToDay(taskId: string, day: Date) {
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;
    const old = new Date(t.dueDate);
    const next = new Date(day);
    // date-only preference: normalize to end-of-day
    next.setHours(23, 59, 59, 999);
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate: next.toISOString() }) });
    if (res.ok) await refresh();
  }

  function onDropDay(e: React.DragEvent, day: Date) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) moveTaskToDay(id, day);
  }

  async function toggleDone(id: string, done: boolean) {
    await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: done ? 'done' : 'todo' }) });
    await refresh();
  }

  async function saveLog(forKey: string) {
    const [y, m, d] = forKey.split('-').map(n => parseInt(n, 10));
    const when = new Date(y, m - 1, d, 20, 0, 0, 0); // evening default time
    const minutes = Math.max(0, Math.round(parseFloat(logHours || '0') * 60));
    const body: any = {
      taskId: logTaskId || null,
      when: when.toISOString(),
      minutes,
      focus: parseInt(logFocus || '5', 10),
      notes: logNotes || null,
      pagesRead: logPages ? parseInt(logPages, 10) : null,
      outlinePages: logOutlinePages ? parseInt(logOutlinePages, 10) : null,
      practiceQs: logPracticeQs ? parseInt(logPracticeQs, 10) : null,
      activity: logActivity || null,
    };
    const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      setOpenLogKey(null);
      setLogTaskId(''); setLogActivity('reading'); setLogHours('1.0'); setLogFocus('5'); setLogNotes(''); setLogPages(''); setLogOutlinePages(''); setLogPracticeQs('');
      await refresh();
    }
  }


  return (
    <div className="space-y-4">
      <div className="card p-4">
        <TaskAddForm onCreated={refresh} />
      </div>
      {suggestions.length > 0 && (
        <div className="rounded border border-[#1b2344] p-4">
          <div className="text-slate-300/70 text-xs mb-2">Suggestions to spread large readings/assignments across days (date-only)</div>
          <ul className="text-xs space-y-1">
            {suggestions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-slate-200">{s.title}</span> {s.course ? `(${s.course}) ` : ''}→ {s.plan.map(p => `${p.key}: ~${p.minutes}m`).join(', ')}
                </div>
                <button onClick={() => applySuggestion(s)} className="px-2 py-1 rounded border border-[#1b2344]">Apply</button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button onClick={applyAllSuggestions} className="px-3 py-2 rounded border border-[#1b2344]">Apply all</button>
            <button onClick={balanceWeek} className="px-3 py-2 rounded border border-[#1b2344]">Balance this week</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {days.map(d => (
          <div key={d.key} className="card p-4"
               onDragOver={(e) => e.preventDefault()}
               onDrop={(e) => onDropDay(e, d.date)}>
            <div className="text-slate-300/80 text-sm mb-2">{d.label}</div>
            {loading && <div className="text-xs text-slate-300/70">Loading...</div>}
            {buckets[d.key].length === 0 ? (
              <div className="text-sm text-slate-300/70">No tasks.</div>
            ) : (
              <ul className="space-y-2">
                {buckets[d.key].map(t => (
                  <li key={t.id} draggable onDragStart={(e) => onDragStart(e, t)} className="border border-[#1b2344] rounded p-2 cursor-move">
                    <div className="text-sm font-medium flex items-center gap-2">
                      {t.course ? <span className={`inline-block w-2.5 h-2.5 rounded-full ${courseColorClass(t.course, 'bg')}`}></span> : null}
                      <span className="truncate">{t.title}</span>
                      <label className="ml-auto text-xs inline-flex items-center gap-1"><input type="checkbox" checked={t.status === 'done'} onChange={e => toggleDone(t.id, e.target.checked)} /> Done</label>
                    </div>
                    <div className="text-xs text-slate-300/70 flex items-center gap-2 flex-wrap">
                      <span>{t.course || '-'}</span>
                      <span>• {t.status}</span>
                      {typeof t.estimatedMinutes === 'number' ? <span>• est {t.estimatedMinutes}m</span> : null}
                      {(t.tags || []).map((tg, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded border border-[#1b2344]">{tg}</span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <button onClick={() => setOpenLogKey(k => k === d.key ? null : d.key)} className="px-2 py-1 rounded border border-[#1b2344] text-xs">{openLogKey === d.key ? 'Close log' : 'Log session'}</button>
            </div>
            {openLogKey === d.key && (
              <div className="mt-2 text-xs space-y-2 border border-[#1b2344] rounded p-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <label className="block mb-1">Task (optional)</label>
                    <select value={logTaskId} onChange={e => setLogTaskId(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1">
                      <option value="">-- none --</option>
                      {buckets[d.key].map(t => (<option key={t.id} value={t.id}>{t.course ? `[${t.course}] ` : ''}{t.title}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1">Activity</label>
                    <select value={logActivity} onChange={e => setLogActivity(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1">
                      <option value="reading">Reading</option>
                      <option value="review">Review</option>
                      <option value="outline">Outline</option>
                      <option value="practice">Practice</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1">Hours</label>
                    <input value={logHours} onChange={e => setLogHours(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                  </div>
                  <div>
                    <label className="block mb-1">Focus (1-10)</label>
                    <input type="number" min={1} max={10} value={logFocus} onChange={e => setLogFocus(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                  </div>
                  <div>
                    <label className="block mb-1">Pages Read</label>
                    <input value={logPages} onChange={e => setLogPages(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                  </div>
                  <div>
                    <label className="block mb-1">Outline Pages</label>
                    <input value={logOutlinePages} onChange={e => setLogOutlinePages(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                  </div>
                  <div>
                    <label className="block mb-1">Practice Qs</label>
                    <input value={logPracticeQs} onChange={e => setLogPracticeQs(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block mb-1">Notes</label>
                    <input value={logNotes} onChange={e => setLogNotes(e.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1" />
                  </div>
                </div>
                <div>
                  <button onClick={() => saveLog(d.key)} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500">Save</button>
                </div>
              </div>
            )}
            {sessionsByKey[d.key] && sessionsByKey[d.key].length > 0 && (
              <div className="mt-3">
                <div className="text-xs text-slate-300/70 mb-1">Logged sessions</div>
                <ul className="space-y-1">
                  {sessionsByKey[d.key].slice(0,3).map(s => (
                    <li key={s.id} className="text-xs border border-[#1b2344] rounded px-2 py-1 flex items-center justify-between">
                      <span>{(s.activity || 'work')}: {Math.round(s.minutes/60*10)/10}h{s.pagesRead ? ` · pp. ${s.pagesRead}` : ''}{s.practiceQs ? ` · ${s.practiceQs} Qs` : ''}</span>
                      <span className="text-slate-300/60">Focus {s.focus ?? '-'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Suggested allocation panel */}
      <div className="rounded border border-[#1b2344] p-4">
        <div className="text-slate-300/70 text-xs mb-2">Suggested minutes per day (based on upcoming workload and per-course pace)</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {days.map(d => (
            <div key={d.key} className="flex items-center justify-between border border-[#1b2344] rounded px-2 py-1">
              <span className="text-xs text-slate-300/70">{d.label}</span>
              <span className="text-xs text-slate-200">{suggestedDaily[d.key] || 0}m</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
