'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';

type MeetingBlock = { days: number[]; start: string; end: string; location?: string | null };
type Course = {
  id: string; title: string; code?: string | null; instructor?: string | null; room?: string | null; location?: string | null;
  meetingDays?: number[] | null; meetingStart?: string | null; meetingEnd?: string | null; meetingBlocks?: MeetingBlock[] | null;
};
type Task = {
  id: string; title: string; course?: string | null; courseId?: string | null; dueDate: string; workflowState?: string;
  blocked?: boolean; atRisk?: boolean; percentComplete?: number; activity?: string | null; tags?: string[] | null;
  reading?: { percentComplete?: number; remainingPages?: number; assignedPages?: number } | null;
};
type Note = { id: string; title: string; course?: string | null; section?: string | null; sourceType?: string | null; classDate?: string | null; updatedAt?: string };
type Session = { id: string; taskId?: string | null; when: string; minutes: number; outlinePages?: number | null; activity?: string | null };
type Document = { id: string; title: string; filename: string; url: string; category: string; createdAt: string };
type Workspace = { tasks: Task[] };
type WeekCoverage = { week: number; classNotes: number; readingNotes: number; caseBriefs: number; readingTasks: number; readingsDone: number; outlineNotes: number };

function weekNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/week\s*(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|\d+)/i);
  if (!match) return null;
  const token = match[0].replace(/week\s*/i, '').toLowerCase();
  const words: Record<string, number> = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16 };
  return words[token] || Number(token) || null;
}
function fmtMinutes(value: number) {
  const total = Math.max(0, Math.round(value || 0));
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}
function nextClass(course: Course): { when: Date; end: string; location?: string | null } | null {
  const blocks: MeetingBlock[] = Array.isArray(course.meetingBlocks) && course.meetingBlocks.length
    ? course.meetingBlocks
    : (Array.isArray(course.meetingDays) && course.meetingStart && course.meetingEnd
      ? [{ days: course.meetingDays, start: course.meetingStart, end: course.meetingEnd, location: course.location || course.room }]
      : []);
  const now = new Date();
  const candidates: Array<{ when: Date; end: string; location?: string | null }> = [];
  for (let add = 0; add < 8; add++) {
    const day = new Date(now); day.setDate(now.getDate() + add);
    for (const block of blocks) {
      if (!block.days.includes(day.getDay())) continue;
      const [hour, minute] = block.start.split(':').map(Number);
      const when = new Date(day); when.setHours(hour || 0, minute || 0, 0, 0);
      if (when > now) candidates.push({ when, end: block.end, location: block.location || course.location || course.room });
    }
  }
  return candidates.sort((a, b) => a.when.getTime() - b.when.getTime())[0] || null;
}

