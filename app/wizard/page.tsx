"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Course } from '@/lib/types';
import type { Session, WizardPreview } from '@/lib/wizard_types';
import { useCourses } from '@/lib/useCourses';
import { useTasks } from '@/lib/useTasks';
import { useSemester } from '@/lib/useSemester';
import { tasksClient } from '@/lib/tasksClient';

interface ImportItem {
  id: string;
  selected: boolean;
  type: 'reading' | 'assignment';
  title: string;
  dueDate: string;
  activity: string;
  notes?: string;
  confidence?: number;
}

function firstMeetingTime(course?: Course | null): string {
  if (!course) return '09:00';
  if (course.meetingStart) return course.meetingStart;
  if (Array.isArray(course.meetingBlocks) && course.meetingBlocks[0]?.start) return course.meetingBlocks[0].start;
  return '09:00';
}

function buildItems(preview: WizardPreview, course?: Course | null): ImportItem[] {
  const result: ImportItem[] = [];
  const meetingTime = firstMeetingTime(course);
  for (const session of preview.sessions || []) {
    for (let index = 0; index < (session.readings || []).length; index++) {
      const reading = session.readings[index];
      const titleParts = [reading.short_title || 'Assigned reading', reading.pages ? `(${reading.pages})` : ''].filter(Boolean);
      result.push({
        id: `reading:${session.date}:${index}:${reading.source_ref || ''}`,
        selected: reading.priority !== 'optional',
        type: 'reading',
        title: `Read: ${titleParts.join(' ')}`,
        dueDate: `${session.date}T${meetingTime}:00`,
        activity: 'reading',
        notes: reading.priority === 'skim' ? 'Syllabus marks this reading as skim.' : reading.priority === 'optional' ? 'Optional reading from syllabus.' : undefined,
        confidence: reading.confidence,
      });
    }
    for (let index = 0; index < (session.assignments_due || []).length; index++) {
      const assignment = session.assignments_due[index];
      result.push({
        id: `assignment:${session.date}:${index}:${assignment.source_ref || ''}`,
        selected: true,
        type: 'assignment',
        title: assignment.title,
        dueDate: assignment.due_datetime,
        activity: assignment.type === 'exam' ? 'practice' : assignment.type === 'reading' ? 'reading' : 'other',
        confidence: assignment.confidence,
      });
    }
  }
  return result;
}

