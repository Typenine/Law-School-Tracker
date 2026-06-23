"use client";

import { FormEvent } from 'react';
import type { CourseWorkspace } from '@/lib/courseWorkspace';

const fields = [
  ['courseFolderUrl', 'Course folder URL'],
  ['syllabusUrl', 'Syllabus URL'],
  ['notesUrl', 'Class notes URL'],
  ['outlineUrl', 'Master outline URL'],
  ['assignmentsUrl', 'Assignments folder URL'],
] as const;

export default function WorkspaceResources({ workspace, setWorkspace, saving, onSave }: {
  workspace: CourseWorkspace;
  setWorkspace: (next: CourseWorkspace) => void;
  saving: boolean;
  onSave: (event: FormEvent) => void;
}) {
  return <form onSubmit={onSave} className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5">
    <h2 className="font-semibold text-slate-100">Course links and exam setup</h2>
    <p className="mt-1 text-sm text-slate-400">Store the Drive links already used for this course.</p>
    <div className="mt-4 space-y-3">
      {fields.map(([field, label]) => <label key={field} className="block text-sm text-slate-300">
        <span>{label}</span>
        <input type="url" value={workspace[field] || ''} onChange={event => setWorkspace({ ...workspace, [field]: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100" />
      </label>)}
      <label className="block text-sm text-slate-300"><span>Exam date</span><input type="date" value={workspace.examDate || ''} onChange={event => setWorkspace({ ...workspace, examDate: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100" /></label>
      <label className="block text-sm text-slate-300"><span>Exam format</span><input value={workspace.examFormat || ''} onChange={event => setWorkspace({ ...workspace, examFormat: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3 py-2 text-slate-100" /></label>
      <label className="block text-sm text-slate-300"><span>Outline completion: {workspace.outlineProgress || 0}%</span><input type="range" min={0} max={100} step={5} value={workspace.outlineProgress || 0} onChange={event => setWorkspace({ ...workspace, outlineProgress: Number(event.target.value) })} className="mt-2 w-full" /></label>
      <button disabled={saving} className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">{saving ? 'Saving…' : 'Save course workspace'}</button>
    </div>
  </form>;
}
