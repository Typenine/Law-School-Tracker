'use client';

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type Notebook = {
  id: string;
  name: string;
  course: string | null;
  semester: string | null;
  color: string | null;
  archived: boolean;
  noteCount: number;
  sections: string[];
  createdAt: string;
  updatedAt: string;
};

type NoteSummary = {
  id: string;
  title: string;
  notebookId: string | null;
  notebookName: string | null;
  course: string | null;
  semester: string | null;
  section: string;
  classDate: string | null;
  sourceType: string;
  topics: string[];
  originalFilename: string | null;
  mimeType: string | null;
  pinned: boolean;
  archived: boolean;
  wordCount: number;
  preview: string;
  createdAt: string;
  updatedAt: string;
};

type Note = NoteSummary & { content: string };

type NotebookForm = {
  id: string | null;
  name: string;
  semester: string;
  color: string;
};

type ImportForm = {
  title: string;
  notebookId: string;
  section: string;
  classDate: string;
  sourceType: string;
  topics: string;
  file: File | null;
};

const TOKEN_KEY = 'lawSchoolNotesToken';
const SOURCE_TYPES = [
  ['class-notes', 'Class notes'],
  ['reading-notes', 'Reading notes'],
  ['case-brief', 'Case brief'],
  ['outline', 'Outline'],
  ['professor-material', 'Professor material'],
  ['other', 'Other'],
] as const;

function labelSource(value: string): string {
  return SOURCE_TYPES.find(([key]) => key === value)?.[1] || value;
}