export default function CourseCommandCenter({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const courses = await apiFetch<{ courses: Course[] }>('/api/courses');
        const found = (courses.courses || []).find(item => String(item.id) === String(courseId)) || null;
        if (!found) return;
        const [workspace, noteData, sessionData, documentData] = await Promise.all([
          apiFetch<Workspace>('/api/tasks/workspace?allTerms=true'),
          apiFetch<{ notes: Note[] }>(`/api/notes?course=${encodeURIComponent(found.title)}&limit=250`),
          apiFetch<{ sessions: Session[] }>('/api/sessions'),
          apiFetch<{ documents: Document[] }>(`/api/courses/${encodeURIComponent(found.id)}/documents`).catch(() => ({ documents: [] })),
        ]);
        if (cancelled) return;
        const courseTasks = (workspace.tasks || []).filter(task => String(task.courseId || '') === String(found.id) || (task.course || '').toLowerCase() === found.title.toLowerCase());
        const ids = new Set(courseTasks.map(task => String(task.id)));
        setCourse(found);
        setTasks(courseTasks);
        setNotes(noteData.notes || []);
        setSessions((sessionData.sessions || []).filter(session => session.taskId && ids.has(String(session.taskId))));
        setDocuments(documentData.documents || []);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [courseId]);

  const openTasks = useMemo(() => tasks.filter(task => !['done','canceled'].includes(task.workflowState || '')), [tasks]);
  const stats = useMemo(() => {
    const readings = tasks.filter(task => task.activity === 'reading');
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
    return {
      open: openTasks.length,
      atRisk: openTasks.filter(task => task.atRisk).length,
      blocked: openTasks.filter(task => task.blocked).length,
      readingsDone: readings.filter(task => task.workflowState === 'done' || Number(task.reading?.percentComplete ?? task.percentComplete) >= 100).length,
      readingsTotal: readings.length,
      study7d: sessions.filter(session => new Date(session.when) >= cutoff).reduce((sum, session) => sum + Math.max(0, Number(session.minutes) || 0), 0),
    };
  }, [tasks, openTasks, sessions]);

  const coverage = useMemo<WeekCoverage[]>(() => {
    const map = new Map<number, WeekCoverage>();
    const get = (week: number) => map.get(week) || { week, classNotes: 0, readingNotes: 0, caseBriefs: 0, readingTasks: 0, readingsDone: 0, outlineNotes: 0 };
    for (const note of notes) {
      const week = weekNumber(`${note.section || ''} ${note.title || ''}`);
      if (!week) continue;
      const row = get(week);
      if (note.sourceType === 'class-notes') row.classNotes += 1;
      else if (note.sourceType === 'reading-notes') row.readingNotes += 1;
      else if (note.sourceType === 'case-brief') row.caseBriefs += 1;
      if (note.sourceType === 'outline' || /outline/i.test(note.title)) row.outlineNotes += 1;
      map.set(week, row);
    }
    for (const task of tasks.filter(item => item.activity === 'reading')) {
      const week = weekNumber(`${task.title} ${(task.tags || []).join(' ')}`);
      if (!week) continue;
      const row = get(week);
      row.readingTasks += 1;
      if (task.workflowState === 'done' || Number(task.reading?.percentComplete ?? task.percentComplete) >= 100) row.readingsDone += 1;
      map.set(week, row);
    }
    return Array.from(map.values()).sort((a,b) => a.week - b.week);
  }, [notes, tasks]);

  const nextTask = useMemo(() => openTasks.slice().sort((a,b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0] || null, [openTasks]);
  const classInfo = useMemo(() => course ? nextClass(course) : null, [course]);
  const majorDeadline = useMemo(() => tasks.filter(task => /(exam|final|midterm|paper|memo|brief|project)/i.test(`${task.title} ${(task.tags || []).join(' ')}`) && task.workflowState !== 'canceled' && task.workflowState !== 'done').sort((a,b) => +new Date(a.dueDate) - +new Date(b.dueDate))[0] || null, [tasks]);
  const outline = useMemo(() => {
    const outlineTasks = tasks.filter(task => task.activity === 'outline' || /outline/i.test(task.title));
    if (!outlineTasks.length) return null;
    const progress = outlineTasks.reduce((sum, task) => sum + Math.max(0, Math.min(100, Number(task.percentComplete) || (task.workflowState === 'done' ? 100 : 0))), 0) / outlineTasks.length;
    const pages = sessions.reduce((sum, session) => sum + Math.max(0, Number(session.outlinePages) || 0), 0);
    return { progress: Math.round(progress), pages };
  }, [tasks, sessions]);
  const syllabus = documents.find(doc => doc.category === 'syllabus') || null;

  if (loading) return <section className="card p-4 mb-5 text-sm text-slate-400">Loading course command center…</section>;
  if (!course) return null;

  return <section className="card p-4 mb-5 space-y-4" aria-label={`${course.title} command center`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-[.12em] text-slate-500">Course command center</div>
        <div className="mt-1 text-lg font-medium">{course.title}</div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          {classInfo ? <span>Next class: {classInfo.when.toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}{classInfo.location ? ` · ${classInfo.location}` : ''}</span> : null}
          {course.instructor ? <span>{course.instructor}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Link href={`/tasks?course=${encodeURIComponent(course.title)}`} className="px-2.5 py-1.5 rounded border border-white/10">Tasks</Link>
        <Link href={`/reading?course=${encodeURIComponent(course.title)}`} className="px-2.5 py-1.5 rounded border border-white/10">Reading</Link>
        <Link href={`/notes?course=${encodeURIComponent(course.title)}`} className="px-2.5 py-1.5 rounded border border-white/10">Notes</Link>
        <Link href={`/calendar?course=${encodeURIComponent(course.title)}`} className="px-2.5 py-1.5 rounded border border-white/10">Calendar</Link>
      </div>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
      <Stat label="Open" value={String(stats.open)} />
      <Stat label="At risk" value={String(stats.atRisk)} warn={stats.atRisk > 0} />
      <Stat label="Blocked" value={String(stats.blocked)} warn={stats.blocked > 0} />
      <Stat label="Readings" value={stats.readingsTotal ? `${stats.readingsDone}/${stats.readingsTotal}` : '—'} />
      <Stat label="Study · 7d" value={fmtMinutes(stats.study7d)} />
      <Stat label="Outline" value={outline ? `${outline.progress}%${outline.pages ? ` · ${outline.pages}p` : ''}` : 'Not started'} warn={!outline} />
    </div>

    <div className="grid gap-3 lg:grid-cols-3">
      <InfoCard title="Next assignment">{nextTask ? <><Link href={`?taskId=${encodeURIComponent(nextTask.id)}`} className="text-sm">{nextTask.title}</Link><div className="mt-1 text-xs text-slate-500">Due {new Date(nextTask.dueDate).toLocaleString()}</div>{nextTask.blocked ? <div className="mt-1 text-xs text-rose-300">Blocked</div> : nextTask.atRisk ? <div className="mt-1 text-xs text-amber-300">At risk</div> : null}</> : <span className="text-xs text-slate-400">No open assignments.</span>}</InfoCard>
      <InfoCard title="Exam / paper">{majorDeadline ? <><Link href={`?taskId=${encodeURIComponent(majorDeadline.id)}`} className="text-sm">{majorDeadline.title}</Link><div className="mt-1 text-xs text-slate-500">{new Date(majorDeadline.dueDate).toLocaleString()}</div></> : <span className="text-xs text-slate-400">No exam or paper deadline is recorded as a task.</span>}</InfoCard>
      <InfoCard title="Course documents">{documents.length ? <div className="space-y-1.5">{syllabus ? <a href={syllabus.url} className="block text-sm" target="_blank" rel="noreferrer">Syllabus · {syllabus.title}</a> : <div className="text-xs text-amber-300">No syllabus tagged</div>}<div className="text-xs text-slate-500">{documents.length} document{documents.length === 1 ? '' : 's'} attached</div></div> : <span className="text-xs text-slate-400">No course documents uploaded.</span>}</InfoCard>
    </div>

    <div>
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">Weekly coverage</h3><span className="text-[11px] text-slate-500">Notes, briefs, reading, outline</span></div>
      {coverage.length ? <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {coverage.map(row => <div key={row.week} className="rounded border border-white/10 p-3">
          <div className="flex items-center justify-between"><div className="text-xs font-medium">Week {row.week}</div><Link href={`/notes?course=${encodeURIComponent(course.title)}`} className="text-[10px] text-slate-500">Open notes</Link></div>
          <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[10px]">
            <Coverage label="Class" complete={row.classNotes > 0} value={row.classNotes ? String(row.classNotes) : '—'} />
            <Coverage label="Reading notes" complete={row.readingNotes > 0} value={row.readingNotes ? String(row.readingNotes) : '—'} />
            <Coverage label="Briefs" complete={row.caseBriefs > 0} value={row.caseBriefs ? String(row.caseBriefs) : '—'} />
            <Coverage label="Reading" complete={row.readingTasks > 0 && row.readingsDone === row.readingTasks} value={row.readingTasks ? `${row.readingsDone}/${row.readingTasks}` : '—'} />
            <Coverage label="Outline" complete={row.outlineNotes > 0} value={row.outlineNotes ? '✓' : '—'} />
          </div>
        </div>)}
      </div> : <div className="mt-2 text-xs text-slate-400">Coverage will populate as weekly notes, case briefs, readings, and outline work are filed.</div>}
    </div>
  </section>;
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <div className={`rounded border p-3 ${warn ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/10'}`}><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className={`mt-1 text-lg ${warn ? 'text-amber-200' : ''}`}>{value}</div></div>;
}
function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded border border-white/10 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">{title}</div>{children}</div>;
}
function Coverage({ label, complete, value }: { label: string; complete: boolean; value: string }) {
  return <div className="rounded bg-white/5 p-1.5"><div className={complete ? 'text-emerald-300' : 'text-slate-600'}>{value}</div><div className="text-slate-500 mt-0.5 leading-tight">{label}</div></div>;
}
