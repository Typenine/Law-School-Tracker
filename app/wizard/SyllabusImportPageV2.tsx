"use client";

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { assignmentMilestones } from '@/lib/assignmentPlanning';
import { apiFetch } from '@/lib/apiClient';
import type { StoredSyllabusAnalysis, SyllabusChangeSummary } from '@/lib/courseWorkspace';
import { compareSyllabusVersions } from '@/lib/syllabusCompare';
import {
  clearSyllabusProgress,
  findTaskForImport,
  isMajorAssignment,
  itemsFromPreview,
  loadSyllabusProgress,
  saveSyllabusProgress,
  storedItems,
  syllabusApplySignature,
  syllabusEventToken,
  syllabusSourceTag,
  type ImportItem,
} from '@/lib/syllabusImportPlan';
import { syllabusSourceFromTags, taskMatchesCourse } from '@/lib/taskMetadata';
import { tasksClient } from '@/lib/tasksClient';
import type { Course, Task } from '@/lib/types';
import type { WizardPreview } from '@/lib/wizard_types';
import { useCourses } from '@/lib/useCourses';
import { useSemester } from '@/lib/useSemester';
import { useTasks } from '@/lib/useTasks';

function SectionList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <div className="rounded-lg bg-slate-950/40 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p><ul className="mt-2 space-y-1 text-sm text-slate-300">{items.slice(0, 12).map((item, index) => <li key={`${title}:${index}`}>• {item}</li>)}</ul></div>;
}

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function SyllabusImportPageV2() {
  const { courses, refresh: refreshCourses } = useCourses();
  const { tasks, refresh } = useTasks();
  const { activeSemester, currentTerm } = useSemester();
  const [file, setFile] = useState<File | null>(null);
  const [courseId, setCourseId] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [minutesPerPage, setMinutesPerPage] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<WizardPreview | null>(null);
  const [fileInfo, setFileInfo] = useState<any>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [previousAnalysis, setPreviousAnalysis] = useState<StoredSyllabusAnalysis | undefined>();
  const [diff, setDiff] = useState<SyllabusChangeSummary | null>(null);
  const [analysisId, setAnalysisId] = useState('');
  const [applyProgress, setApplyProgress] = useState({ completed: 0, total: 0 });

  useEffect(() => { setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); }, []);

  const activeCourses = useMemo(() => courses.filter(course => !activeSemester || (course.semester === activeSemester.season && course.year === activeSemester.year)), [courses, activeSemester]);
  const selectedCourse = activeCourses.find(course => course.id === courseId) || null;
  const selectedCount = items.filter(item => item.selected).length;

  function buildAnalysis(): StoredSyllabusAnalysis {
    return {
      id: analysisId || `syllabus:${courseId}:${Date.now()}`,
      importedAt: new Date().toISOString(),
      fileName: fileInfo?.name || file?.name || null,
      pageCount: fileInfo?.pageCount || null,
      diagnostics: preview?.diagnostics || {},
      course: preview?.course || null,
      sections: preview?.sections || {},
      unassignedImportantLines: preview?.unassignedImportantLines || [],
      lowConfidence: preview?.lowConfidence || [],
      sessionSummary: (preview?.sessions || []).map(session => ({ date: session.date, topic: session.topic, canceled: session.canceled, readingCount: session.readings.length, assignmentCount: session.assignments_due.length, sourceText: session.source_text })),
      importItems: storedItems(items),
    };
  }

  function updateItem(id: string, patch: Partial<ImportItem>) {
    setItems(previous => {
      const next = previous.map(item => item.id === id ? { ...item, ...patch } : item);
      if (previousAnalysis) setDiff(compareSyllabusVersions(previousAnalysis, { id: analysisId || `preview:${Date.now()}`, importedAt: new Date().toISOString(), importItems: storedItems(next) }));
      return next;
    });
  }

  async function upload() {
    if (!file || !selectedCourse) return;
    setLoading(true); setError(''); setMessage(''); setPreview(null); setItems([]); setDiff(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('course', selectedCourse.title);
      form.append('timezone', timezone);
      form.append('minutesPerPage', String(minutesPerPage));
      form.append('referenceDate', selectedCourse.startDate?.slice(0, 10) || activeSemester?.startDate || '');
      const response = await fetch('/api/wizard/preview', { method: 'POST', body: form });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const nextItems = itemsFromPreview(data.preview, selectedCourse);
      const nextAnalysisId = `syllabus:${selectedCourse.id}:${Date.now()}`;
      setPreview(data.preview); setFileInfo(data.file || null); setItems(nextItems); setAnalysisId(nextAnalysisId);
      let prior: StoredSyllabusAnalysis | undefined;
      try {
        const history = await apiFetch<{ analysis?: StoredSyllabusAnalysis }>(`/api/courses/${selectedCourse.id}/syllabus`);
        prior = history.analysis;
      } catch {}
      setPreviousAnalysis(prior);
      const candidate: StoredSyllabusAnalysis = { id: nextAnalysisId, importedAt: new Date().toISOString(), importItems: storedItems(nextItems) };
      setDiff(prior ? compareSyllabusVersions(prior, candidate) : null);
      const signature = syllabusApplySignature(selectedCourse.id, data.file?.name || file.name, nextItems);
      const saved = loadSyllabusProgress(selectedCourse.id, signature);
      if (saved.completed.length) setMessage(`A previous approval stopped after ${saved.completed.length} operations. Approving again will safely resume it.`);
      if (data.preview.diagnostics?.likelyScannedDocument) setError('Very little selectable text was found. This file may be scanned and requires OCR before reliable approval.');
    } catch (cause: any) { setError(cause?.message || 'Syllabus upload failed.'); }
    finally { setLoading(false); }
  }

  async function applyCourseDetails() {
    if (!selectedCourse || !preview?.course) return;
    const detected = preview.course; setLoading(true);
    try {
      await apiFetch(`/api/courses/${selectedCourse.id}`, { method: 'PATCH', body: {
        code: detected.code || selectedCourse.code || null,
        instructor: detected.professor || selectedCourse.instructor || null,
        instructorEmail: detected.professor_email || selectedCourse.instructorEmail || null,
        location: detected.location || selectedCourse.location || null,
        meetingDays: detected.meeting_days || selectedCourse.meetingDays || null,
        meetingStart: detected.meeting_time || selectedCourse.meetingStart || null,
        meetingEnd: detected.meeting_end_time || selectedCourse.meetingEnd || null,
        startDate: detected.start_date || selectedCourse.startDate || null,
        endDate: detected.end_date || selectedCourse.endDate || null,
      }});
      setMessage('Detected course details applied.'); await refreshCourses();
    } catch (cause: any) { setError(cause?.message || 'Course details could not be updated.'); }
    finally { setLoading(false); }
  }

  async function saveSelected() {
    if (!selectedCourse || !currentTerm || !preview || !file) return;
    setLoading(true); setError(''); setMessage('');
    const signature = syllabusApplySignature(selectedCourse.id, fileInfo?.name || file.name, items);
    const progress = loadSyllabusProgress(selectedCourse.id, signature);
    const completed = new Set(progress.completed);
    const operations = items.filter(item => item.selected).length + (diff?.removed.length || 0) + 1;
    setApplyProgress({ completed: completed.size, total: operations });
    const mark = (key: string) => {
      completed.add(key);
      const next = { ...progress, completed: Array.from(completed) };
      saveSyllabusProgress(selectedCourse.id, next);
      setApplyProgress({ completed: completed.size, total: operations });
    };

    try {
      let events: any[] = [];
      try { events = (await apiFetch<{ events: any[] }>('/api/events')).events || []; } catch {}
      const priorSource = new Map((diff?.changed || []).map(change => [change.after.sourceKey, change.before.sourceKey]));
      let created = 0, updated = 0, archived = 0, eventChanges = 0, milestones = 0;

      for (const item of items.filter(candidate => candidate.selected)) {
        const operationKey = `selected:${item.kind}:${item.sourceKey}`;
        if (completed.has(operationKey)) continue;
        if (item.kind === 'event') {
          const token = syllabusEventToken(item.sourceKey);
          const oldToken = priorSource.get(item.sourceKey) ? syllabusEventToken(priorSource.get(item.sourceKey)!) : '';
          const existing = events.find(event => String(event.description || '').includes(token) || (oldToken && String(event.description || '').includes(oldToken)));
          const body = { title: item.title, description: `${item.notes || ''}\n${token}`.trim(), category: 'school', date: item.dueDate.slice(0, 10), allDay: true, course: selectedCourse.title };
          if (existing) await apiFetch(`/api/events/${existing.id}`, { method: 'PATCH', body });
          else await apiFetch('/api/events', { method: 'POST', body });
          eventChanges++; mark(operationKey); continue;
        }

        const tags = Array.from(new Set([...(item.tags || []), syllabusSourceTag(item.sourceKey)]));
        const existing = findTaskForImport(tasks, item, selectedCourse, priorSource.get(item.sourceKey));
        let parent: Task;
        if (existing) {
          parent = await tasksClient.update(existing.id, { title: item.title, course: selectedCourse.title, courseId: selectedCourse.id, dueDate: new Date(item.dueDate).toISOString(), activity: item.activity, estimatedMinutes: item.estimatedMinutes || null, notes: item.notes || null, tags, lifecycle: 'active', status: existing.status }, { silent: true });
          updated++;
        } else {
          parent = await tasksClient.create({ title: item.title, course: selectedCourse.title, courseId: selectedCourse.id, dueDate: new Date(item.dueDate).toISOString(), status: 'todo', term: currentTerm, activity: item.activity, estimatedMinutes: item.estimatedMinutes || null, estimateOrigin: item.estimatedMinutes ? 'manual' : null, notes: item.notes || null, tags }, { silent: true });
          created++;
        }
        if (isMajorAssignment(item)) {
          for (const milestone of assignmentMilestones(item.title, item.dueDate, item.tags?.join(' '))) {
            await tasksClient.create({ title: milestone.title, course: selectedCourse.title, courseId: selectedCourse.id, dueDate: milestone.dueDate, status: 'todo', term: currentTerm, activity: milestone.activity, estimatedMinutes: milestone.estimatedMinutes, dependsOn: parent.id, tags: ['assignment-plan', `assignment-parent:${parent.id}`, milestone.tag] }, { silent: true });
            milestones++;
          }
          await tasksClient.update(parent.id, { tags: Array.from(new Set([...(parent.tags || tags), 'assignment-plan-created'])) }, { silent: true });
        }
        mark(operationKey);
      }

      for (const removed of diff?.removed || []) {
        const operationKey = `removed:${removed.kind}:${removed.sourceKey}`;
        if (completed.has(operationKey)) continue;
        if (removed.kind === 'event') {
          const token = syllabusEventToken(removed.sourceKey);
          const existing = events.find(event => String(event.description || '').includes(token));
          if (existing) { await apiFetch(`/api/events/${existing.id}`, { method: 'DELETE' }); eventChanges++; }
        } else {
          const existing = tasks.find(task => taskMatchesCourse(task, selectedCourse) && syllabusSourceFromTags(task.tags) === removed.sourceKey);
          if (existing) { await tasksClient.archive(existing.id, { silent: true }); archived++; }
        }
        mark(operationKey);
      }

      if (!completed.has('analysis')) {
        const response = await apiFetch<{ diff: SyllabusChangeSummary }>(`/api/courses/${selectedCourse.id}/syllabus`, { method: 'PUT', body: { analysis: buildAnalysis() } });
        setDiff(response.diff || null); mark('analysis');
      }
      clearSyllabusProgress(selectedCourse.id);
      setMessage(`Approved syllabus version: ${created} tasks created, ${updated} updated, ${archived} removed items archived, ${eventChanges} calendar changes, and ${milestones} milestone operations completed.`);
      await refresh();
    } catch (cause: any) {
      setError(`${cause?.message || 'The approved syllabus changes could not be saved.'} Progress was retained; approve again to resume safely.`);
    } finally { setLoading(false); }
  }

  return <main className="space-y-6">
    <section className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/30 to-slate-950 p-6"><p className="text-sm font-medium text-emerald-300">Semester setup</p><h2 className="mt-1 text-2xl font-semibold text-slate-100">Extract, compare, and approve the entire syllabus</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Stable identities recognize moved readings and deadlines. Approval is resumable and idempotent, so retrying after a failure does not duplicate imported tasks or milestone plans.</p></section>
    <section className="rounded-xl border border-slate-700 bg-slate-900/45 p-5"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label className="text-sm text-slate-300">Course<select value={courseId} onChange={event => setCourseId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"><option value="">Select active course</option>{activeCourses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label><label className="text-sm text-slate-300">Syllabus file<input type="file" accept=".pdf,.docx,.txt,.md,.csv" onChange={event => setFile(event.target.files?.[0] || null)} className="mt-1 block w-full text-sm" /></label><label className="text-sm text-slate-300">Timezone<input value={timezone} onChange={event => setTimezone(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /></label><label className="text-sm text-slate-300">Minutes per page<input type="number" min={1} max={15} value={minutesPerPage} onChange={event => setMinutesPerPage(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100" /></label></div><button disabled={!file || !selectedCourse || loading} onClick={upload} className="mt-4 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50">{loading ? 'Working…' : 'Extract syllabus'}</button></section>
    {error ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</div> : null}
    {loading && applyProgress.total ? <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-200">Applying operation {Math.min(applyProgress.completed + 1, applyProgress.total)} of {applyProgress.total}. Completed operations are checkpointed.</div> : null}
    {preview ? <>
      <section className="rounded-xl border border-slate-700 bg-slate-900/45 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-semibold text-slate-100">Extraction review</h2><p className="text-sm text-slate-400">{fileInfo?.name || file?.name} · {preview.sessions.length} dated sessions · {items.filter(item => item.kind === 'task').length} task candidates · {items.filter(item => item.kind === 'event').length} calendar changes</p></div><button disabled={loading} onClick={applyCourseDetails} className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-300">Apply detected course details</button></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3"><SectionList title="Required materials" items={preview.sections?.required_materials} /><SectionList title="Grading" items={preview.sections?.grading_components} /><SectionList title="Major assessments" items={preview.sections?.major_assessments} /><SectionList title="Office hours" items={preview.sections?.office_hours} /><SectionList title="Policies" items={preview.sections?.policies} /><SectionList title="Holidays and breaks" items={preview.sections?.holidays_and_breaks} /></div>{preview.unassignedImportantLines?.length ? <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"><p className="text-sm font-medium text-amber-200">Important text needing review</p>{preview.unassignedImportantLines.slice(0, 15).map((line, index) => <p key={index} className="mt-1 text-xs text-slate-400">{line.reason}: {line.text}</p>)}</div> : null}{preview.lowConfidence?.length ? <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"><p className="text-sm font-medium text-amber-200">Low-confidence extraction</p><p className="mt-1 text-xs text-slate-400">Review the highlighted items before approval. {preview.lowConfidence.length} field{preview.lowConfidence.length === 1 ? '' : 's'} need attention.</p></div> : null}</section>
      {diff ? <section className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-5"><h2 className="font-semibold text-violet-200">Replacement comparison</h2><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><div><p className="text-2xl text-emerald-300">{diff.added.length}</p><p className="text-xs text-slate-500">Added</p></div><div><p className="text-2xl text-sky-300">{diff.changed.length}</p><p className="text-xs text-slate-500">Changed or moved</p></div><div><p className="text-2xl text-rose-300">{diff.removed.length}</p><p className="text-xs text-slate-500">Removed</p></div><div><p className="text-2xl text-slate-300">{diff.unchanged}</p><p className="text-xs text-slate-500">Unchanged</p></div></div><div className="mt-4 space-y-2">{diff.changed.slice(0, 12).map(change => <div key={`${change.before.sourceKey}:${change.after.sourceKey}`} className="rounded-lg bg-slate-950/40 p-3 text-xs text-slate-300"><span className="text-slate-500">Changed:</span> {change.before.title} · {new Date(change.before.dueDate).toLocaleDateString()} → {new Date(change.after.dueDate).toLocaleDateString()}</div>)}{diff.removed.slice(0, 12).map(item => <div key={item.sourceKey} className="rounded-lg bg-rose-950/20 p-3 text-xs text-rose-200">Will archive: {item.title}</div>)}</div></section> : null}
      <section className="rounded-xl border border-slate-700 bg-slate-900/45 p-5"><div className="flex items-end justify-between"><div><h2 className="font-semibold text-slate-100">Approve imported work</h2><p className="text-sm text-slate-400">Edit dates or titles and deselect anything that should not become a tracker item.</p></div><span className="text-sm text-emerald-300">{selectedCount} selected</span></div><div className="mt-4 space-y-2">{items.map(item => <div key={item.id} className="grid gap-2 rounded-lg border border-slate-700 bg-slate-950/35 p-3 md:grid-cols-[auto_1fr_220px]"><input type="checkbox" checked={item.selected} onChange={event => updateItem(item.id, { selected: event.target.checked })} className="mt-2" /><div><input value={item.title} onChange={event => updateItem(item.id, { title: event.target.value })} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" /><p className="mt-1 text-xs text-slate-500">{item.kind} · {item.activity}{item.confidence !== undefined ? ` · ${Math.round(item.confidence * 100)}% confidence` : ''}</p></div><input type="datetime-local" value={localDateTime(item.dueDate)} onChange={event => updateItem(item.id, { dueDate: new Date(event.target.value).toISOString() })} className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" /></div>)}</div><div className="mt-5 flex flex-wrap gap-2"><button disabled={loading || !selectedCount} onClick={saveSelected} className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50">Approve and reconcile syllabus</button><Link href="/courses" className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm text-slate-200">Back to Courses</Link></div></section>
    </> : null}
  </main>;
}
