"use client";
import { useEffect, useMemo, useState } from 'react';
import type { Course, Semester } from '@/lib/types';
import { courseColorClass } from '@/lib/colors';
import AddCourseWizard from '@/components/AddCourseWizard';
import TaskBacklogEntry from '@/components/TaskBacklogEntry';
import EditCourseModal from '@/components/EditCourseModal';
import { getSessionCourse, normCourseKey, buildTasksById, extractCourseFromNotes } from '@/lib/courseMatching';

export const dynamic = 'force-dynamic';

const SEMS: Semester[] = ['Spring','Summer','Fall'];

type WeeklyGoal = { id: string; scope: 'global'|'course'; weeklyMinutes: number; course?: string | null };
const LS_GOALS = 'weeklyGoalsV1';

function chicagoYmd(d: Date): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = f.formatToParts(d);
  const y = parts.find(p=>p.type==='year')?.value || '0000';
  const m = parts.find(p=>p.type==='month')?.value || '01';
  const da = parts.find(p=>p.type==='day')?.value || '01';
  return `${y}-${m}-${da}`;
}
function mondayOfChicago(d: Date): Date { const ymd = chicagoYmd(d); const [yy,mm,dd]=ymd.split('-').map(x=>parseInt(x,10)); const local = new Date(yy,(mm as number)-1,dd); const dow = local.getDay(); const delta = (dow + 6) % 7; local.setDate(local.getDate()-delta); return local; }
function weekKeysChicago(d: Date): string[] { const monday = mondayOfChicago(d); return Array.from({length:7},(_,i)=>{const x=new Date(monday); x.setDate(x.getDate()+i); return chicagoYmd(x);}); }
function loadGoals(): WeeklyGoal[] { if (typeof window==='undefined') return []; try { const raw=window.localStorage.getItem(LS_GOALS); const arr=raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; } catch { return []; } }
function saveGoals(goals: WeeklyGoal[]) { if (typeof window!=='undefined') window.localStorage.setItem(LS_GOALS, JSON.stringify(goals)); }

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');
  const [semFilter, setSemFilter] = useState<Semester | 'all'>('all');
  const [showWizard, setShowWizard] = useState(false);
  const [showBacklog, setShowBacklog] = useState(false);
  const [editCourse, setEditCourse] = useState<Course | null>(null);
  const [goals, setGoals] = useState<WeeklyGoal[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);

  type CourseMppEntry = { mpp: number; sample?: number | null; updatedAt?: string | null; overrideEnabled?: boolean | null; overrideMpp?: number | null };
  function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
  function baseMpp(): number { if (typeof window==='undefined') return 2; const s = window.localStorage.getItem('minutesPerPage'); const n = s ? parseFloat(s) : NaN; return (!isNaN(n) && n>0) ? n : 2; }
  function saveCourseMppMap(cs: Course[]) {
    if (typeof window === 'undefined') return;
    const map: Record<string, CourseMppEntry> = {};
    for (const c of cs) {
      const key = (c.title || '').trim().toLowerCase(); if (!key) continue;
      const learned = (c as any).learnedMpp as number | null | undefined;
      const sample = (c as any).learnedSample as number | null | undefined;
      const updatedAt = (c as any).learnedUpdatedAt as string | null | undefined;
      const overrideEnabled = (c as any).overrideEnabled as boolean | null | undefined;
      const overrideMpp = (c as any).overrideMpp as number | null | undefined;
      const m = overrideEnabled && typeof overrideMpp === 'number' && overrideMpp>0
        ? clamp(overrideMpp, 0.5, 6.0)
        : (typeof learned === 'number' ? clamp(learned, 0.5, 6.0) : baseMpp());
      map[key] = { mpp: m, sample: sample ?? null, updatedAt: updatedAt ?? null, overrideEnabled: !!overrideEnabled, overrideMpp: overrideMpp ?? null };
    }
    try { window.localStorage.setItem('courseMppMap', JSON.stringify(map)); } catch {}
  }

  async function refresh() {
    setLoading(true);
    const res = await fetch(`/api/courses?_ts=${Date.now()}` , { cache: 'no-store' });
    const data = await res.json();
    setCourses((data.courses || []) as Course[]);
    setLoading(false);
  }

  useEffect(() => { refresh(); setGoals(loadGoals()); }, []);
  useEffect(() => { saveGoals(goals); }, [goals]);
  useEffect(() => { if (Array.isArray(courses) && courses.length) saveCourseMppMap(courses); }, [courses]);

  // Load sessions and tasks (for per-course logged minutes)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [sRes, tRes] = await Promise.all([
          fetch('/api/sessions', { cache: 'no-store' }),
          fetch('/api/tasks', { cache: 'no-store' })
        ]);
        const sData = await sRes.json().catch(() => ({ sessions: [] }));
        const tData = await tRes.json().catch(() => ({ tasks: [] }));
        if (mounted) { setSessions(sData.sessions || []); setTasks(tData.tasks || []); }
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  const fmt12 = (hhmm?: string | null) => {
    if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
    const [hStr, mStr] = hhmm.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (isNaN(h) || isNaN(m)) return '';
    const h12 = ((h + 11) % 12) + 1;
    const ampm = h < 12 ? 'AM' : 'PM';
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  const years = useMemo(() => {
    const yearSet = new Set<number>();
    courses.forEach(c => { if (c.year) yearSet.add(c.year); });
    return Array.from(yearSet).sort((a, b) => b - a);
  }, [courses]);

  const filtered = useMemo(() => {
    return courses.filter(c => {
      if (yearFilter !== 'all' && c.year !== yearFilter) return false;
      if (semFilter !== 'all' && c.semester !== semFilter) return false;
      return true;
    });
  }, [courses, yearFilter, semFilter]);

  // Per-course logged minutes this week (uses normalized keys for consistent matching)
  const weekKeys = useMemo(() => weekKeysChicago(new Date()), []);
  const minutesByCourseKey = useMemo(() => {
    const m = new Map<string, number>();
    const tasksById = new Map<string, any>();
    for (const t of (tasks||[])) if (t && t.id) tasksById.set(t.id, t);
    for (const s of (sessions||[])) {
      const k = chicagoYmd(new Date(s.when));
      if (!weekKeys.includes(k)) continue;
      // Use same course extraction as Stats column for consistency
      const course = getSessionCourse(s, tasksById);
      if (!course) continue;
      // Use normalized key for lookup consistency
      const courseKey = normCourseKey(course);
      if (!courseKey) continue;
      m.set(courseKey, (m.get(courseKey)||0) + (s.minutes||0));
    }
    return m;
  }, [sessions, tasks, weekKeys]);

  function zscoreTrim(values: number[]): number[] {
    if (values.length === 0) return values;
    const mean = values.reduce((a,b)=>a+b,0)/values.length;
    const variance = values.reduce((a,b)=>a + Math.pow(b-mean,2),0) / values.length;
    const sd = Math.sqrt(variance);
    if (!isFinite(sd) || sd === 0) return values;
    return values.filter(v => Math.abs(v - mean) <= 2 * sd);
  }
  function last10AvgMppForCourse(title: string): { avg: number | null; n: number } {
    const tById = new Map<string, any>();
    for (const t of (tasks||[])) if (t && t.id) tById.set(t.id, t);
    const all = (sessions||[]).map(s => {
      const task = s.taskId ? tById.get(s.taskId) : null;
      let course = task?.course || extractCourseFromNotes(s.notes) || '';
      if (String(course).trim().toLowerCase() !== String(title||'').trim().toLowerCase()) return null;
      const minutes = Number(s.minutes)||0; const pages = Number(s.pagesRead)||0;
      if (minutes < 5 || minutes > 240 || pages < 2 || pages > 150) return null;
      return { when: new Date(s.when).getTime(), mpp: minutes/Math.max(1,pages) };
    }).filter(Boolean) as { when:number; mpp:number }[];
    all.sort((a,b)=>b.when-a.when);
    const mpps = all.slice(0,10).map(x=>x.mpp);
    const trimmed = zscoreTrim(mpps);
    if (!trimmed.length) return { avg: null, n: 0 };
    const avg = trimmed.reduce((a,b)=>a+b,0)/trimmed.length;
    return { avg, n: trimmed.length };
  }

  function setCourseGoalHours(courseTitle: string, hours: number) {
    const mins = Math.max(0, Math.round(hours * 60));
    setGoals(prev => {
      const arr = prev.slice();
      const idx = arr.findIndex(g => g.scope==='course' && (g.course||'') === courseTitle);
      if (idx >= 0) arr[idx] = { ...arr[idx], weeklyMinutes: mins };
      else arr.push({ id: `course:${courseTitle}`, scope: 'course', weeklyMinutes: mins, course: courseTitle });
      return arr;
    });
  }

  return (
    <main className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Courses</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowBacklog(true)} className="px-3 py-1 rounded border border-[#1b2344] text-sm hover:bg-[#1b2344]">Add Historical Task</button>
          <button onClick={() => setShowWizard(true)} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm">Add Course</button>
          <button onClick={refresh} className="px-2 py-1 rounded border border-[#1b2344]">Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
        <div>
          <label className="block text-xs text-slate-300/70 mb-1">Year</label>
          <select value={yearFilter} onChange={e => setYearFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
            <option value="all">All</option>
            {years.map(y => (<option key={y} value={y}>{y}</option>))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-300/70 mb-1">Semester</label>
          <select value={semFilter} onChange={e => setSemFilter(e.target.value as any)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
            <option value="all">All</option>
            {SEMS.map(s => (<option key={s} value={s}>{s}</option>))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Loading courses...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-slate-400 mb-4">No courses yet</div>
          <button onClick={() => setShowWizard(true)} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white">
            Add Your First Course
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-300/60">
              <tr>
                <th className="py-2 pr-4">Course</th>
                <th className="py-2 pr-4">Meeting</th>
                <th className="py-2 pr-4">Dates</th>
                <th className="py-2 pr-4">Term</th>
                <th className="py-2 pr-4">Stats</th>
                <th className="py-2 pr-4">Weekly Goal</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const blocks = (Array.isArray(c.meetingBlocks) && c.meetingBlocks.length)
                  ? c.meetingBlocks
                  : ((Array.isArray(c.meetingDays) && c.meetingStart && c.meetingEnd)
                      ? [{ days: c.meetingDays, start: c.meetingStart, end: c.meetingEnd, location: c.room || c.location || null }]
                      : []);
                const goalMin = goals.find(g => g.scope==='course' && (g.course||'')===c.title)?.weeklyMinutes || 0;
                const loggedMin = minutesByCourseKey.get(normCourseKey(c.title)) || 0;
                const pct = goalMin>0 ? Math.min(1, loggedMin/goalMin) : 0;
                return (
                  <tr key={c.id} className="border-t border-[#1b2344]">
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block w-3 h-3 rounded-full ${c.color ? '' : courseColorClass(c.title, 'bg')}`} style={c.color ? { backgroundColor: c.color } : undefined}></span>
                        <div>
                          <div className="font-medium">{c.title}</div>
                          {c.code && <div className="text-xs text-slate-400">{c.code}</div>}
                          {c.instructor && <div className="text-xs text-slate-400">{c.instructor}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {Array.isArray(blocks) && blocks.length ? (
                        <ul className="space-y-0.5">
                          {blocks.map((b: any, i: number) => (
                            <li key={i} className="text-xs">
                              {(b.days || []).map((d: number) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}
                              {b.start && b.end ? ` • ${fmt12(String(b.start))}–${fmt12(String(b.end))}` : ''}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-slate-500">—</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {c.startDate && c.endDate ? (
                        <div>
                          {new Date(c.startDate).toLocaleDateString()} – {new Date(c.endDate).toLocaleDateString()}
                        </div>
                      ) : (
                        <div className="text-slate-500">—</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {c.semester && c.year ? `${c.semester} ${c.year}` : '—'}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap align-top">
                      {(() => {
                        // Build tasks lookup map
                        const tasksById = new Map<string, any>();
                        for (const t of tasks) if (t && t.id) tasksById.set(t.id, t);
                        
                        // Calculate stats for this course using normalized matching
                        const courseKey = normCourseKey(c.title);
                        const codeKey = normCourseKey(c.code);
                        
                        // Match sessions using same logic as log page
                        const courseSessions = (sessions || []).filter(s => {
                          const sessionCourse = getSessionCourse(s, tasksById);
                          const sessionKey = normCourseKey(sessionCourse);
                          
                          // Match if normalized keys match or one contains the other
                          return (
                            sessionKey === courseKey ||
                            (codeKey && sessionKey === codeKey) ||
                            (sessionKey && courseKey && (sessionKey.includes(courseKey) || courseKey.includes(sessionKey)))
                          );
                        });
                        
                        const totalMinutes = courseSessions.reduce((sum: number, s: any) => sum + (Number(s.minutes) || 0), 0);
                        const totalPages = courseSessions.reduce((sum: number, s: any) => sum + (Number(s.pagesRead) || 0), 0);
                        const timePerPage = totalPages > 0 ? totalMinutes / totalPages : 0;
                        
                        // Average focus (only count sessions with valid focus values)
                        const sessionsWithFocus = courseSessions.filter((s: any) => typeof s.focus === 'number' && s.focus > 0);
                        const avgFocus = sessionsWithFocus.length > 0 
                          ? sessionsWithFocus.reduce((sum: number, s: any) => sum + Number(s.focus), 0) / sessionsWithFocus.length 
                          : 0;
                        
                        // Time this week
                        const weekSessions = courseSessions.filter((s: any) => weekKeys.includes(chicagoYmd(new Date(s.when))));
                        const weekMinutes = weekSessions.reduce((sum: number, s: any) => sum + (Number(s.minutes) || 0), 0);
                        
                        const fmtTime = (mins: number) => {
                          const h = Math.floor(mins / 60);
                          const m = Math.round(mins % 60);
                          return h > 0 ? `${h}h ${m}m` : `${m}m`;
                        };
                        
                        // Focus color based on value
                        const focusColor = avgFocus >= 8 ? 'text-emerald-400' : avgFocus >= 6 ? 'text-blue-400' : avgFocus >= 4 ? 'text-amber-400' : 'text-rose-400';
                        
                        return (
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between gap-4">
                              <span className="text-slate-400">Time/Page:</span>
                              <span className="font-medium">{timePerPage > 0 ? `${timePerPage.toFixed(1)} min` : '—'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-slate-400">This Week:</span>
                              <span className="font-medium">{weekMinutes > 0 ? fmtTime(weekMinutes) : '—'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-slate-400">Total Time:</span>
                              <span className="font-medium">{totalMinutes > 0 ? fmtTime(totalMinutes) : '—'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-slate-400">Total Pages:</span>
                              <span className="font-medium">{totalPages > 0 ? totalPages : '—'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-slate-400">Avg Focus:</span>
                              <span className={`font-medium ${avgFocus > 0 ? focusColor : ''}`}>
                                {avgFocus > 0 ? `${avgFocus.toFixed(1)}/10` : '—'}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2 mb-2">
                        <label className="text-xs text-slate-300/70">Goal (hrs)</label>
                        <input type="number" min={0} step={1} value={Math.round(goalMin/60)} onChange={e=>setCourseGoalHours(c.title, parseInt(e.target.value||'0',10)||0)} className="w-20 bg-[#0b1020] border border-[#1b2344] rounded px-2 py-1 text-sm" />
                      </div>
                      <div className="h-2 bg-[#0c1328] rounded overflow-hidden border border-[#1b2344]">
                        <div className="h-full bg-emerald-600" style={{ width: `${Math.round(pct*100)}%` }}></div>
                      </div>
                      <div className="text-xs text-slate-300/70 mt-1">{Math.round(loggedMin/60)}h of {Math.round(goalMin/60)}h</div>
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <a href={`/calendar?course=${encodeURIComponent(c.title)}`} className="px-2 py-1 rounded border border-[#1b2344] text-xs">Calendar</a>
                        <button 
                          onClick={() => {
                            console.log('Edit clicked for course:', c.id, c.title);
                            setEditCourse(c);
                          }} 
                          className="px-2 py-1 rounded border border-[#1b2344] text-xs hover:bg-[#1b2344]"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={async () => {
                            console.log('Delete clicked for course:', c.id, c.title);
                            if (!confirm(`Delete "${c.title}"? This will not delete related tasks.`)) return;
                            console.log('Making DELETE request to:', `/api/courses/${c.id}`);
                            const res = await fetch(`/api/courses/${c.id}`, { method: 'DELETE' });
                            console.log('DELETE response status:', res.status);
                            if (res.ok) {
                              console.log('Delete successful, removing from UI');
                              setCourses(prev => prev.filter(x => x.id !== c.id));
                              alert('Course deleted successfully');
                            } else {
                              const errorText = await res.text();
                              console.error('Delete failed:', errorText);
                              alert(`Delete failed: ${errorText}`);
                            }
                          }} 
                          className="px-2 py-1 rounded border border-rose-600 text-rose-300 text-xs hover:bg-rose-600 hover:text-white"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showWizard && (
        <AddCourseWizard
          onCourseAdded={async (course) => {
            setCourses(prev => [...prev, course].sort((a, b) => (a.title || '').localeCompare(b.title || '')));
            await refresh();
          }}
          onClose={() => setShowWizard(false)}
        />
      )}
      {editCourse && (
        <EditCourseModal
          course={editCourse}
          onSaved={(updated) => {
            // Update the course in the list immediately
            setCourses(prev => prev.map(c => c.id === updated.id ? updated : c));
            // Close the modal
            setEditCourse(null);
          }}
          onClose={() => setEditCourse(null)}
        />
      )}

      {showBacklog && (
        <TaskBacklogEntry
          courses={courses}
          onTaskAdded={() => {
            console.log('Historical task added');
          }}
          onClose={() => setShowBacklog(false)}
        />
      )}
    </main>
  );
}
