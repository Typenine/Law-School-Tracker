"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { assignmentMilestones, compareSyllabusVersions } from '@/lib/academicWorkflow';
import { apiFetch } from '@/lib/apiClient';
import type { StoredSyllabusAnalysis, StoredSyllabusItem, SyllabusChangeSummary } from '@/lib/courseWorkspace';
import { tasksClient } from '@/lib/tasksClient';
import type { Course, Task } from '@/lib/types';
import type { WizardPreview } from '@/lib/wizard_types';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';

interface ImportItem {
  id: string;
  sourceKey: string;
  selected: boolean;
  kind: 'task' | 'event';
  title: string;
  dueDate: string;
  activity: string;
  estimatedMinutes?: number | null;
  notes?: string;
  tags?: string[];
  confidence?: number;
}

function meetingTime(course?: Course | null) {
  return course?.meetingStart || course?.meetingBlocks?.[0]?.start || '09:00';
}

function itemsFromPreview(preview: WizardPreview, course?: Course | null): ImportItem[] {
  const result: ImportItem[] = [];
  for (const session of preview.sessions || []) {
    if (session.canceled) {
      const sourceKey = `event:${session.date}:${session.source_ref || result.length}`;
      result.push({ sourceKey, id: sourceKey, selected: true, kind: 'event', title: `No class: ${course?.title || preview.course?.title || 'Course'}`, dueDate: `${session.date}T00:00:00`, activity: 'calendar', notes: session.source_text || session.notes || 'No class date imported from syllabus.', tags: ['syllabus-import', 'no-class'], confidence: session.confidence });
    }
    session.readings.forEach((reading, index) => {
      const sourceKey = `reading:${session.date}:${reading.source_ref || index}`;
      result.push({ sourceKey, id: sourceKey, selected: reading.priority !== 'optional', kind: 'task', title: `Read: ${[reading.short_title, reading.pages].filter(Boolean).join(' ')}`, dueDate: `${session.date}T${meetingTime(course)}:00`, activity: 'reading', estimatedMinutes: reading.estimated_minutes, notes: [reading.priority === 'skim' ? 'Strategic skim.' : reading.priority === 'optional' ? 'Optional reading.' : null, reading.source_text].filter(Boolean).join('\n'), tags: ['syllabus-import', reading.priority, reading.source_type], confidence: reading.confidence });
    });
    session.assignments_due.forEach((assignment, index) => {
      const sourceKey = `assignment:${session.date}:${assignment.source_ref || index}`;
      result.push({ sourceKey, id: sourceKey, selected: true, kind: 'task', title: assignment.title, dueDate: assignment.due_datetime, activity: assignment.type === 'exam' ? 'practice' : assignment.type === 'reading' ? 'reading' : 'other', estimatedMinutes: assignment.estimated_minutes, notes: assignment.source_text, tags: ['syllabus-import', assignment.type], confidence: assignment.confidence });
    });
  }
  return result;
}

function storedItems(items: ImportItem[]): StoredSyllabusItem[] {
  return items.map(item => ({ sourceKey: item.sourceKey, kind: item.kind, title: item.title, dueDate: item.dueDate, activity: item.activity, selected: item.selected, notes: item.notes, tags: item.tags }));
}

function sourceTag(sourceKey: string) {
  return `syllabus-source:${encodeURIComponent(sourceKey)}`;
}
function sourceFromTask(task: Task) {
  const tag = (task.tags || []).find(item => item.startsWith('syllabus-source:'));
  return tag ? decodeURIComponent(tag.slice('syllabus-source:'.length)) : '';
}
function eventToken(sourceKey: string) {
  return `[syllabus-source:${sourceKey}]`;
}
function majorAssignment(item: ImportItem) {
  return item.tags?.some(tag => ['memo','brief','paper','presentation'].includes(tag)) || /(memo|brief|paper|essay|presentation|oral argument|project)/i.test(item.title);
}

function SectionList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p><ul className="mt-2 space-y-1 text-sm text-slate-300">{items.slice(0, 12).map((item, index) => <li key={`${title}:${index}`}>• {item}</li>)}</ul></div>;
}

