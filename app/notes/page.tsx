'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { Course } from '@/lib/types';

type NoteSummary = {
  id: string;
  title: string;
  course: string | null;
  semester: string | null;
  classDate: string | null;
  sourceType: string;
  topics: string[];
  originalFilename: string | null;
  wordCount: number;
  createdAt: string;
};

const TOKEN_KEY = 'lawSchoolNotesToken';

function labelSource(value: string): string {
  return value.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export default function NotesPage() {
  const [token, setToken] = useState('');
  const [savedToken, setSavedToken] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [title, setTitle] = useState('');
  const [course, setCourse] = useState('');
  const [semester, setSemester] = useState('');
  const [classDate, setClassDate] = useState('');
  const [sourceType, setSourceType] = useState('class-notes');
  const [topics, setTopics] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [schemaUrl, setSchemaUrl] = useState('/api/gpt/openapi');

  useEffect(() => {
    setSchemaUrl(`${window.location.origin}/api/gpt/openapi`);
    const stored = window.localStorage.getItem(TOKEN_KEY) || '';
    setToken(stored);
    setSavedToken(stored);
    fetch('/api/courses', { cache: 'no-store' })
      .then(response => response.json())
      .then(data => setCourses(Array.isArray(data?.courses) ? data.courses : []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (savedToken) void loadNotes(savedToken);
  }, [savedToken]);

  async function api(path: string, init: RequestInit = {}, activeToken = savedToken) {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${activeToken}`);
    const response = await fetch(path, { ...init, headers, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
    return data;
  }

  async function loadNotes(activeToken = savedToken) {
    if (!activeToken) return;
    setLoading(true);
    setError('');
    try {
      const data = await api('/api/notes?limit=100', {}, activeToken);
      setNotes(Array.isArray(data?.notes) ? data.notes : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load notes.');
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }

  function saveToken() {
    const next = token.trim();
    if (!next) {
      setError('Enter the notes token from your Vercel environment settings.');
      return;
    }
    window.localStorage.setItem(TOKEN_KEY, next);
    setSavedToken(next);
    setError('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!savedToken) {
      setError('Save the notes token before uploading.');
      return;
    }
    if (!file && !content.trim()) {
      setError('Choose a file or paste note text.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const form = new FormData();
      form.set('title', title.trim());
      form.set('course', course);
      form.set('semester', semester);
      form.set('classDate', classDate);
      form.set('sourceType', sourceType);
      form.set('topics', topics);
      form.set('content', content);
      if (file) form.set('file', file);
      await api('/api/notes', { method: 'POST', body: form });
      setTitle('');
      setClassDate('');
      setTopics('');
      setContent('');
      setFile(null);
      const input = document.getElementById('note-file') as HTMLInputElement | null;
      if (input) input.value = '';
      setSuccess('Note saved and indexed for ChatGPT search.');
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save note.');
    } finally {
      setSaving(false);
    }
  }

  async function removeNote(note: NoteSummary) {
    if (!window.confirm(`Delete “${note.title}”?`)) return;
    setError('');
    try {
      await api(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
      setNotes(current => current.filter(item => item.id !== note.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete note.');
    }
  }

  return (
    <main className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Notes and AI Access</h2>
        <p className="text-sm text-slate-300/70 mt-1">
          Upload PDF, DOCX, TXT, or Markdown notes. The tracker stores the extracted text, not the original file.
        </p>
      </div>

      <section className="rounded-lg border border-[#1b2344] bg-[#0d1326] p-4 space-y-3">
        <div>
          <h3 className="font-medium">Private access token</h3>
          <p className="text-xs text-slate-300/70 mt-1">
            Use the value configured as LAW_SCHOOL_NOTES_TOKEN in Vercel. It stays in this browser’s local storage.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={token}
            onChange={event => setToken(event.target.value)}
            placeholder="Paste token"
            className="flex-1 bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2"
          />
          <button type="button" onClick={saveToken} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white">
            Save Token
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-[#1b2344] bg-[#0d1326] p-4">
        <h3 className="font-medium mb-3">Add notes</h3>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-slate-300/70 mb-1">Title</span>
              <input required value={title} onChange={event => setTitle(event.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" placeholder="Evidence, September 14" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-slate-300/70 mb-1">Course</span>
              <select value={course} onChange={event => setCourse(event.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
                <option value="">No course selected</option>
                {courses.map(item => <option key={item.id} value={item.title}>{item.title}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-slate-300/70 mb-1">Semester</span>
              <input value={semester} onChange={event => setSemester(event.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" placeholder="Fall 2026" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-slate-300/70 mb-1">Class date</span>
              <input type="date" value={classDate} onChange={event => setClassDate(event.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-slate-300/70 mb-1">Type</span>
              <select value={sourceType} onChange={event => setSourceType(event.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2">
                <option value="class-notes">Class notes</option>
                <option value="reading-notes">Reading notes</option>
                <option value="case-brief">Case brief</option>
                <option value="outline">Outline</option>
                <option value="professor-material">Professor material</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-slate-300/70 mb-1">Topics</span>
              <input value={topics} onChange={event => setTopics(event.target.value)} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" placeholder="hearsay, present sense impression" />
            </label>
          </div>

          <label className="text-sm block">
            <span className="block text-xs text-slate-300/70 mb-1">File</span>
            <input id="note-file" type="file" accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain" onChange={event => setFile(event.target.files?.[0] || null)} className="block w-full text-sm" />
          </label>

          <label className="text-sm block">
            <span className="block text-xs text-slate-300/70 mb-1">Or paste text</span>
            <textarea value={content} onChange={event => setContent(event.target.value)} rows={8} className="w-full bg-[#0b1020] border border-[#1b2344] rounded px-3 py-2" placeholder="Paste notes here when you do not have a file." />
          </label>

          <button disabled={saving} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">
            {saving ? 'Saving…' : 'Save Note'}
          </button>
        </form>
      </section>

      {(error || success) && (
        <div className={`rounded border px-3 py-2 text-sm ${error ? 'border-red-500/40 bg-red-950/30 text-red-200' : 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'}`}>
          {error || success}
        </div>
      )}

      <section className="rounded-lg border border-[#1b2344] bg-[#0d1326] p-4 space-y-3">
        <div>
          <h3 className="font-medium">Custom GPT connection</h3>
          <p className="text-xs text-slate-300/70 mt-1">
            Import this schema URL into your custom GPT Action and use LAW_SCHOOL_GPT_TOKEN as its bearer token.
          </p>
        </div>
        <code className="block break-all rounded bg-[#0b1020] border border-[#1b2344] px-3 py-2 text-xs">{schemaUrl}</code>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Saved notes</h3>
          <button type="button" onClick={() => void loadNotes()} disabled={!savedToken || loading} className="px-3 py-1 rounded border border-[#1b2344] text-sm disabled:opacity-50">
            Refresh
          </button>
        </div>
        {loading ? (
          <p className="text-sm text-slate-400">Loading notes…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-slate-400">No notes loaded.</p>
        ) : (
          <div className="space-y-2">
            {notes.map(note => (
              <article key={note.id} className="rounded-lg border border-[#1b2344] bg-[#0d1326] p-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <h4 className="font-medium">{note.title}</h4>
                  <p className="text-xs text-slate-300/70 mt-1">
                    {[note.course, note.classDate, labelSource(note.sourceType), `${note.wordCount.toLocaleString()} words`].filter(Boolean).join(' · ')}
                  </p>
                  {note.topics.length > 0 && <p className="text-xs text-slate-400 mt-1">{note.topics.join(', ')}</p>}
                </div>
                <button type="button" onClick={() => void removeNote(note)} className="text-sm text-red-300 hover:text-red-200 self-start">
                  Delete
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