function formatUpdated(value: string): string {
  const date = new Date(value);
  const now = Date.now();
  const difference = now - date.getTime();
  if (difference < 60_000) return 'just now';
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}m ago`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function safeFilename(value: string): string {
  return value.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'note';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function semesterGroups(notebooks: Notebook[]): Array<[string, Notebook[]]> {
  const groups = new Map<string, Notebook[]>();
  for (const notebook of notebooks) {
    const semester = notebook.semester || 'Unsorted';
    groups.set(semester, [...(groups.get(semester) || []), notebook]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === 'Unsorted') return 1;
    if (b === 'Unsorted') return -1;
    return b.localeCompare(a);
  });
}

export default function NotesPage() {
  const [token, setToken] = useState('');
  const [savedToken, setSavedToken] = useState('');
  const [showConnection, setShowConnection] = useState(false);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>('all');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Note | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingNote, setLoadingNote] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [notebookModal, setNotebookModal] = useState<NotebookForm | null>(null);
  const [importModal, setImportModal] = useState<ImportForm | null>(null);
  const [showMetadata, setShowMetadata] = useState(false);
  const [savingModal, setSavingModal] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const revisionRef = useRef(0);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY) || '';
    setToken(stored);
    setSavedToken(stored);
    setShowConnection(!stored);
  }, []);

  const api = useCallback(async (
    path: string,
    init: RequestInit = {},
    activeToken = savedToken,
  ) => {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${activeToken}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(path, { ...init, headers, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
    return data;
  }, [savedToken]);

  const loadNotebooks = useCallback(async (activeToken = savedToken) => {
    if (!activeToken) return;
    const data = await api('/api/notes/notebooks', {}, activeToken);
    setNotebooks(Array.isArray(data?.notebooks) ? data.notebooks : []);
  }, [api, savedToken]);

  const loadNotes = useCallback(async (
    activeToken = savedToken,
    notebookId = selectedNotebookId,
    section = selectedSection,
    query = searchQuery,
  ) => {
    if (!activeToken) return [] as NoteSummary[];
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (notebookId !== 'all') params.set('notebookId', notebookId);
      if (section) params.set('section', section);
      if (query.trim()) params.set('q', query.trim());
      const data = await api(`/api/notes?${params.toString()}`, {}, activeToken);
      const nextNotes = Array.isArray(data?.notes) ? data.notes as NoteSummary[] : [];
      setNotes(nextNotes);
      return nextNotes;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load notes.');
      setNotes([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [api, savedToken, searchQuery, selectedNotebookId, selectedSection]);

  const openNote = useCallback(async (id: string) => {
    if (!savedToken || id === selectedNoteId) return;
    setLoadingNote(true);
    setError('');
    try {
      const data = await api(`/api/notes/${encodeURIComponent(id)}`);
      setSelectedNoteId(id);
      setDraft(data.note as Note);
      setDirty(false);
      setSaveState('idle');
      revisionRef.current = 0;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open note.');
    } finally {
      setLoadingNote(false);
    }
  }, [api, savedToken, selectedNoteId]);

  const saveDraft = useCallback(async (force = false) => {
    if (!draft || (!dirty && !force) || saveInFlightRef.current) return;
    const revision = revisionRef.current;
    const snapshot = draft;
    saveInFlightRef.current = true;
    setSaveState('saving');
    try {
      const data = await api(`/api/notes/${encodeURIComponent(snapshot.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: snapshot.title || 'Untitled Page',
          notebookId: snapshot.notebookId,
          section: snapshot.section || 'Notes',
          classDate: snapshot.classDate,
          sourceType: snapshot.sourceType,
          topics: snapshot.topics,
          pinned: snapshot.pinned,
          content: snapshot.content,
        }),
      });
      const saved = data.note as Note;
      setDraft(current => {
        if (!current || current.id !== saved.id) return current;
        return {
          ...current,
          notebookName: saved.notebookName,
          course: saved.course,
          semester: saved.semester,
          wordCount: saved.wordCount,
          updatedAt: saved.updatedAt,
          preview: saved.preview,
        };
      });
      setNotes(current => current.map(note => note.id === saved.id ? {
        ...note,
        ...saved,
        content: undefined,
      } as NoteSummary : note));
      if (revision === revisionRef.current) {
        setDirty(false);
        setSaveState('saved');
      }
    } catch (err) {
      setSaveState('error');
      setError(err instanceof Error ? err.message : 'Unable to save note.');
    } finally {
      saveInFlightRef.current = false;
    }
  }, [api, dirty, draft]);

  useEffect(() => {
    if (!savedToken) return;
    void Promise.all([loadNotebooks(savedToken), loadNotes(savedToken)]);
  }, [savedToken]);

  useEffect(() => {
    if (!savedToken) return;
    const timer = window.setTimeout(() => {
      void loadNotes(savedToken, selectedNotebookId, selectedSection, searchQuery)
        .then(nextNotes => {
          if (selectedNoteId && nextNotes.some(note => note.id === selectedNoteId)) return;
          if (nextNotes[0]) void openNote(nextNotes[0].id);
          else {
            setSelectedNoteId(null);
            setDraft(null);
          }
        });
    }, searchQuery ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [selectedNotebookId, selectedSection, searchQuery]);

  useEffect(() => {
    if (!dirty || !draft) return;
    const timer = window.setTimeout(() => void saveDraft(), 900);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, saveDraft]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const selectedNotebook = useMemo(
    () => notebooks.find(notebook => notebook.id === selectedNotebookId) || null,
    [notebooks, selectedNotebookId],
  );

  const sections = useMemo(() => unique([
    ...(selectedNotebook?.sections || []),
    ...notes.map(note => note.section),
  ]), [notes, selectedNotebook]);

  const groups = useMemo(() => semesterGroups(notebooks), [notebooks]);

  function saveToken() {
    const next = token.trim();
    if (!next) {
      setError('Enter the notes token from your Vercel environment settings.');
      return;
    }
    window.localStorage.setItem(TOKEN_KEY, next);
    setSavedToken(next);
    setShowConnection(false);
    setError('');
  }

  function updateDraft(patch: Partial<Note>) {
    revisionRef.current += 1;
    setDirty(true);
    setSaveState('idle');
    setDraft(current => current ? { ...current, ...patch } : current);
    setNotes(current => current.map(note => note.id === draft?.id ? {
      ...note,
      ...patch,
      preview: patch.content === undefined
        ? note.preview
        : patch.content.replace(/\s+/g, ' ').trim().slice(0, 240),
    } : note));
  }

  async function chooseNotebook(id: string) {
    await saveDraft();
    setSelectedNotebookId(id);
    setSelectedSection('');
    setSelectedNoteId(null);
    setDraft(null);
  }

  async function chooseSection(section: string) {
    await saveDraft();
    setSelectedSection(section);
    setSelectedNoteId(null);
    setDraft(null);
  }

  async function chooseNote(id: string) {
    if (id === selectedNoteId) return;
    await saveDraft();
    await openNote(id);
  }

  async function createPage() {
    if (!savedToken) return;
    setError('');
    try {
      const notebookId = selectedNotebookId === 'all'
        ? (notebooks[0]?.id || null)
        : selectedNotebookId;
      const data = await api('/api/notes', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Untitled Page',
          notebookId,
          section: selectedSection || 'Notes',
          sourceType: 'class-notes',
          content: '',
        }),
      });
      const note = data.note as Note;
      await Promise.all([loadNotebooks(), loadNotes(savedToken, selectedNotebookId, selectedSection, searchQuery)]);
      setSelectedNoteId(note.id);
      setDraft(note);
      setDirty(false);
      setSaveState('idle');
      window.setTimeout(() => editorRef.current?.focus(), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create page.');
    }
  }

  async function saveNotebook(event: FormEvent) {
    event.preventDefault();
    if (!notebookModal) return;
    setSavingModal(true);
    setError('');
    try {
      const payload = {
        name: notebookModal.name.trim(),
        course: notebookModal.name.trim(),
        semester: notebookModal.semester.trim() || null,
        color: notebookModal.color || null,
      };
      if (notebookModal.id) {
        await api(`/api/notes/notebooks/${encodeURIComponent(notebookModal.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        const data = await api('/api/notes/notebooks', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSelectedNotebookId(data.notebook.id);
      }
      setNotebookModal(null);
      await Promise.all([loadNotebooks(), loadNotes()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save notebook.');
    } finally {
      setSavingModal(false);
    }
  }

  async function deleteCurrentNotebook() {
    if (!notebookModal?.id) return;
    if (!window.confirm('Delete this notebook? Its pages will be moved to Unfiled rather than deleted.')) return;
    setSavingModal(true);
    try {
      await api(`/api/notes/notebooks/${encodeURIComponent(notebookModal.id)}`, { method: 'DELETE' });
      setNotebookModal(null);
      setSelectedNotebookId('all');
      setSelectedSection('');
      setSelectedNoteId(null);
      setDraft(null);
      await Promise.all([loadNotebooks(), loadNotes(savedToken, 'all', '', searchQuery)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete notebook.');
    } finally {
      setSavingModal(false);
    }
  }

  async function importFile(event: FormEvent) {
    event.preventDefault();
    if (!importModal?.file) {
      setError('Choose a file to import.');
      return;
    }
    setSavingModal(true);
    setError('');
    try {
      const notebook = notebooks.find(item => item.id === importModal.notebookId);
      const form = new FormData();
      form.set('file', importModal.file);
      form.set('title', importModal.title.trim() || importModal.file.name.replace(/\.[^.]+$/, ''));
      form.set('notebookId', importModal.notebookId);
      form.set('course', notebook?.course || notebook?.name || '');
      form.set('semester', notebook?.semester || '');
      form.set('section', importModal.section.trim() || 'Notes');
      form.set('classDate', importModal.classDate);
      form.set('sourceType', importModal.sourceType);
      form.set('topics', importModal.topics);
      const data = await api('/api/notes', { method: 'POST', body: form });
      const note = data.note as Note;
      setImportModal(null);
      if (selectedNotebookId === 'all') setSelectedNotebookId(note.notebookId || 'all');
      await Promise.all([loadNotebooks(), loadNotes()]);
      setSelectedNoteId(note.id);
      setDraft(note);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import file.');
    } finally {
      setSavingModal(false);
    }
  }

  async function archivePage() {
    if (!draft) return;
    if (!window.confirm(`Archive “${draft.title}”?`)) return;
    try {
      await api(`/api/notes/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      });
      setDraft(null);
      setSelectedNoteId(null);
      await Promise.all([loadNotebooks(), loadNotes()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive page.');
    }
  }

  async function deletePage() {
    if (!draft) return;
    if (!window.confirm(`Permanently delete “${draft.title}”?`)) return;
    try {
      await api(`/api/notes/${encodeURIComponent(draft.id)}`, { method: 'DELETE' });
      setDraft(null);
      setSelectedNoteId(null);
      await Promise.all([loadNotebooks(), loadNotes()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete page.');
    }
  }

  function exportPage() {
    if (!draft) return;
    const metadata = [
      draft.notebookName ? `Notebook: ${draft.notebookName}` : '',
      draft.section ? `Section: ${draft.section}` : '',
      draft.classDate ? `Class date: ${draft.classDate}` : '',
      draft.topics.length ? `Tags: ${draft.topics.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    const body = `# ${draft.title}\n\n${metadata ? `${metadata}\n\n---\n\n` : ''}${draft.content}`;
    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(draft.title)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function applyFormat(prefix: string, suffix = '', linePrefix = false) {
    if (!draft || !editorRef.current) return;
    const editor = editorRef.current;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = draft.content.slice(start, end);
    let nextContent: string;
    let nextStart: number;
    let nextEnd: number;

    if (linePrefix) {
      const lineStart = draft.content.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const selectedEnd = end || start;
      const block = draft.content.slice(lineStart, selectedEnd);
      const formatted = block.split('\n').map(line => `${prefix}${line}`).join('\n');
      nextContent = `${draft.content.slice(0, lineStart)}${formatted}${draft.content.slice(selectedEnd)}`;
      nextStart = lineStart;
      nextEnd = lineStart + formatted.length;
    } else {
      nextContent = `${draft.content.slice(0, start)}${prefix}${selected}${suffix}${draft.content.slice(end)}`;
      nextStart = start + prefix.length;
      nextEnd = nextStart + selected.length;
    }

    updateDraft({ content: nextContent });
    window.setTimeout(() => {
      editor.focus();
      editor.setSelectionRange(nextStart, nextEnd);
    }, 0);
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveDraft(true);
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      applyFormat('**', '**');
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      applyFormat('_', '_');
    }
  }

  function openImportModal() {
    const notebookId = selectedNotebookId === 'all' ? (notebooks[0]?.id || '') : selectedNotebookId;
    setImportModal({
      title: '',
      notebookId,
      section: selectedSection || 'Notes',
      classDate: '',
      sourceType: 'class-notes',
      topics: '',
      file: null,
    });
  }

  if (!savedToken) {
    return (
      <main className="max-w-xl mx-auto space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Notes</h2>
          <p className="text-sm opacity-70 mt-1">Enter your private notes token once on this browser.</p>
        </div>
        <section className="rounded-xl border border-[#1b2344] bg-[#0d1326] p-5 space-y-3">
          <label className="block text-sm">
            <span className="block text-xs opacity-70 mb-1">LAW_SCHOOL_NOTES_TOKEN</span>
            <input
              type="password"
              value={token}
              onChange={event => setToken(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && saveToken()}
              className="w-full bg-[#0b1020] border border-[#1b2344] rounded-lg px-3 py-2"
              placeholder="Paste the token value"
            />
          </label>
          <button type="button" onClick={saveToken} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white">
            Open Notes
          </button>
          {error && <p className="text-sm text-red-300">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Notes Workspace</h2>
          <p className="text-sm opacity-70">Notebooks, editable pages, file imports, and the same database your GPT searches.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowConnection(current => !current)} className="px-3 py-2 rounded-lg border border-[#27345f] text-sm">
            Connection
          </button>
          <button type="button" onClick={openImportModal} className="px-3 py-2 rounded-lg border border-[#27345f] text-sm">
            Import File
          </button>
          <button type="button" onClick={() => setNotebookModal({ id: null, name: '', semester: '', color: '' })} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm">
            New Notebook
          </button>
        </div>
      </div>

      {showConnection && (
        <section className="rounded-lg border border-[#27345f] bg-[#0d1326] p-3 flex flex-col md:flex-row gap-2 md:items-end">
          <label className="flex-1 text-sm">
            <span className="block text-xs opacity-70 mb-1">Private notes token</span>
            <input type="password" value={token} onChange={event => setToken(event.target.value)} className="w-full bg-[#0b1020] border border-[#27345f] rounded px-3 py-2" />
          </label>
          <button type="button" onClick={saveToken} className="px-4 py-2 rounded bg-blue-600 text-white">Update</button>
          <code className="text-xs opacity-60 break-all md:max-w-md">{typeof window === 'undefined' ? '' : `${window.location.origin}/api/gpt/openapi`}</code>
        </section>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200 flex justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="grid min-h-[70vh] grid-cols-1 lg:grid-cols-[230px_300px_minmax(0,1fr)] overflow-hidden rounded-xl border border-[#1b2344] bg-[#090e1c]">
        <aside className="border-b lg:border-b-0 lg:border-r border-[#1b2344] bg-[#0b1020] p-3 space-y-3">
          <button
            type="button"
            onClick={() => void chooseNotebook('all')}
            className={`w-full text-left rounded-lg px-3 py-2 text-sm ${selectedNotebookId === 'all' ? 'bg-blue-600/20 text-blue-200' : 'hover:bg-white/5'}`}
          >
            <span className="font-medium">All Notes</span>
            <span className="float-right opacity-60">{notebooks.reduce((total, item) => total + item.noteCount, 0)}</span>
          </button>

          <div className="max-h-64 lg:max-h-[63vh] overflow-y-auto pr-1 space-y-4">
            {groups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#27345f] p-3 text-xs opacity-70">
                Create a notebook for each course. Courses do not need to exist elsewhere in the tracker first.
              </div>
            ) : groups.map(([semester, items]) => (
              <section key={semester}>
                <div className="px-2 mb-1 text-[11px] uppercase tracking-wide opacity-50">{semester}</div>
                <div className="space-y-1">
                  {items.map(notebook => (
                    <div key={notebook.id} className="group flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void chooseNotebook(notebook.id)}
                        className={`min-w-0 flex-1 text-left rounded-lg px-3 py-2 text-sm ${selectedNotebookId === notebook.id ? 'bg-blue-600/20 text-blue-200' : 'hover:bg-white/5'}`}
                      >
                        <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: notebook.color || '#4f7cff' }} />
                        <span className="truncate align-middle">{notebook.name}</span>
                        <span className="float-right opacity-50">{notebook.noteCount}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNotebookModal({
                          id: notebook.id,
                          name: notebook.name,
                          semester: notebook.semester || '',
                          color: notebook.color || '',
                        })}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 px-1 text-sm"
                        aria-label={`Edit ${notebook.name}`}
                      >
                        ⋯
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {selectedNotebook && (
            <section className="border-t border-[#1b2344] pt-3">
              <div className="px-2 mb-1 text-[11px] uppercase tracking-wide opacity-50">Sections</div>
              <button
                type="button"
                onClick={() => void chooseSection('')}
                className={`w-full text-left rounded px-2 py-1.5 text-sm ${!selectedSection ? 'bg-white/10' : 'hover:bg-white/5'}`}
              >
                All sections
              </button>
              {sections.map(section => (
                <button
                  type="button"
                  key={section}
                  onClick={() => void chooseSection(section)}
                  className={`w-full text-left rounded px-2 py-1.5 text-sm truncate ${selectedSection === section ? 'bg-white/10' : 'hover:bg-white/5'}`}
                >
                  {section}
                </button>
              ))}
            </section>
          )}
        </aside>

        <section className="border-b lg:border-b-0 lg:border-r border-[#1b2344] bg-[#0d1326] flex flex-col min-h-[320px]">
          <div className="p-3 border-b border-[#1b2344] space-y-2">
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search all page text…"
              className="w-full bg-[#090e1c] border border-[#27345f] rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => void createPage()} className="flex-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm">
                New Page
              </button>
              <button type="button" onClick={openImportModal} className="px-3 py-2 rounded-lg border border-[#27345f] text-sm">
                Import
              </button>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 max-h-[50vh] lg:max-h-[70vh]">
            {loading ? (
              <p className="p-4 text-sm opacity-60">Loading pages…</p>
            ) : notes.length === 0 ? (
              <div className="p-5 text-sm opacity-65">
                <p>No pages here yet.</p>
                <button type="button" onClick={() => void createPage()} className="mt-2 underline">Create the first page</button>
              </div>
            ) : notes.map(note => (
              <button
                type="button"
                key={note.id}
                onClick={() => void chooseNote(note.id)}
                className={`w-full text-left p-3 border-b border-[#1b2344] hover:bg-white/5 ${selectedNoteId === note.id ? 'bg-blue-600/15' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium truncate">{note.pinned ? '★ ' : ''}{note.title}</h3>
                    <p className="text-xs opacity-55 mt-1 truncate">{note.section} · {formatUpdated(note.updatedAt)}</p>
                    <p className="text-xs opacity-65 mt-2 line-clamp-2">{note.preview || 'Empty page'}</p>
                  </div>
                  {note.classDate && <span className="text-[10px] opacity-50">{note.classDate.slice(5)}</span>}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="bg-[#0b1020] min-w-0 flex flex-col min-h-[650px] lg:min-h-0">
          {loadingNote ? (
            <div className="p-6 text-sm opacity-60">Opening page…</div>
          ) : !draft ? (
            <div className="h-full min-h-[500px] grid place-items-center p-6 text-center">
              <div>
                <h3 className="font-medium">Select a page or create a new one</h3>
                <p className="text-sm opacity-60 mt-1">Pages autosave and become searchable by your Law School Assistant.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="border-b border-[#1b2344] p-3 space-y-3">
                <div className="flex items-start gap-2">
                  <input
                    value={draft.title}
                    onChange={event => updateDraft({ title: event.target.value })}
                    onBlur={() => !draft.title.trim() && updateDraft({ title: 'Untitled Page' })}
                    className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none border-b border-transparent focus:border-[#27345f] px-1 py-1"
                    aria-label="Page title"
                  />
                  <button
                    type="button"
                    onClick={() => updateDraft({ pinned: !draft.pinned })}
                    className={`px-2 py-1 rounded text-sm ${draft.pinned ? 'text-amber-300 bg-amber-500/10' : 'opacity-60 hover:opacity-100'}`}
                    title={draft.pinned ? 'Unpin page' : 'Pin page'}
                  >
                    {draft.pinned ? '★' : '☆'}
                  </button>
                  <button type="button" onClick={() => setShowMetadata(current => !current)} className="px-2 py-1 rounded text-sm opacity-70 hover:opacity-100">
                    Details
                  </button>
                  <button type="button" onClick={exportPage} className="px-2 py-1 rounded text-sm opacity-70 hover:opacity-100">
                    Export
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs opacity-65">
                  <span>{draft.wordCount.toLocaleString()} words</span>
                  <span>·</span>
                  <span>{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : dirty ? 'Unsaved changes' : 'Saved'}</span>
                  {draft.originalFilename && <><span>·</span><span>Imported from {draft.originalFilename}</span></>}
                </div>

                {showMetadata && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 rounded-lg border border-[#1b2344] bg-[#090e1c] p-3">
                    <label className="text-xs">
                      <span className="block opacity-60 mb-1">Notebook</span>
                      <select
                        value={draft.notebookId || ''}
                        onChange={event => updateDraft({ notebookId: event.target.value || null })}
                        className="w-full bg-[#0d1326] border border-[#27345f] rounded px-2 py-2"
                      >
                        <option value="">Unfiled</option>
                        {notebooks.map(notebook => <option key={notebook.id} value={notebook.id}>{notebook.name}</option>)}
                      </select>
                    </label>
                    <label className="text-xs">
                      <span className="block opacity-60 mb-1">Section</span>
                      <input
                        value={draft.section}
                        onChange={event => updateDraft({ section: event.target.value })}
                        list="note-sections"
                        className="w-full bg-[#0d1326] border border-[#27345f] rounded px-2 py-2"
                      />
                      <datalist id="note-sections">{sections.map(section => <option key={section} value={section} />)}</datalist>
                    </label>
                    <label className="text-xs">
                      <span className="block opacity-60 mb-1">Page type</span>
                      <select
                        value={draft.sourceType}
                        onChange={event => updateDraft({ sourceType: event.target.value })}
                        className="w-full bg-[#0d1326] border border-[#27345f] rounded px-2 py-2"
                      >
                        {SOURCE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs">
                      <span className="block opacity-60 mb-1">Class date</span>
                      <input
                        type="date"
                        value={draft.classDate || ''}
                        onChange={event => updateDraft({ classDate: event.target.value || null })}
                        className="w-full bg-[#0d1326] border border-[#27345f] rounded px-2 py-2"
                      />
                    </label>
                    <label className="text-xs md:col-span-2 xl:col-span-4">
                      <span className="block opacity-60 mb-1">Tags, separated by commas</span>
                      <input
                        value={draft.topics.join(', ')}
                        onChange={event => updateDraft({ topics: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })}
                        className="w-full bg-[#0d1326] border border-[#27345f] rounded px-2 py-2"
                        placeholder="hearsay, exam, professor emphasis"
                      />
                    </label>
                    <div className="md:col-span-2 xl:col-span-4 flex justify-end gap-3 pt-1">
                      <button type="button" onClick={() => void archivePage()} className="text-amber-300 hover:underline">Archive page</button>
                      <button type="button" onClick={() => void deletePage()} className="text-red-300 hover:underline">Delete permanently</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-b border-[#1b2344] px-3 py-2 flex flex-wrap gap-1 text-sm">
                <button type="button" onClick={() => applyFormat('## ', '', true)} className="toolbar-button" title="Heading">H2</button>
                <button type="button" onClick={() => applyFormat('**', '**')} className="toolbar-button font-bold" title="Bold">B</button>
                <button type="button" onClick={() => applyFormat('_', '_')} className="toolbar-button italic" title="Italic">I</button>
                <button type="button" onClick={() => applyFormat('- ', '', true)} className="toolbar-button" title="Bulleted list">• List</button>
                <button type="button" onClick={() => applyFormat('1. ', '', true)} className="toolbar-button" title="Numbered list">1. List</button>
                <button type="button" onClick={() => applyFormat('- [ ] ', '', true)} className="toolbar-button" title="Checklist">☐</button>
                <button type="button" onClick={() => applyFormat('> ', '', true)} className="toolbar-button" title="Quote">Quote</button>
                <button type="button" onClick={() => applyFormat('`', '`')} className="toolbar-button" title="Inline code">Code</button>
                <span className="ml-auto text-xs opacity-45 self-center">Markdown formatting · Ctrl/Cmd+S saves now</span>
              </div>

              <textarea
                ref={editorRef}
                value={draft.content}
                onChange={event => updateDraft({ content: event.target.value })}
                onKeyDown={handleEditorKeyDown}
                className="flex-1 min-h-[520px] resize-none bg-[#0b1020] px-5 py-5 outline-none leading-7 text-[15px] font-sans"
                placeholder="Start taking notes…"
                spellCheck
              />
            </>
          )}
        </section>
      </div>

      {notebookModal && (
        <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onMouseDown={event => event.target === event.currentTarget && setNotebookModal(null)}>
          <form onSubmit={saveNotebook} className="w-full max-w-md rounded-xl border border-[#27345f] bg-[#0d1326] p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{notebookModal.id ? 'Edit Notebook' : 'New Notebook'}</h3>
                <p className="text-xs opacity-60 mt-1">Use one notebook per course, organized by semester.</p>
              </div>
              <button type="button" onClick={() => setNotebookModal(null)} className="text-xl opacity-60">×</button>
            </div>
            <label className="block text-sm">
              <span className="block text-xs opacity-60 mb-1">Notebook or course name</span>
              <input required autoFocus value={notebookModal.name} onChange={event => setNotebookModal({ ...notebookModal, name: event.target.value })} className="w-full bg-[#090e1c] border border-[#27345f] rounded-lg px-3 py-2" placeholder="Evidence" />
            </label>
            <label className="block text-sm">
              <span className="block text-xs opacity-60 mb-1">Semester</span>
              <input value={notebookModal.semester} onChange={event => setNotebookModal({ ...notebookModal, semester: event.target.value })} className="w-full bg-[#090e1c] border border-[#27345f] rounded-lg px-3 py-2" placeholder="Fall 2026" />
            </label>
            <label className="block text-sm">
              <span className="block text-xs opacity-60 mb-1">Color</span>
              <div className="flex items-center gap-2">
                <input type="color" value={notebookModal.color || '#4f7cff'} onChange={event => setNotebookModal({ ...notebookModal, color: event.target.value })} className="h-10 w-14 bg-transparent" />
                <span className="text-xs opacity-60">Used in the notebook sidebar</span>
              </div>
            </label>
            <div className="flex justify-between gap-3">
              {notebookModal.id ? <button type="button" onClick={() => void deleteCurrentNotebook()} className="text-red-300 text-sm">Delete notebook</button> : <span />}
              <div className="flex gap-2">
                <button type="button" onClick={() => setNotebookModal(null)} className="px-3 py-2 rounded border border-[#27345f] text-sm">Cancel</button>
                <button disabled={savingModal} className="px-4 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50">{savingModal ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {importModal && (
        <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onMouseDown={event => event.target === event.currentTarget && setImportModal(null)}>
          <form onSubmit={importFile} className="w-full max-w-lg rounded-xl border border-[#27345f] bg-[#0d1326] p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Import Notes</h3>
                <p className="text-xs opacity-60 mt-1">PDF, DOCX, TXT, or Markdown. The extracted text becomes an editable page.</p>
              </div>
              <button type="button" onClick={() => setImportModal(null)} className="text-xl opacity-60">×</button>
            </div>
            <label className="block text-sm">
              <span className="block text-xs opacity-60 mb-1">File</span>
              <input required type="file" accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain" onChange={event => setImportModal({ ...importModal, file: event.target.files?.[0] || null })} className="w-full text-sm" />
            </label>
            <label className="block text-sm">
              <span className="block text-xs opacity-60 mb-1">Page title</span>
              <input value={importModal.title} onChange={event => setImportModal({ ...importModal, title: event.target.value })} className="w-full bg-[#090e1c] border border-[#27345f] rounded-lg px-3 py-2" placeholder="Uses the file name when blank" />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block text-xs opacity-60 mb-1">Notebook</span>
                <select required value={importModal.notebookId} onChange={event => setImportModal({ ...importModal, notebookId: event.target.value })} className="w-full bg-[#090e1c] border border-[#27345f] rounded-lg px-3 py-2">
                  <option value="" disabled>Create a notebook first</option>
                  {notebooks.map(notebook => <option key={notebook.id} value={notebook.id}>{notebook.name}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs opacity-60 mb-1">Section</span>
                <input value={importModal.section} onChange={event => setImportModal({ ...importModal, section: event.target.value })} className="w-full bg-[#090e1c] border border-[#27345f] rounded-lg px-3 py-2" placeholder="Notes" />
              </label>
              <label className="text-sm">
                <span className="block text-xs opacity-60 mb-1">Type</span>
                <select value={importModal.sourceType} onChange={event => setImportModal({ ...importModal, sourceType: event.target.value })} className="w-full bg-[#090e1c] border border-[#27345f] rounded-lg px-3 py-2">
                  {SOURCE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs opacity-60 mb-1">Class date</span>
                <input type="date" value={importModal.classDate} onChange={event => setImportModal({ ...importModal, classDate: event.target.value })} className="w-full bg-[#090e1c] border border-[#27345f] rounded-lg px-3 py-2" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="block text-xs opacity-60 mb-1">Tags</span>
              <input value={importModal.topics} onChange={event => setImportModal({ ...importModal, topics: event.target.value })} className="w-full bg-[#090e1c] border border-[#27345f] rounded-lg px-3 py-2" placeholder="hearsay, week 3, exam" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setImportModal(null)} className="px-3 py-2 rounded border border-[#27345f] text-sm">Cancel</button>
              <button disabled={savingModal || !importModal.notebookId} className="px-4 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50">{savingModal ? 'Importing…' : 'Import as Page'}</button>
            </div>
          </form>
        </div>
      )}

      <style jsx global>{`
        .toolbar-button {
          border: 1px solid #27345f;
          border-radius: 0.375rem;
          padding: 0.25rem 0.5rem;
          opacity: 0.8;
        }
        .toolbar-button:hover { opacity: 1; background: rgba(255,255,255,0.05); }
      `}</style>
    </main>
  );
}