export default function SyllabusImportPage() {
  const { courses, refresh: refreshCourses } = useCourses();
  const { tasks, refresh } = useTasks();
  const { activeSemester, currentTerm } = useSemester();
  const [file, setFile] = useState<File | null>(null);
  const [courseId, setCourseId] = useState('');
  const [timezone, setTimezone] = useState('America/Chicago');
  const [minutesPerPage, setMinutesPerPage] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<WizardPreview | null>(null);
  const [fileInfo, setFileInfo] = useState<any>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [previousAnalysis, setPreviousAnalysis] = useState<StoredSyllabusAnalysis | undefined>();
  const [diff, setDiff] = useState<SyllabusChangeSummary | null>(null);

  const activeCourses = useMemo(() => courses.filter(course => !activeSemester || (course.semester === activeSemester.season && course.year === activeSemester.year)), [courses, activeSemester]);
  const selectedCourse = activeCourses.find(course => course.id === courseId) || null;
  const selectedCount = items.filter(item => item.selected).length;

  function buildAnalysis(currentItems = items): StoredSyllabusAnalysis {
    return {
      id: `syllabus:${courseId}:${Date.now()}`,
      importedAt: new Date().toISOString(),
      fileName: fileInfo?.name || file?.name || null,
      pageCount: fileInfo?.pageCount || null,
      diagnostics: preview?.diagnostics || {},
      course: preview?.course || null,
      sections: preview?.sections || {},
      unassignedImportantLines: preview?.unassignedImportantLines || [],
      lowConfidence: preview?.lowConfidence || [],
      sessionSummary: (preview?.sessions || []).map(session => ({ date: session.date, topic: session.topic, canceled: session.canceled, readingCount: session.readings.length, assignmentCount: session.assignments_due.length, sourceText: session.source_text })),
      importItems: storedItems(currentItems),
    };
  }

  async function upload() {
    if (!file || !selectedCourse) return;
    setLoading(true); setError(''); setMessage(''); setPreview(null); setItems([]); setDiff(null);
    try {
      const form = new FormData();
      form.append('file', file); form.append('course', selectedCourse.title); form.append('timezone', timezone); form.append('minutesPerPage', String(minutesPerPage)); form.append('referenceDate', selectedCourse.startDate?.slice(0, 10) || activeSemester?.startDate || '');
      const response = await fetch('/api/wizard/preview', { method: 'POST', body: form });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const nextItems = itemsFromPreview(data.preview, selectedCourse);
      setPreview(data.preview); setFileInfo(data.file || null); setItems(nextItems);
      const history = await apiFetch<{ analysis?: StoredSyllabusAnalysis }>(`/api/courses/${selectedCourse.id}/syllabus`).catch(() => ({}));
      setPreviousAnalysis(history.analysis);
      const candidate: StoredSyllabusAnalysis = { id: `preview:${Date.now()}`, importedAt: new Date().toISOString(), importItems: storedItems(nextItems) };
      setDiff(history.analysis ? compareSyllabusVersions(history.analysis, candidate) : null);
      if (data.preview.diagnostics?.likelyScannedDocument) setError('Very little selectable text was found. This file may be scanned and needs OCR before reliable import.');
    } catch (cause: any) { setError(cause?.message || 'Syllabus upload failed.'); }
    finally { setLoading(false); }
  }

  function updateItem(id: string, patch: Partial<ImportItem>) {
    setItems(previous => {
      const next = previous.map(item => item.id === id ? { ...item, ...patch } : item);
      if (previousAnalysis) setDiff(compareSyllabusVersions(previousAnalysis, { id: `preview:${Date.now()}`, importedAt: new Date().toISOString(), importItems: storedItems(next) }));
      return next;
    });
  }

  async function applyCourseDetails() {
    if (!selectedCourse || !preview?.course) return;
    const detected = preview.course; setLoading(true);
    try {
      await apiFetch(`/api/courses/${selectedCourse.id}`, { method: 'PATCH', body: { code: detected.code || selectedCourse.code || null, instructor: detected.professor || selectedCourse.instructor || null, instructorEmail: detected.professor_email || selectedCourse.instructorEmail || null, location: detected.location || selectedCourse.location || null, meetingDays: detected.meeting_days || selectedCourse.meetingDays || null, meetingStart: detected.meeting_time || selectedCourse.meetingStart || null, meetingEnd: detected.meeting_end_time || selectedCourse.meetingEnd || null, startDate: detected.start_date || selectedCourse.startDate || null, endDate: detected.end_date || selectedCourse.endDate || null } });
      setMessage('Detected course details applied.'); await refreshCourses();
    } catch (cause: any) { setError(cause?.message || 'Course details could not be updated.'); }
    finally { setLoading(false); }
  }

  async function saveSelected() {
    if (!selectedCourse || !currentTerm || !preview) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const existingBySource = new Map(tasks.filter(task => (task.course || '').toLowerCase() === selectedCourse.title.toLowerCase()).map(task => [sourceFromTask(task), task]).filter(([source]) => source));
      const eventResponse = await apiFetch<{ events: any[] }>('/api/events').catch(() => ({ events: [] }));
      const events = eventResponse.events || [];
      let created = 0, updated = 0, archived = 0, eventChanges = 0, milestones = 0;

      for (const item of items.filter(candidate => candidate.selected)) {
        if (item.kind === 'event') {
          const token = eventToken(item.sourceKey);
          const existing = events.find(event => String(event.description || '').includes(token));
          const body = { title: item.title, description: `${item.notes || ''}\n${token}`.trim(), category: 'school', date: item.dueDate.slice(0, 10), allDay: true, course: selectedCourse.title };
          if (existing) await apiFetch(`/api/events/${existing.id}`, { method: 'PATCH', body });
          else await apiFetch('/api/events', { method: 'POST', body });
          eventChanges++;
          continue;
        }

        const tags = Array.from(new Set([...(item.tags || []), sourceTag(item.sourceKey)]));
        const existing = existingBySource.get(item.sourceKey);
        let parent: Task;
        if (existing) {
          parent = await tasksClient.update(existing.id, { title: item.title, dueDate: new Date(item.dueDate).toISOString(), activity: item.activity, estimatedMinutes: item.estimatedMinutes || null, notes: item.notes || null, tags, status: existing.tags?.includes('syllabus-removed') ? 'todo' : existing.status }, { silent: true });
          updated++;
        } else {
          parent = await tasksClient.create({ title: item.title, course: selectedCourse.title, dueDate: new Date(item.dueDate).toISOString(), status: 'todo', term: currentTerm, activity: item.activity, estimatedMinutes: item.estimatedMinutes || null, estimateOrigin: item.estimatedMinutes ? 'manual' : null, notes: item.notes || null, tags }, { silent: true });
          created++;
        }
        if (majorAssignment(item) && !parent.tags?.includes('assignment-plan-created')) {
          for (const milestone of assignmentMilestones(item.title, item.dueDate, item.tags?.join(' '))) {
            await tasksClient.create({ title: milestone.title, course: selectedCourse.title, dueDate: milestone.dueDate, status: 'todo', term: currentTerm, activity: milestone.activity, estimatedMinutes: milestone.estimatedMinutes, dependsOn: parent.id, tags: ['assignment-plan', `assignment-parent:${parent.id}`, milestone.tag] }, { silent: true });
            milestones++;
          }
          await tasksClient.update(parent.id, { tags: Array.from(new Set([...(parent.tags || tags), 'assignment-plan-created'])) }, { silent: true });
        }
      }

      for (const removed of diff?.removed || []) {
        if (removed.kind === 'event') {
          const token = eventToken(removed.sourceKey);
          const existing = events.find(event => String(event.description || '').includes(token));
          if (existing) { await apiFetch(`/api/events/${existing.id}`, { method: 'DELETE' }); eventChanges++; }
        } else {
          const existing = existingBySource.get(removed.sourceKey);
          if (existing && existing.status !== 'done') {
            await tasksClient.update(existing.id, { status: 'done', completedAt: new Date().toISOString(), tags: Array.from(new Set([...(existing.tags || []), 'syllabus-removed'])) }, { silent: true });
            archived++;
          }
        }
      }

      const analysis = buildAnalysis();
      const response = await apiFetch<{ diff: SyllabusChangeSummary }>(`/api/courses/${selectedCourse.id}/syllabus`, { method: 'PUT', body: { analysis } });
      setDiff(response.diff || null);
      setMessage(`Approved syllabus version: ${created} tasks created, ${updated} updated, ${archived} removed items archived, ${eventChanges} calendar changes, and ${milestones} assignment milestones created.`);
      await refresh();
    } catch (cause: any) { setError(cause?.message || 'The approved syllabus changes could not be saved.'); }
    finally { setLoading(false); }
  }

  return <main className="space-y-6">
    <section className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/30 to-slate-950 p-6"><p className="text-sm font-medium text-emerald-300">Semester setup</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Extract, compare, and approve the entire syllabus</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Replacement syllabi are compared with the prior version. Existing imported work is updated by source identity, removed work is archived only after approval, and major assignments receive milestone plans.</p></section>
    {error ? <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}

    <section className="rounded-xl border border-slate-700 bg-slate-900/45 p-5"><div className="grid gap-4 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.2fr)_190px_150px_auto] lg:items-end"><label className="text-sm text-slate-300">Course<select value={courseId} onChange={event => setCourseId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100"><option value="">Select a course</option>{activeCourses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label><label className="text-sm text-slate-300">Syllabus file<input type="file" accept=".pdf,.docx,.txt,.md,.csv" onChange={event => setFile(event.target.files?.[0] || null)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-300" /></label><label className="text-sm text-slate-300">Timezone<input value={timezone} onChange={event => setTimezone(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100" /></label><label className="text-sm text-slate-300">Minutes per page<input type="number" min={0.5} max={10} step={0.25} value={minutesPerPage} onChange={event => setMinutesPerPage(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-slate-100" /></label><button disabled={!file || !selectedCourse || loading} onClick={upload} className="rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">{loading ? 'Extracting…' : 'Extract syllabus'}</button></div>{!activeCourses.length ? <p className="mt-4 text-sm text-amber-300">Add an active-semester course first. <Link href="/courses" className="underline">Open Courses</Link></p> : null}</section>

    {preview ? <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">File</p><p className="mt-2 text-sm font-semibold text-slate-100">{fileInfo?.pageCount ? `${fileInfo.pageCount} pages` : fileInfo?.name || 'Document'}</p></div>{[['Sessions',preview.diagnostics?.sessions || 0],['Readings',preview.diagnostics?.readings || 0],['Assignments',preview.diagnostics?.tasks || 0],['No-class dates',preview.diagnostics?.canceledSessions || 0],['Needs review',preview.lowConfidence?.length || 0]].map(([label,value]) => <div key={String(label)} className="rounded-xl border border-slate-700 bg-slate-900/45 p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p></div>)}</section>

      {previousAnalysis && diff ? <section className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-5"><div><p className="text-sm font-medium text-violet-300">Replacement syllabus comparison</p><h2 className="mt-1 font-semibold text-slate-100">Review changes before updating existing work</h2></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-2xl font-semibold text-emerald-300">{diff.added.length}</p><p className="text-xs text-slate-500">Added</p></div><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-2xl font-semibold text-amber-300">{diff.changed.length}</p><p className="text-xs text-slate-500">Changed</p></div><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-2xl font-semibold text-rose-300">{diff.removed.length}</p><p className="text-xs text-slate-500">Removed</p></div><div className="rounded-lg bg-slate-950/40 p-3"><p className="text-2xl font-semibold text-slate-200">{diff.unchanged}</p><p className="text-xs text-slate-500">Unchanged</p></div></div><details className="mt-4"><summary className="cursor-pointer text-sm text-violet-300">View detailed changes</summary><div className="mt-3 grid gap-3 lg:grid-cols-3"><div><p className="text-xs uppercase text-emerald-300">Added</p>{diff.added.map(item => <p key={item.sourceKey} className="mt-2 text-sm text-slate-300">+ {item.title} · {item.dueDate.slice(0,10)}</p>)}</div><div><p className="text-xs uppercase text-amber-300">Changed</p>{diff.changed.map(item => <p key={item.after.sourceKey} className="mt-2 text-sm text-slate-300">{item.before.title} → {item.after.title}<br /><span className="text-xs text-slate-500">{item.before.dueDate.slice(0,10)} → {item.after.dueDate.slice(0,10)}</span></p>)}</div><div><p className="text-xs uppercase text-rose-300">Removed</p>{diff.removed.map(item => <p key={item.sourceKey} className="mt-2 text-sm text-slate-300">− {item.title}</p>)}</div></div></details></section> : null}

      <section className="rounded-xl border border-slate-700 bg-slate-900/45 p-5"><div className="flex items-end justify-between"><div><h2 className="font-semibold text-slate-100">Detected course information</h2><p className="mt-1 text-sm text-slate-400">Apply only after checking the header.</p></div><button disabled={loading || !preview.course} onClick={applyCourseDetails} className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm text-emerald-300">Apply course details</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Course',preview.course?.title],['Code',preview.course?.code],['Professor',preview.course?.professor],['Email',preview.course?.professor_email],['Office hours',preview.course?.office_hours],['Location',preview.course?.location],['Meeting time',[preview.course?.meeting_time,preview.course?.meeting_end_time].filter(Boolean).join('–')],['Term dates',[preview.course?.start_date,preview.course?.end_date].filter(Boolean).join(' to ')]].map(([label,value]) => <div key={String(label)} className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 text-sm text-slate-200">{value || 'Not detected'}</p></div>)}</div></section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/45 p-5"><h2 className="font-semibold text-slate-100">Document sections</h2><div className="mt-4 grid gap-3 lg:grid-cols-2"><SectionList title="Required materials" items={preview.sections?.required_materials} /><SectionList title="Grading" items={preview.sections?.grading_components} /><SectionList title="Office hours" items={preview.sections?.office_hours} /><SectionList title="Major assessments" items={preview.sections?.major_assessments} /><SectionList title="Policies" items={preview.sections?.policies} /><SectionList title="Holidays and breaks" items={preview.sections?.holidays_and_breaks} /></div></section>

      {preview.unassignedImportantLines?.length ? <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"><h2 className="font-semibold text-amber-200">Important lines that could not be placed</h2><div className="mt-3 space-y-2">{preview.unassignedImportantLines.map((line,index) => <div key={`${line.source_ref}:${index}`} className="rounded-lg bg-slate-950/40 p-3"><p className="text-sm text-slate-200">{line.text}</p><p className="mt-1 text-xs text-amber-300/70">{line.reason}</p></div>)}</div></section> : null}

      <section className="rounded-xl border border-slate-700 bg-slate-900/45 p-5"><div className="flex items-end justify-between"><div><h2 className="font-semibold text-slate-100">Review import items</h2><p className="mt-1 text-sm text-slate-400">Optional readings begin unchecked. Edit before approval.</p></div><span className="text-sm text-slate-400">{selectedCount} of {items.length} selected</span></div><div className="mt-4 space-y-2">{items.map(item => <article key={item.id} className={`rounded-xl border p-4 ${item.selected ? 'border-slate-700 bg-slate-950/40' : 'border-slate-800 opacity-55'}`}><div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_190px_110px]"><input type="checkbox" checked={item.selected} onChange={event => updateItem(item.id,{ selected:event.target.checked })} className="mt-3" /><div><input value={item.title} onChange={event => updateItem(item.id,{ title:event.target.value })} className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100" /><p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.notes || 'No source note'}</p></div><input type={item.kind === 'event' ? 'date' : 'datetime-local'} value={item.kind === 'event' ? item.dueDate.slice(0,10) : item.dueDate.slice(0,16)} onChange={event => updateItem(item.id,{ dueDate:item.kind === 'event' ? `${event.target.value}T00:00:00` : event.target.value })} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100" /><div className="flex items-center justify-between"><span className="rounded-full bg-slate-800 px-2 py-1 text-xs capitalize text-slate-300">{item.kind === 'event' ? 'no class' : item.activity}</span><span className={`text-xs ${(item.confidence || 0) < 0.8 ? 'text-amber-300' : 'text-slate-500'}`}>{Math.round((item.confidence || 0) * 100)}%</span></div></div></article>)}{!items.length ? <p className="py-6 text-center text-sm text-slate-500">No dated work was extracted.</p> : null}</div><div className="mt-5 flex items-center justify-between gap-3"><p className="text-sm text-slate-400">Approval updates prior imports, archives removed items, and stores the version history.</p><button disabled={loading || !selectedCount || !currentTerm} onClick={saveSelected} className="rounded-lg bg-emerald-500 px-5 py-2.5 font-semibold text-slate-950 disabled:opacity-50">Approve and apply {selectedCount} items</button></div></section>
    </> : null}
  </main>;
}
