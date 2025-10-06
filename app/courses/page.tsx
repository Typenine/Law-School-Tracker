"use client";
import { useEffect, useMemo, useState } from 'react';
import type { Course, Semester } from '@/lib/types';
import { courseColorClass } from '@/lib/colors';
import AddCourseWizard from '@/components/AddCourseWizard';
import TaskBacklogEntry from '@/components/TaskBacklogEntry';
import EditCourseModal from '@/components/EditCourseModal';

export const dynamic = 'force-dynamic';

const SEMS: Semester[] = ['Spring','Summer','Fall'];

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');
  const [semFilter, setSemFilter] = useState<Semester | 'all'>('all');
  const [showWizard, setShowWizard] = useState(false);
  const [showBacklog, setShowBacklog] = useState(false);
  const [editCourse, setEditCourse] = useState<Course | null>(null);

  async function refresh() {
    setLoading(true);
    const res = await fetch(`/api/courses?_ts=${Date.now()}` , { cache: 'no-store' });
    const data = await res.json();
    setCourses((data.courses || []) as Course[]);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

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