export default function SyllabusImportPage() {
  const { courses } = useCourses();
  const { tasks, refresh } = useTasks();
  const { activeSemester, currentTerm } = useSemester();
  const [file, setFile] = useState<File | null>(null);
  const [courseId, setCourseId] = useState('');
  const [timezone, setTimezone] = useState('America/Chicago');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [dateCol, setDateCol] = useState(0);
  const [topicCol, setTopicCol] = useState(1);
  const [readingsCol, setReadingsCol] = useState(1);
  const [assignmentsCol, setAssignmentsCol] = useState(1);
  const [mapped, setMapped] = useState<WizardPreview | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const activeCourses = useMemo(() => courses.filter((course) => !activeSemester || (course.semester === activeSemester.season && course.year === activeSemester.year)), [courses, activeSemester]);
  const selectedCourse = activeCourses.find((course) => course.id === courseId) || null;
  const rows: string[][] = useMemo(() => (previewData?.tables || []).flatMap((table: any) => table?.rows || []), [previewData]);
  const sample = rows.slice(0, 10);
  const maxCols = sample.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const selectedCount = items.filter((item) => item.selected).length;

  useEffect(() => {
    if (!courseId && activeCourses.length === 1) setCourseId(activeCourses[0].id);
  }, [activeCourses, courseId]);

  async function upload() {
    if (!file || !selectedCourse) return;
    setLoading(true);
    setError('');
    setPreviewData(null);
    setMapped(null);
    setItems([]);
    setSavedCount(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('course', selectedCourse.title);
      form.append('timezone', timezone);
      const response = await fetch('/api/wizard/preview', { method: 'POST', body: form });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setPreviewData(data);
      const columns = (data?.tables || []).flatMap((table: any) => table?.rows || []).slice(0, 10).reduce((maximum: number, row: string[]) => Math.max(maximum, row.length), 0);
      setDateCol(0);
      setTopicCol(Math.max(0, columns - 1));
      setReadingsCol(Math.max(0, columns - 1));
      setAssignmentsCol(Math.max(0, columns - 1));
    } catch (cause: any) {
      setError(cause?.message || 'Syllabus upload failed.');
    } finally {
      setLoading(false);
    }
  }

  async function applyMapping() {
    if (!selectedCourse || !rows.length) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/wizard/map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows,
          mapping: { dateCol, topicCol, readingsCol, assignmentsCol },
          timezone,
          courseStart: selectedCourse.startDate || activeSemester?.startDate || null,
          courseEnd: selectedCourse.endDate || activeSemester?.endDate || null,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const nextPreview = data.preview as WizardPreview;
      setMapped(nextPreview);
      setItems(buildItems(nextPreview, selectedCourse));
    } catch (cause: any) {
      setError(cause?.message || 'Could not map syllabus rows.');
    } finally {
      setLoading(false);
    }
  }

  function updateItem(id: string, patch: Partial<ImportItem>) {
    setItems((previous) => previous.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function saveTasks() {
    if (!selectedCourse || !currentTerm) return;
    setLoading(true);
    setError('');
    setSavedCount(null);
    try {
      const existing = new Set(tasks.map((task) => `${(task.course || '').toLowerCase()}|${task.title.toLowerCase()}|${task.dueDate.slice(0, 10)}`));
      let created = 0;
      for (const item of items.filter((candidate) => candidate.selected)) {
        const key = `${selectedCourse.title.toLowerCase()}|${item.title.toLowerCase()}|${item.dueDate.slice(0, 10)}`;
        if (existing.has(key)) continue;
        await tasksClient.create({
          title: item.title,
          course: selectedCourse.title,
          dueDate: new Date(item.dueDate).toISOString(),
          status: 'todo',
          term: currentTerm,
          activity: item.activity,
          notes: item.notes || null,
          tags: item.type === 'reading' && item.notes?.toLowerCase().includes('optional') ? ['optional'] : null,
        }, { silent: true });
        existing.add(key);
        created++;
      }
      setSavedCount(created);
      await refresh();
    } catch (cause: any) {
      setError(cause?.message || 'Could not save imported assignments.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="space-y-6">
      <section className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/30 to-slate-950 p-6">
        <p className="text-sm font-medium text-emerald-300">Semester setup</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-100">Import a syllabus into usable work</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Upload a PDF, DOCX, or text syllabus. Review the extracted readings and deadlines before anything is saved.</p>
      </section>

      {error ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}
      {savedCount !== null ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">Created {savedCount} new task{savedCount === 1 ? '' : 's'}. Existing duplicates were skipped.</div> : null}

      <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)_220px_auto] lg:items-end">
          <label className="space-y-1.5 text-sm text-slate-300"><span>Course</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100"><option value="">Select a course</option>{activeCourses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
          <label className="space-y-1.5 text-sm text-slate-300"><span>Syllabus file</span><input type="file" accept=".pdf,.docx,.txt" onChange={(event) => setFile(event.target.files?.[0] || null)} className="block w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-sm text-slate-300" /></label>
          <label className="space-y-1.5 text-sm text-slate-300"><span>Timezone</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-slate-100" /></label>
          <button disabled={!file || !selectedCourse || loading} onClick={upload} className="rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">{loading ? 'Working…' : 'Read syllabus'}</button>
        </div>
        {!activeCourses.length ? <p className="mt-4 text-sm text-amber-300">Add a course for {activeSemester?.name || 'the active semester'} before importing its syllabus. <Link href="/courses" className="underline">Open courses</Link></p> : null}
      </section>

      {previewData ? (
        <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
          <div><h2 className="font-semibold text-slate-100">Confirm the syllabus columns</h2><p className="mt-1 text-sm text-slate-400">Choose which extracted columns contain dates, topics, readings, and assignments. Most PDF syllabi use column 0 for dates and the last column for the remaining content.</p></div>
          {sample.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><tbody>{sample.map((row, rowIndex) => <tr key={rowIndex} className="border-t border-slate-700">{Array.from({ length: maxCols }, (_, columnIndex) => <td key={columnIndex} className="px-3 py-2 align-top text-slate-300"><span className="mb-1 block text-[10px] uppercase text-slate-600">Column {columnIndex}</span>{row[columnIndex] || ''}</td>)}</tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-amber-300">No table-like rows were detected. A DOCX or text version of the syllabus may import more cleanly.</p>}
          <div className="mt-4 flex flex-wrap items-end gap-3">{[
            ['Date', dateCol, setDateCol],
            ['Topic', topicCol, setTopicCol],
            ['Readings', readingsCol, setReadingsCol],
            ['Assignments', assignmentsCol, setAssignmentsCol],
          ].map(([label, value, setter]: any) => <label key={label} className="text-sm text-slate-300"><span className="block text-xs text-slate-500">{label}</span><select value={value} onChange={(event) => setter(Number(event.target.value))} className="mt-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100">{Array.from({ length: maxCols }, (_, index) => <option key={index} value={index}>Column {index}</option>)}</select></label>)}<button disabled={loading || !rows.length} onClick={applyMapping} className="rounded-lg bg-sky-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">Build review list</button></div>
        </section>
      ) : null}

      {mapped ? (
        <section className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-semibold text-slate-100">Review before saving</h2><p className="mt-1 text-sm text-slate-400">Edit titles and dates, remove false matches, and keep optional readings unchecked.</p></div><div className="text-sm text-slate-400">{selectedCount} of {items.length} selected · {mapped.lowConfidence?.length || 0} low-confidence matches</div></div>
          <div className="mt-4 space-y-2">
            {items.map((item) => <article key={item.id} className={`rounded-xl border p-4 ${item.selected ? 'border-slate-700 bg-slate-950/40' : 'border-slate-800 bg-slate-950/20 opacity-60'}`}><div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_180px_120px]"><input type="checkbox" checked={item.selected} onChange={(event) => updateItem(item.id, { selected: event.target.checked })} className="mt-3" /><div><input value={item.title} onChange={(event) => updateItem(item.id, { title: event.target.value })} className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100" />{item.notes ? <p className="mt-1 text-xs text-slate-500">{item.notes}</p> : null}</div><input type="datetime-local" value={item.dueDate.slice(0, 16)} onChange={(event) => updateItem(item.id, { dueDate: event.target.value })} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100" /><div className="flex items-center justify-between gap-2"><span className="rounded-full bg-slate-700/60 px-2 py-1 text-xs capitalize text-slate-300">{item.type}</span><span className={`text-xs ${(item.confidence ?? 1) < 0.8 ? 'text-amber-300' : 'text-slate-500'}`}>{Math.round((item.confidence ?? 1) * 100)}%</span></div></div></article>)}
            {!items.length ? <p className="py-6 text-center text-sm text-slate-500">No readings or assignments were detected. Adjust the column mapping or use a cleaner source file.</p> : null}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-400">Tasks will be assigned to {selectedCourse?.title} in {activeSemester?.name || 'the active semester'}.</p><button disabled={loading || !selectedCount || !currentTerm} onClick={saveTasks} className="rounded-lg bg-emerald-500 px-5 py-2.5 font-semibold text-slate-950 disabled:opacity-50">Save {selectedCount} tasks</button></div>
        </section>
      ) : null}
    </main>
  );
}
