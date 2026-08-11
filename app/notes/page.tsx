'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RichEditor from './RichEditor';
import { useTerm } from '@/lib/useTerm';
import { termOptions, termSortKey } from '@/lib/semester';
import NotesStyles from './NotesStyles';
import NotesTree, { notebookKey, sectionKey, semesterKey } from './NotesTree';
import { useNotesActions } from './NotesActionsContext';
import { sanitizeNoteHtml } from '@/lib/notes/htmlUtils';
import {
  Notebook,
  Page,
  PageSummary,
  SECTION_COLORS,
  SOURCE_TYPES,
  Section,
  daysLeft,
  formatUpdated,
  longDate,
  safeFilename,
  sectionColor,
} from './notesTypes';

type NotebookForm = { id: string | null; name: string; semester: string; color: string };
type SectionForm = { id: string | null; parentId: string | null; name: string; color: string };
type ImportForm = {
  title: string;
  section: string;
  classDate: string;
  sourceType: string;
  topics: string;
  file: File | null;
};

const AUTOSAVE_MS = 900;

/**
 * A failed request, with the body the server sent back.
 *
 * A 409 carries the version of the page that won, which is the whole point of
 * answering 409 rather than overwriting - so the error has to keep it.
 */
class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * No request may hang forever.
 *
 * `fetch` has no timeout of its own, so a server that accepts a connection and
 * never answers leaves the promise pending for good. Every caller here awaits
 * that promise before refreshing the tree or reporting a problem, so a single
 * unanswered request means the button appears to do nothing at all - no new
 * page, no deletion, no error, nothing to retry.
 */
const REQUEST_TIMEOUT_MS = 15_000;

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Callers may bring their own signal; honour both.
  const caller = init.signal;
  if (caller) {
    if (caller.aborted) controller.abort();
    else caller.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(path, { ...init, headers, cache: 'no-store', signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(data?.error || `Request failed (${response.status})`, response.status, data);
    }
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError' && !caller?.aborted) {
      throw new ApiError(
        'The server did not answer. Nothing was lost — wait a moment and try again.',
        504,
        {},
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export default function NotesPage() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [notebookId, setNotebookId] = useState<string>('');
  const [sectionName, setSectionName] = useState<string>('');
  const [sectionId, setSectionId] = useState<string>('');
  const [pageId, setPageId] = useState<string>('');
  const [draft, setDraft] = useState<Page | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PageSummary[] | null>(null);
  /** Assignments, for linking a page to the reading it was written for. */
  const [assignments, setAssignments] = useState<{ id: string; title: string; course: string | null; status: string }[]>([]);
  /** Set when arriving from a task, so the rail shows just that task's pages. */
  const [taskFilter, setTaskFilter] = useState<string>('');
  const [loadingPages, setLoadingPages] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [booted, setBooted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  /** A save that was refused, holding both versions so either can be kept. */
  const [conflict, setConflict] = useState<{ theirs: Page; myHtml: string; myTitle: string } | null>(null);
  const conflictRef = useRef<typeof conflict>(null);
  /**
   * Confirmation for anything destructive, asked inside the page.
   *
   * These used to be `window.confirm`. Browsers offer "prevent this page from
   * creating additional dialogs" once a few have been shown, and from then on
   * confirm() returns false instantly and silently - so every delete returned
   * early and did nothing at all. No request, no error, no change on screen,
   * and the more often you tried the more certain it became.
   */
  const [confirmAsk, setConfirmAsk] = useState<
    { title: string; body: string; action: string } | null
  >(null);
  const confirmReply = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback((title: string, body: string, action: string): Promise<boolean> => {
    // Anything still waiting is answered "no" rather than left hanging.
    confirmReply.current?.(false);
    setConfirmAsk({ title, body, action });
    return new Promise<boolean>(resolve => { confirmReply.current = resolve; });
  }, []);

  const answerConfirm = useCallback((ok: boolean) => {
    setConfirmAsk(null);
    const reply = confirmReply.current;
    confirmReply.current = null;
    reply?.(ok);
  }, []);

  const [setAside, setSetAside] = useState<
    { trashed: PageSummary[]; archived: PageSummary[]; retentionDays: number } | null
  >(null);

  type OutlineData = {
    notebook: { id: string; name: string; semester: string | null };
    tag: string | null;
    sections: { id: string; name: string; depth: number; pages: {
      id: string; title: string; classDate: string | null; sourceType: string;
      topics: string[]; contentHtml: string;
    }[] }[];
    unfiled: { id: string; title: string; classDate: string | null; sourceType: string;
      topics: string[]; contentHtml: string }[];
  };
  const [outlineModal, setOutlineModal] = useState<{ notebookId: string; tag: string } | null>(null);
  const [outlineData, setOutlineData] = useState<OutlineData | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState('');

  const [notebookModal, setNotebookModal] = useState<NotebookForm | null>(null);
  const [sectionModal, setSectionModal] = useState<SectionForm | null>(null);
  const [importModal, setImportModal] = useState<ImportForm | null>(null);
  const [savingModal, setSavingModal] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  // The tree handles navigation, so the page list starts out of the way and
  // the canvas gets the width. The Pages tab brings it back.
  const [pageListOpen, setPageListOpen] = useState(true);
  const [dragPageId, setDragPageId] = useState<string>('');
  /** Pages per notebook, fetched when a notebook is expanded in the tree. */
  const [pagesByNotebook, setPagesByNotebook] = useState<Record<string, PageSummary[]>>({});
  const [loadingNotebookId, setLoadingNotebookId] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // New notebooks belong to the semester you are actually in.
  const { term } = useTerm();
  const { registerActions, setCanDelete } = useNotesActions();

  // The editor is uncontrolled, so the latest HTML lives in a ref and is only
  // read when a save actually runs.
  const htmlRef = useRef<string>('');
  const draftRef = useRef<Page | null>(null);
  const savingRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const creatingPageRef = useRef(false);
  const deletingPageRef = useRef(false);
  const pageListRequestRef = useRef(0);
  const openPageRequestRef = useRef(0);
  const notebookRequestRef = useRef<Record<string, number>>({});
  const notesMutationVersionRef = useRef(0);

  useEffect(() => { draftRef.current = draft; }, [draft]);

  // Assignments, so a page can say which reading it belongs to.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api('/api/tasks');
        if (cancelled) return;
        const list = Array.isArray(data?.tasks) ? data.tasks : [];
        setAssignments(list.map((task: any) => ({
          id: String(task.id),
          title: String(task.title || 'Untitled'),
          course: task.course ?? null,
          status: String(task.status || 'todo'),
        })));
      } catch {
        // Linking is a convenience; the notes workspace works without it.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Outstanding assignments first, but always including the one this page is
   * already linked to - otherwise finishing the reading would drop the link
   * out of the picker and look like it had been lost.
   */
  const assignmentChoices = useMemo(() => {
    const linked = draft?.taskId || '';
    return assignments
      .filter(task => task.status !== 'done' || task.id === linked)
      .slice(0, 200);
  }, [assignments, draft?.taskId]);

  // Arriving from a task's "Notes" link: show that assignment's pages.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('taskId');
    if (!wanted) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api(`/api/notes?taskId=${encodeURIComponent(wanted)}&limit=200`);
        if (cancelled) return;
        const found: PageSummary[] = Array.isArray(data?.notes) ? data.notes : [];
        setSearchResults(found);
        setTaskFilter(wanted);
        if (found.length === 1) await openPage(found[0].id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load notes for that assignment.');
      }
    })();
    return () => { cancelled = true; };
    // Runs once: the link is read from the URL the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arriving from a deep link (Command Palette, search result, another page)
  // pointing straight at one page: open it once notebooks/sections have
  // loaded, so the tree can reveal the branch it lives in.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('pageId');
    if (!wanted || !booted || !notebooks.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api(`/api/notes/${encodeURIComponent(wanted)}`);
        if (cancelled) return;
        const page = data.note as Page;
        if (page.notebookId) {
          setNotebookId(page.notebookId);
          setSectionId(page.sectionId || '');
          setSectionName(page.section);
          revealPath(notebooks.find(item => item.id === page.notebookId), page.sectionId || '');
          await loadPages(page.notebookId, page.section);
        }
        await openPage(page.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to open that note.');
      }
    })();
    return () => { cancelled = true; };
    // Only re-runs once notebooks have loaded; the target itself never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, notebooks]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => { conflictRef.current = conflict; }, [conflict]);

  const activeNotebook = useMemo(
    () => notebooks.find(item => item.id === notebookId) || null,
    [notebooks, notebookId],
  );
  const notebookSections = useMemo(
    () => sections.filter(section => section.notebookId === notebookId),
    [sections, notebookId],
  );
  /**
   * Where the section being edited is allowed to go: anywhere in this notebook
   * except inside itself. Indented so "Week 1" under Case Briefs reads
   * differently from "Week 1" under Class Notes.
   */
  const sectionParentOptions = useMemo(() => {
    const editing = sectionModal?.id || '';
    const barred = new Set<string>(editing ? [editing] : []);
    for (let pass = 0; pass < notebookSections.length; pass++) {
      const before = barred.size;
      for (const section of notebookSections) {
        if (section.parentId && barred.has(section.parentId)) barred.add(section.id);
      }
      if (barred.size === before) break;
    }
    const options: { id: string; label: string }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const section of notebookSections.filter(s => (s.parentId || null) === parentId)) {
        if (barred.has(section.id)) continue;
        options.push({ id: section.id, label: `${'— '.repeat(depth)}${section.name}` });
        walk(section.id, depth + 1);
      }
    };
    walk(null, 0);
    return options;
  }, [notebookSections, sectionModal?.id]);
  const activeSection = useMemo(
    () => notebookSections.find(section => section.id === sectionId)
      || notebookSections.find(section => section.name === sectionName)
      || null,
    [notebookSections, sectionId, sectionName],
  );
  const activeSectionColor = useMemo(() => {
    const index = notebookSections.findIndex(section => section.id === activeSection?.id);
    return sectionColor(activeSection || undefined, index < 0 ? 0 : index);
  }, [activeSection, notebookSections, sectionName]);

  const notebookGroups = useMemo(() => {
    const groups = new Map<string, Notebook[]>();
    for (const notebook of notebooks) {
      const key = notebook.semester || 'Unsorted';
      groups.set(key, [...(groups.get(key) || []), notebook]);
    }
    // Newest semester first, in real calendar order rather than alphabetical.
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === 'Unsorted') return 1;
      if (b === 'Unsorted') return -1;
      const diff = termSortKey(b) - termSortKey(a);
      return diff !== 0 ? diff : b.localeCompare(a);
    });
  }, [notebooks]);

  /** Semester choices: the usual terms, plus any already in use. */
  const semesterChoices = useMemo(() => {
    const used = notebooks.map(n => n.semester).filter((s): s is string => Boolean(s));
    const all = Array.from(new Set([...termOptions(), ...used]));
    return all.sort((a, b) => termSortKey(b) - termSortKey(a));
  }, [notebooks]);

  /** Narrows the page list to one tag at a time; cleared on section/notebook change. */
  const [activeTag, setActiveTag] = useState('');
  const unfilteredVisiblePages = searchResults ?? pages;
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const page of unfilteredVisiblePages) for (const topic of page.topics) set.add(topic);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [unfilteredVisiblePages]);
  const visiblePages = useMemo(
    () => (activeTag ? unfilteredVisiblePages.filter(page => page.topics.includes(activeTag)) : unfilteredVisiblePages),
    [unfilteredVisiblePages, activeTag],
  );
  // A tag that no longer applies (switched section, or filtered itself out of
  // the list) should not silently keep the page list empty.
  useEffect(() => {
    if (activeTag && !availableTags.includes(activeTag)) setActiveTag('');
  }, [activeTag, availableTags]);

  // ---------------------------------------------------------------- loading

  const loadNotebooks = useCallback(async (signal?: AbortSignal): Promise<Notebook[]> => {
    const data = await api('/api/notes/notebooks', signal ? { signal } : {});
    const next = Array.isArray(data?.notebooks) ? (data.notebooks as Notebook[]) : [];
    setNotebooks(next);
    return next;
  }, []);

  const loadSections = useCallback(async (signal?: AbortSignal): Promise<Section[]> => {
    const data = await api('/api/notes/sections', signal ? { signal } : {});
    const next = Array.isArray(data?.sections) ? (data.sections as Section[]) : [];
    setSections(next);
    return next;
  }, []);

  const loadPages = useCallback(async (
    targetNotebook: string,
    targetSection: string,
  ): Promise<PageSummary[]> => {
    const requestId = ++pageListRequestRef.current;
    const mutationVersion = notesMutationVersionRef.current;
    if (!targetNotebook) {
      if (requestId === pageListRequestRef.current) setPages([]);
      return [];
    }
    setLoadingPages(true);
    try {
      const params = new URLSearchParams({ limit: '500', notebookId: targetNotebook });
      if (targetSection) params.set('section', targetSection);
      const data = await api(`/api/notes?${params.toString()}`);
      const next = Array.isArray(data?.notes) ? (data.notes as PageSummary[]) : [];
      if (requestId === pageListRequestRef.current
        && mutationVersion === notesMutationVersionRef.current) {
        setPages(next);
      }
      return next;
    } finally {
      if (requestId === pageListRequestRef.current) setLoadingPages(false);
    }
  }, []);


  const openPage = useCallback(async (id: string) => {
    const requestId = ++openPageRequestRef.current;
    const mutationVersion = notesMutationVersionRef.current;
    setLoadingPage(true);
    setError('');
    try {
      const data = await api(`/api/notes/${encodeURIComponent(id)}`);
      if (requestId !== openPageRequestRef.current
        || mutationVersion !== notesMutationVersionRef.current) return;
      const page = data.note as Page;
      htmlRef.current = page.contentHtml;
      draftRef.current = page;
      dirtyRef.current = false;
      saveQueuedRef.current = false;
      setPageId(page.id);
      setDraft(page);
      setDirty(false);
      setSaveState('idle');
    } catch (err) {
      if (requestId === openPageRequestRef.current) {
        setError(err instanceof Error ? err.message : 'Unable to open the page.');
      }
    } finally {
      if (requestId === openPageRequestRef.current) setLoadingPage(false);
    }
  }, []);


  // ------------------------------------------------------------------ saving

  /** The body a save sends; shared by normal saves, conflict resolution and exit flushes. */
  const savePayload = useCallback((
    current: Page,
    contentHtml = htmlRef.current,
    expectedUpdatedAt = current.updatedAt,
  ) => JSON.stringify({
    title: current.title.trim() || 'Untitled Page',
    notebookId: current.notebookId,
    section: current.section || 'Notes',
    sectionId: current.sectionId,
    taskId: current.taskId,
    classDate: current.classDate,
    sourceType: current.sourceType,
    topics: current.topics,
    pinned: current.pinned,
    contentHtml,
    // What we believe the server has. If it moved on, the save is refused
    // rather than overwriting an edit made on another device.
    expectedUpdatedAt,
  }), []);

  const savePage = useCallback(async (force = false) => {
    const current = draftRef.current;
    if (!current) return;
    if (!dirtyRef.current && !force) return;
    if (savingRef.current) {
      saveQueuedRef.current = true;
      return;
    }

    const revision = revisionRef.current;
    const html = htmlRef.current;
    let mayQueueAnotherSave = true;
    savingRef.current = true;
    saveQueuedRef.current = false;
    setSaveState('saving');
    try {
      const data = await api(`/api/notes/${encodeURIComponent(current.id)}`, {
        method: 'PATCH',
        body: savePayload(current, html),
      });
      const saved = data.note as Page;
      const latest = draftRef.current;
      if (latest?.id === saved.id) {
        // A newer keystroke may have landed while this request was in flight.
        // Keep the newer editor state, but advance the server timestamp so the
        // immediately queued save does not look like a conflict.
        const merged = revision === revisionRef.current
          ? saved
          : {
              ...latest,
              notebookName: saved.notebookName,
              course: saved.course,
              semester: saved.semester,
              wordCount: saved.wordCount,
              updatedAt: saved.updatedAt,
              preview: saved.preview,
            };
        draftRef.current = merged;
        setDraft(merged);
      }
      setPages(list => list.map(page => page.id === saved.id
        ? { ...page, ...saved }
        : page));
      retryRef.current = 0;

      if (revision === revisionRef.current) {
        dirtyRef.current = false;
        setDirty(false);
        setSaveState('saved');
      } else {
        // Do not claim the newer edit was saved by an older request.
        dirtyRef.current = true;
        setDirty(true);
        setSaveState('idle');
        saveQueuedRef.current = true;
      }

      // Keep every cached tree copy in step with the server response.
      setPagesByNotebook(cache => {
        const next: Record<string, PageSummary[]> = {};
        for (const [key, list] of Object.entries(cache)) {
          next[key] = list.map(page => page.id === saved.id ? { ...page, ...saved } : page);
        }
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save the page.';
      // A conflict is not worth retrying: someone else's version is newer, so
      // put both in front of the user rather than looping until one is lost.
      if (err instanceof ApiError && err.status === 409 && err.data?.note) {
        mayQueueAnotherSave = false;
        saveQueuedRef.current = false;
        setSaveState('error');
        const nextConflict = {
          theirs: err.data.note as Page,
          // Straight from the live contenteditable DOM, so it has never been
          // through the server's sanitizer - do that before it is ever handed
          // to dangerouslySetInnerHTML below.
          myHtml: sanitizeNoteHtml(htmlRef.current),
          myTitle: draftRef.current?.title || current.title,
        };
        conflictRef.current = nextConflict;
        setConflict(nextConflict);
        return;
      }
      // Keep the edits marked dirty and try again shortly. Giving up here used
      // to leave "Save failed" on screen with the work only in the browser.
      mayQueueAnotherSave = false;
      saveQueuedRef.current = false;
      dirtyRef.current = true;
      setDirty(true);
      setSaveState('error');
      setError(message);
      const attempt = Math.min(retryRef.current + 1, 5);
      retryRef.current = attempt;
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => { void savePageRef.current?.(true); }, 1000 * 2 ** (attempt - 1));
    } finally {
      savingRef.current = false;
      if (mayQueueAnotherSave && (saveQueuedRef.current || revisionRef.current !== revision)) {
        saveQueuedRef.current = false;
        window.setTimeout(() => { void savePageRef.current?.(true); }, 0);
      }
    }
  }, [savePayload]);

  // savePage is referenced by the retry timer scheduled inside itself.
  const savePageRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  useEffect(() => { savePageRef.current = savePage; }, [savePage]);

  /**
   * Last-chance flush when the tab is hidden or closing. sendBeacon is the only
   * request a browser reliably completes during unload, so a pending debounce
   * is no longer lost when the tab goes away.
   */
  const flushOnExit = useCallback(() => {
    const current = draftRef.current;
    // A conflict is already showing the user two versions to choose between;
    // firing a beacon with the same stale `expectedUpdatedAt` on the way out
    // would just be rejected again by the server for no benefit.
    if (!current || !dirtyRef.current || conflictRef.current) return;
    try {
      const body = new Blob([savePayload(current)], { type: 'application/json' });
      navigator.sendBeacon(`/api/notes/${encodeURIComponent(current.id)}`, body);
    } catch {}
  }, [savePayload]);

  // Autosave.
  useEffect(() => {
    if (!dirty || !draft) return;
    const timer = window.setTimeout(() => void savePage(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, savePage]);

  // Flush pending edits when leaving.
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    }
    function onHide() {
      if (document.visibilityState === 'hidden') flushOnExit();
    }
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', flushOnExit);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', flushOnExit);
      document.removeEventListener('visibilitychange', onHide);
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      if (dirtyRef.current) void savePage(true);
    };
  }, [savePage, flushOnExit]);

  // ------------------------------------------------------------------- boot

  useEffect(() => {
    // A request that never answers used to leave this screen up for good, with
    // nothing said and nothing to click. Boot gives up after a while and shows
    // what happened instead of spinning.
    const controller = new AbortController();
    const giveUp = window.setTimeout(() => controller.abort(), 20_000);

    (async () => {
      try {
        const [loadedNotebooks] = await Promise.all([
          loadNotebooks(controller.signal),
          loadSections(controller.signal),
        ]);
        const remembered = window.localStorage.getItem('notesLastNotebook') || '';
        const first = loadedNotebooks.find(item => item.id === remembered) || loadedNotebooks[0];
        if (first) setNotebookId(first.id);
      } catch (err) {
        setError(controller.signal.aborted
          ? 'The server did not answer. Your notes are safe — this is only the page failing to load them.'
          : err instanceof Error ? err.message : 'Unable to load your notebooks.');
      } finally {
        window.clearTimeout(giveUp);
        setBooted(true);
      }
    })();

    return () => { window.clearTimeout(giveUp); controller.abort(); };
  }, [loadNotebooks, loadSections]);

  // Pick a section whenever the notebook changes, preferring the tab that was
  // open last so a reload lands where you left off.
  useEffect(() => {
    if (!notebookId) return;
    window.localStorage.setItem('notesLastNotebook', notebookId);
    const available = sections.filter(section => section.notebookId === notebookId);
    if (!available.length) { setSectionName(''); return; }
    setSectionName(current => {
      if (available.some(section => section.name === current)) return current;
      const remembered = window.localStorage.getItem(`notesLastSection:${notebookId}`) || '';
      if (available.some(section => section.name === remembered)) return remembered;
      return available[0].name;
    });
    // Prefer a leaf (a week) so new pages land somewhere sensible.
    setSectionId(current => {
      if (available.some(section => section.id === current)) return current;
      const leaf = available.find(section => section.parentId
        && !available.some(child => child.parentId === section.id));
      return (leaf || available[0]).id;
    });
  }, [notebookId, sections]);

  // Load pages for the selected tab, and open the remembered page.
  useEffect(() => {
    if (!notebookId || !sectionName) { setPages([]); setDraft(null); setPageId(''); return; }
    window.localStorage.setItem(`notesLastSection:${notebookId}`, sectionName);
    let cancelled = false;
    (async () => {
      try {
        const next = await loadPages(notebookId, sectionName);
        if (cancelled) return;
        if (next.some(page => page.id === pageId)) return;
        const remembered = window.localStorage.getItem(`notesLastPage:${notebookId}:${sectionName}`) || '';
        const target = next.find(page => page.id === remembered) || next[0];
        if (target) void openPage(target.id);
        else { setPageId(''); setDraft(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load pages.');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, sectionName]);

  useEffect(() => {
    if (!notebookId || !sectionName || !pageId) return;
    window.localStorage.setItem(`notesLastPage:${notebookId}:${sectionName}`, pageId);
    revealPath(notebooks.find(n => n.id === notebookId), sectionId);
    void loadNotebookPages(notebookId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, sectionName, sectionId, pageId]);

  // Search across every page in the notebook.
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) { setSearchResults(null); return; }
    const timer = window.setTimeout(async () => {
      try {
        // Across every notebook: the box says "all notes" and now means it.
        const params = new URLSearchParams({ limit: '100', q: query });
        const data = await api(`/api/notes?${params.toString()}`);
        setSearchResults(Array.isArray(data?.notes) ? (data.notes as PageSummary[]) : []);
      } catch {
        setSearchResults([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery, notebookId]);

  // ----------------------------------------------------------------- actions

  /** Remember which branches are open between visits. */
  const [restoredTree, setRestoredTree] = useState(false);
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem('notesTreeOpenV1') || '[]');
      if (Array.isArray(stored) && stored.length) setExpanded(new Set(stored as string[]));
    } catch {}
    setRestoredTree(true);
  }, []);

  /**
   * First visit: nothing is remembered, so open the newest semester and its
   * first notebook and section. A tree that starts entirely closed gives you
   * nothing to click.
   */
  useEffect(() => {
    if (!restoredTree || !booted || expanded.size > 0 || !notebooks.length) return;
    const first = notebooks.find(n => n.id === notebookId) || notebooks[0];
    const firstSection = sections.find(x => x.notebookId === first.id);
    const next = new Set<string>([semesterKey(first.semester || 'Unsorted'), notebookKey(first.id)]);
    if (firstSection) next.add(sectionKey(firstSection.id));
    setExpanded(next);
    persistExpanded(next);
    void loadNotebookPages(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredTree, booted, notebooks, sections]);

  const persistExpanded = useCallback((next: Set<string>) => {
    try { window.localStorage.setItem('notesTreeOpenV1', JSON.stringify(Array.from(next))); } catch {}
  }, []);

  /** Load a notebook's pages once, so its sections can list them. */
  const loadNotebookPages = useCallback(async (id: string) => {
    if (!id || pagesByNotebook[id]) return;
    const requestId = (notebookRequestRef.current[id] || 0) + 1;
    notebookRequestRef.current[id] = requestId;
    const mutationVersion = notesMutationVersionRef.current;
    setLoadingNotebookId(id);
    try {
      const data = await api(`/api/notes?limit=500&notebookId=${encodeURIComponent(id)}`);
      const list = Array.isArray(data?.notes) ? (data.notes as PageSummary[]) : [];
      if (notebookRequestRef.current[id] === requestId
        && mutationVersion === notesMutationVersionRef.current) {
        setPagesByNotebook(current => ({ ...current, [id]: list }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pages.');
    } finally {
      if (notebookRequestRef.current[id] === requestId) setLoadingNotebookId('');
    }
  }, [pagesByNotebook]);


  const toggleNode = useCallback((key: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        if (key.startsWith('nb:')) void loadNotebookPages(key.slice(3));
      }
      persistExpanded(next);
      return next;
    });
  }, [loadNotebookPages, persistExpanded]);

  /** Open the branches leading to a page so the selection is always visible. */
  const revealPath = useCallback((notebook: Notebook | undefined, targetSectionId: string) => {
    if (!notebook) return;
    setExpanded(current => {
      const next = new Set(current);
      next.add(semesterKey(notebook.semester || 'Unsorted'));
      next.add(notebookKey(notebook.id));
      // Walk up the section chain so every ancestor is open.
      let node = sections.find(x => x.id === targetSectionId);
      let guard = 0;
      while (node && guard++ < 10) {
        next.add(sectionKey(node.id));
        node = node.parentId ? sections.find(x => x.id === node!.parentId) : undefined;
      }
      persistExpanded(next);
      return next;
    });
  }, [sections, persistExpanded]);

  async function selectTreePage(nbId: string, secId: string, section: string, id: string) {
    if (id === pageId) return;
    if (dirtyRef.current) await savePage(true);
    // Claim the selection in the same update as the notebook and section.
    //
    // Changing the section runs the effect that opens whichever page was last
    // read in that tab, and it leaves the current page alone only if it is
    // already the selected one. `openPage` sets that after an await, so the
    // effect used to win the race and replace the page just clicked with a
    // different one - and then Move to trash deleted the wrong page.
    setPageId(id);
    if (nbId) setNotebookId(nbId);
    if (secId) setSectionId(secId);
    if (section) setSectionName(section);
    await openPage(id);
  }

  async function createPageIn(nbId: string, secId: string, section: string) {
    setNotebookId(nbId);
    setSectionId(secId);
    setSectionName(section);
    await createPage(nbId, section, secId);
  }

  /**
   * Drag a page onto another page to reorder within its section, or onto a
   * section to move it there. Both go through the same reorder call.
   */
  async function movePage(pageId: string, targetSectionId: string, beforePageId: string | null) {
    const target = sections.find(section => section.id === targetSectionId);
    if (!target) return;

    let moving: PageSummary | undefined;
    let sourceNotebookId = '';
    for (const [cachedNotebookId, cachedPages] of Object.entries(pagesByNotebook)) {
      const found = cachedPages.find(page => page.id === pageId);
      if (found) { moving = found; sourceNotebookId = cachedNotebookId; break; }
    }
    if (!moving) return;

    const targetPages = pagesByNotebook[target.notebookId] || [];
    const rest = targetPages
      .filter(page => page.sectionId === targetSectionId && page.id !== pageId)
      .sort((a, b) => a.position - b.position)
      .map(page => page.id);
    const at = beforePageId ? rest.indexOf(beforePageId) : rest.length;
    rest.splice(at < 0 ? rest.length : at, 0, pageId);

    const movedSummary: PageSummary = {
      ...moving,
      notebookId: target.notebookId,
      notebookName: notebooks.find(item => item.id === target.notebookId)?.name || moving.notebookName,
      sectionId: targetSectionId,
      section: target.name,
      position: rest.indexOf(pageId),
    };

    // Reflect the move straight away in both notebook branches.
    setPagesByNotebook(cache => {
      const next: Record<string, PageSummary[]> = {};
      for (const [key, list] of Object.entries(cache)) next[key] = list.filter(page => page.id !== pageId);
      next[target.notebookId] = [...(next[target.notebookId] || []), movedSummary];
      return next;
    });
    try {
      await api('/api/notes/reorder', {
        method: 'PUT',
        body: JSON.stringify({ notebookId: target.notebookId, sectionId: targetSectionId, orderedIds: rest }),
      });
      await Promise.all([
        loadSections(), loadNotebooks(),
        refreshNotebookPages(target.notebookId),
        sourceNotebookId && sourceNotebookId !== target.notebookId
          ? refreshNotebookPages(sourceNotebookId)
          : Promise.resolve(),
        target.notebookId === notebookId
          ? loadPages(notebookId, sectionName)
          : Promise.resolve(),
      ]);
      if (pageId === draftRef.current?.id) {
        setNotebookId(target.notebookId);
        setSectionId(targetSectionId);
        setSectionName(target.name);
        await loadPages(target.notebookId, target.name);
        await openPage(pageId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to move the page.');
      await Promise.all([
        refreshNotebookPages(target.notebookId),
        sourceNotebookId ? refreshNotebookPages(sourceNotebookId) : Promise.resolve(),
      ]);
    }
  }

  /**
   * Three ways out of a save conflict. Whichever the user picks, neither
   * version is thrown away without them saying so.
   */
  async function resolveConflict(choice: 'mine' | 'theirs' | 'both') {
    if (!conflict || !draft) return;
    const { theirs, myHtml, myTitle } = conflict;
    setSavingModal(true);
    setError('');
    try {
      if (choice === 'theirs') {
        // Drop what is on screen and take the newer copy.
        dirtyRef.current = false;
        conflictRef.current = null;
        setDirty(false);
        setConflict(null);
        await openPage(theirs.id);
        setSaveState('saved');
        return;
      }

      if (choice === 'both') {
        // Keep the other version where it is and put mine beside it, so the
        // two can be reconciled by reading them rather than by guesswork.
        const data = await api('/api/notes', {
          method: 'POST',
          body: JSON.stringify({
            title: `${myTitle} (my copy)`,
            notebookId: draft.notebookId,
            section: draft.section,
            sectionId: draft.sectionId,
            taskId: draft.taskId,
            classDate: draft.classDate,
            sourceType: draft.sourceType,
            topics: draft.topics,
            pinned: draft.pinned,
            contentHtml: myHtml,
          }),
        });
        dirtyRef.current = false;
        conflictRef.current = null;
        setDirty(false);
        setConflict(null);
        await Promise.all([
          loadPages(theirs.notebookId || '', theirs.section || ''),
          refreshNotebookPages(theirs.notebookId || ''),
        ]);
        await openPage(data.note.id);
        setSaveState('saved');
        return;
      }

      // 'mine': overwrite, now that the user has seen what they are replacing.
      // Sending the timestamp of the version that won makes this a deliberate
      // save on top of it rather than a blind retry.
      const data = await api(`/api/notes/${encodeURIComponent(theirs.id)}`, {
        method: 'PATCH',
        body: savePayload(
          { ...draft, title: myTitle.trim() || 'Untitled Page' },
          myHtml,
          theirs.updatedAt,
        ),
      });
      const saved = data.note as Page;
      draftRef.current = saved;
      dirtyRef.current = false;
      conflictRef.current = null;
      setDraft(saved);
      setDirty(false);
      setConflict(null);
      setSaveState('saved');
      await refreshNotebookPages(saved.notebookId || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to settle the conflict.');
    } finally {
      setSavingModal(false);
    }
  }

  /**
   * File a whole section somewhere else - a week that belongs under Reading
   * Notes rather than Case Briefs, say. Passing null lifts it to the top level.
   */
  async function moveSection(sectionId: string, newParentId: string | null) {
    const moving = sections.find(x => x.id === sectionId);
    if (!moving || (moving.parentId || null) === newParentId) return;
    try {
      await api(`/api/notes/sections/${sectionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ parentId: newParentId }),
      });
      // Open the new parent so the section does not appear to vanish.
      if (newParentId) setExpanded(current => new Set(current).add(sectionKey(newParentId)));
      await loadSections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to move the section.');
    }
  }

  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      const body = new FormData();
      body.set('file', file);
      const data = await api('/api/notes/images', { method: 'POST', body });
      return typeof data?.url === 'string' ? data.url : null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add the image.');
      return null;
    }
  }, []);

  // Fetches whenever the modal opens or its tag filter changes; closing it
  // (outlineModal -> null) does not need to clear outlineData, since the
  // modal unmounts and the stale data cannot be shown before a fresh open.
  useEffect(() => {
    if (!outlineModal) return;
    let cancelled = false;
    setOutlineLoading(true);
    setOutlineError('');
    // Debounced: the tag field re-triggers this on every keystroke, and a
    // semester's worth of pages is too much to recompile on each one.
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ notebookId: outlineModal.notebookId });
        if (outlineModal.tag) params.set('tag', outlineModal.tag);
        const data = await api(`/api/notes/outline?${params.toString()}`);
        if (cancelled) return;
        setOutlineData(data.outline as OutlineData);
      } catch (err) {
        if (!cancelled) setOutlineError(err instanceof Error ? err.message : 'Unable to build the outline.');
      } finally {
        if (!cancelled) setOutlineLoading(false);
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [outlineModal]);

  function printOutline() {
    if (!outlineModal) return;
    const params = new URLSearchParams({ notebookId: outlineModal.notebookId, format: 'html' });
    if (outlineModal.tag) params.set('tag', outlineModal.tag);
    window.open(`/api/notes/outline?${params.toString()}`, '_blank', 'noopener');
  }

  const loadSetAside = useCallback(async () => {
    try {
      const data = await api('/api/notes/deleted');
      setSetAside({
        trashed: Array.isArray(data?.trashed) ? data.trashed : [],
        archived: Array.isArray(data?.archived) ? data.archived : [],
        retentionDays: Number(data?.retentionDays) || 30,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load set-aside pages.');
    }
  }, []);

  /** Throw out everything in the trash now instead of waiting it out. */
  async function emptyTrash() {
    const count = setAside?.trashed.length || 0;
    if (!count) return;
    const plural = count === 1 ? 'page' : 'pages';
    if (!await ask('Empty the trash?', `${count} ${plural} will be deleted for good. This cannot be undone.`, 'Delete for good')) return;
    try {
      await api('/api/notes/deleted', { method: 'DELETE' });
      await loadSetAside();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to empty the trash.');
    }
  }

  async function restorePage(id: string) {
    try {
      const data = await api('/api/notes/deleted', { method: 'POST', body: JSON.stringify({ id }) });
      const restored = data.note as Page;
      notesMutationVersionRef.current += 1;
      const [nextNotebooks] = await Promise.all([loadNotebooks(), loadSections(), loadSetAside()]);
      if (restored.notebookId) {
        await refreshNotebookPages(restored.notebookId);
        setNotebookId(restored.notebookId);
        setSectionId(restored.sectionId || '');
        setSectionName(restored.section);
        revealPath(nextNotebooks.find(item => item.id === restored.notebookId), restored.sectionId || '');
        await loadPages(restored.notebookId, restored.section);
      }
      setSetAside(null);
      await openPage(restored.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to restore the page.');
    }
  }

  async function purgePage(id: string, title: string) {
    if (!await ask('Delete for good?', `“${title}” will be gone for good. This cannot be undone.`, 'Delete for good')) return;
    try {
      await api(`/api/notes/${encodeURIComponent(id)}?purge=true`, { method: 'DELETE' });
      await loadSetAside();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the page.');
    }
  }

  function patchDraft(patch: Partial<Page>) {
    revisionRef.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setSaveState('idle');
    setDraft(current => {
      if (!current) return current;
      const next = { ...current, ...patch };
      draftRef.current = next;
      return next;
    });
    if (patch.title !== undefined || patch.pinned !== undefined) {
      setPages(list => list.map(page => page.id === draftRef.current?.id ? { ...page, ...patch } as PageSummary : page));
    }
  }

  async function selectNotebook(id: string) {
    if (id === notebookId) return;
    if (dirtyRef.current) await savePage(true);
    setSearchQuery('');
    setNotebookId(id);
  }

  async function selectSection(name: string) {
    if (name === sectionName) return;
    if (dirtyRef.current) await savePage(true);
    setSearchQuery('');
    setSectionName(name);
  }

  async function selectPage(id: string) {
    if (id === pageId) return;
    if (dirtyRef.current) await savePage(true);
    await openPage(id);
  }

  async function createPage(
    targetNotebook = notebookId,
    targetSection = sectionName,
    targetSectionId = sectionId,
    /** Set when the page is being started from an assignment. */
    forTaskId: string | null = null,
  ) {
    if (creatingPageRef.current) return;
    if (!targetNotebook) {
      setError('Create a notebook first.');
      return;
    }

    creatingPageRef.current = true;
    setError('');
    try {
      if (dirtyRef.current) await savePage(true);
      let section = targetSection;
      if (!section) {
        const created = await api('/api/notes/sections', {
          method: 'POST',
          body: JSON.stringify({ notebookId: targetNotebook, name: 'Notes' }),
        });
        section = created?.section?.name || 'Notes';
        targetSectionId = created?.section?.id || '';
      }

      const data = await api('/api/notes', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Untitled Page',
          notebookId: targetNotebook,
          section,
          sectionId: targetSectionId || undefined,
          sourceType: 'class-notes',
          contentHtml: '<p><br></p>',
          taskId: forTaskId || undefined,
        }),
      });
      const page = data.note as Page;
      const summary = page as PageSummary;
      const resolvedSection = page.section || section;
      const resolvedSectionId = page.sectionId || targetSectionId;

      notesMutationVersionRef.current += 1;
      pageListRequestRef.current += 1;
      openPageRequestRef.current += 1;
      notebookRequestRef.current[targetNotebook] = (notebookRequestRef.current[targetNotebook] || 0) + 1;

      setSearchQuery('');
      setSearchResults(null);
      if (!forTaskId) setTaskFilter('');
      setNotebookId(targetNotebook);
      setSectionId(resolvedSectionId || '');
      setSectionName(resolvedSection);
      setPageListOpen(true);

      const sameVisibleSection = targetNotebook === notebookId
        && (resolvedSectionId ? resolvedSectionId === sectionId : resolvedSection === sectionName);
      setPages(current => {
        const base = sameVisibleSection ? current : [];
        return [...base.filter(item => item.id !== page.id), summary]
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position);
      });
      setPagesByNotebook(current => ({
        ...current,
        [targetNotebook]: [
          ...(current[targetNotebook] || []).filter(item => item.id !== page.id),
          summary,
        ],
      }));
      setNotebooks(current => current.map(notebook => notebook.id === targetNotebook
        ? { ...notebook, noteCount: notebook.noteCount + 1 }
        : notebook));

      htmlRef.current = page.contentHtml;
      draftRef.current = page;
      dirtyRef.current = false;
      saveQueuedRef.current = false;
      setPageId(page.id);
      setDraft(page);
      setDirty(false);
      setSaveState('idle');

      const book = notebooks.find(item => item.id === targetNotebook);
      setExpanded(current => {
        const next = new Set(current);
        if (book) next.add(semesterKey(book.semester || 'Unsorted'));
        next.add(notebookKey(targetNotebook));
        if (resolvedSectionId) next.add(sectionKey(resolvedSectionId));
        persistExpanded(next);
        return next;
      });

      window.setTimeout(() => {
        const title = document.querySelector<HTMLInputElement>('.nb-page-title');
        if (title && draftRef.current?.id === page.id) {
          title.focus();
          title.select();
        }
      }, 0);

      try {
        const [nextNotebooks, nextSections] = await Promise.all([
          loadNotebooks(),
          loadSections(),
          loadPages(targetNotebook, resolvedSection),
          refreshNotebookPages(targetNotebook),
        ]);
        const refreshedBook = nextNotebooks.find(item => item.id === targetNotebook);
        const refreshedSection = nextSections.find(item => item.id === resolvedSectionId)
          || nextSections.find(item => item.notebookId === targetNotebook && item.name === resolvedSection);
        setExpanded(current => {
          const next = new Set(current);
          if (refreshedBook) next.add(semesterKey(refreshedBook.semester || 'Unsorted'));
          next.add(notebookKey(targetNotebook));
          if (refreshedSection) next.add(sectionKey(refreshedSection.id));
          persistExpanded(next);
          return next;
        });
      } catch {
        setError('The page was created and opened, but the sidebar could not fully refresh.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the page.');
    } finally {
      creatingPageRef.current = false;
    }
  }


  /** Re-read a notebook's pages after something changes them. */
  const refreshNotebookPages = useCallback(async (id: string) => {
    if (!id) return;
    const requestId = (notebookRequestRef.current[id] || 0) + 1;
    notebookRequestRef.current[id] = requestId;
    const mutationVersion = notesMutationVersionRef.current;
    try {
      const data = await api(`/api/notes?limit=500&notebookId=${encodeURIComponent(id)}`);
      const list = Array.isArray(data?.notes) ? (data.notes as PageSummary[]) : [];
      if (notebookRequestRef.current[id] === requestId
        && mutationVersion === notesMutationVersionRef.current) {
        setPagesByNotebook(current => ({ ...current, [id]: list }));
      }
    } catch {}
  }, []);


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
          method: 'PATCH', body: JSON.stringify(payload),
        });
      } else {
        const data = await api('/api/notes/notebooks', { method: 'POST', body: JSON.stringify(payload) });
        setNotebookId(data.notebook.id);
      }
      setNotebookModal(null);
      await Promise.all([loadNotebooks(), loadSections()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the notebook.');
    } finally {
      setSavingModal(false);
    }
  }

  async function deleteNotebook() {
    if (!notebookModal?.id) return;
    if (!await ask('Delete this notebook?', 'Its pages move to Unfiled rather than being deleted.', 'Delete notebook')) return;
    setSavingModal(true);
    try {
      await api(`/api/notes/notebooks/${encodeURIComponent(notebookModal.id)}`, { method: 'DELETE' });
      setNotebookModal(null);
      const remaining = await loadNotebooks();
      await loadSections();
      setNotebookId(remaining[0]?.id || '');
      setSectionId('');
      setSectionName('');
      setDraft(null);
      setPageId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the notebook.');
    } finally {
      setSavingModal(false);
    }
  }

  async function saveSection(event: FormEvent) {
    event.preventDefault();
    if (!sectionModal || !notebookId) return;
    setSavingModal(true);
    setError('');
    try {
      const name = sectionModal.name.trim();
      let savedSection: Section;
      if (sectionModal.id) {
        const data = await api(`/api/notes/sections/${encodeURIComponent(sectionModal.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, color: sectionModal.color || null, parentId: sectionModal.parentId }),
        });
        savedSection = data.section as Section;
        if (sectionModal.parentId) {
          setExpanded(current => new Set(current).add(sectionKey(sectionModal.parentId as string)));
        }
      } else {
        const data = await api('/api/notes/sections', {
          method: 'POST',
          body: JSON.stringify({ notebookId, name, color: sectionModal.color || null, parentId: sectionModal.parentId }),
        });
        savedSection = data.section as Section;
      }
      setSectionModal(null);
      await Promise.all([loadSections(), loadNotebooks()]);
      setSectionId(savedSection.id);
      setSectionName(savedSection.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the section.');
    } finally {
      setSavingModal(false);
    }
  }

  async function deleteSection() {
    if (!sectionModal?.id) return;
    const others = notebookSections.filter(section => section.id !== sectionModal.id);
    const message = others.length
      ? `“${sectionModal.name}” is removed and its pages move to “${others[0].name}”.`
      : `“${sectionModal.name}” is the last section, so its pages go to the trash with it.`;
    if (!await ask('Delete this section?', message, 'Delete section')) return;
    setSavingModal(true);
    try {
      await api(`/api/notes/sections/${encodeURIComponent(sectionModal.id)}`, { method: 'DELETE' });
      setSectionModal(null);
      const nextSections = await loadSections();
      await loadNotebooks();
      const remaining = nextSections.filter(section => section.notebookId === notebookId);
      setSectionId(remaining[0]?.id || '');
      setSectionName(remaining[0]?.name || '');
      setDraft(null);
      setPageId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the section.');
    } finally {
      setSavingModal(false);
    }
  }

  /**
   * Take a page out of every list that can show it, at once.
   *
   * The tree reads from a per-notebook cache, the section panel from its own
   * list, and a search replaces the tree with a third. Waiting on a refetch to
   * clear them is both slow and fragile - the refetch targets the selected
   * notebook, which is not necessarily the one the page lived in, and the
   * cache used to refuse to reload a notebook it had already seen. So the page
   * goes from all three immediately, and the refetch merely confirms it.
   */
  function removeFromView(id: string, ownerNotebookId: string | null) {
    setSearchResults(current => (current ? current.filter(item => item.id !== id) : current));
    setPages(current => current.filter(item => item.id !== id));
    setPagesByNotebook(current => {
      const next: Record<string, PageSummary[]> = {};
      // Drop it wherever it is cached: a page can appear under the notebook it
      // belongs to and under whichever one happens to be selected.
      for (const [key, list] of Object.entries(current)) {
        next[key] = list.filter(item => item.id !== id);
      }
      if (ownerNotebookId && !next[ownerNotebookId]) next[ownerNotebookId] = [];
      return next;
    });
  }

  async function archivePage() {
    if (!draft) return;
    if (!await ask('Archive this page?', `“${draft.title}” moves to Set aside and can be restored later.`, 'Archive')) return;
    try {
      const removedId = draft.id;
      const owner = draft.notebookId || notebookId;
      await api(`/api/notes/${encodeURIComponent(removedId)}`, {
        method: 'PATCH', body: JSON.stringify({ archived: true }),
      });
      dirtyRef.current = false;
      saveQueuedRef.current = false;
      draftRef.current = null;
      setDirty(false);
      setDraft(null);
      setPageId('');
      removeFromView(removedId, owner);
      await Promise.all([
        loadNotebooks(), loadSections(), loadPages(notebookId, sectionName),
        refreshNotebookPages(owner),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive the page.');
    }
  }

  /** Returns whether a page was actually moved to trash (false if cancelled). */
  async function deletePage(): Promise<boolean> {
    const current = draftRef.current;
    if (!current || deletingPageRef.current) return false;

    deletingPageRef.current = true;
    try {
      if (!await ask(
        'Move to trash?',
        `“${current.title}” goes to the trash. You can restore it from Set aside.`,
        'Move to trash',
      )) return false;

      const owner = current.notebookId || notebookId;
      const source = (owner ? pagesByNotebook[owner] : null) || pages;
      const siblings = source
        .filter(item => item.sectionId === current.sectionId || item.section === current.section)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position);
      const index = siblings.findIndex(item => item.id === current.id);
      const nextPage = siblings[index + 1] || siblings[index - 1] || null;

      const wasDirty = dirtyRef.current;
      dirtyRef.current = false;
      saveQueuedRef.current = false;
      setDirty(false);
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      for (let attempt = 0; attempt < 100 && savingRef.current; attempt++) {
        await new Promise(resolve => window.setTimeout(resolve, 25));
      }

      try {
        await api(`/api/notes/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
      } catch (err) {
        dirtyRef.current = wasDirty;
        setDirty(wasDirty);
        throw err;
      }

      notesMutationVersionRef.current += 1;
      pageListRequestRef.current += 1;
      openPageRequestRef.current += 1;
      if (owner) notebookRequestRef.current[owner] = (notebookRequestRef.current[owner] || 0) + 1;

      draftRef.current = null;
      setDraft(null);
      setPageId('');
      setSaveState('idle');
      setShowDetails(false);
      removeFromView(current.id, owner || null);
      setNotebooks(list => list.map(notebook => notebook.id === owner
        ? { ...notebook, noteCount: Math.max(0, notebook.noteCount - 1) }
        : notebook));

      try {
        const rememberedKey = `notesLastPage:${owner}:${current.section}`;
        if (window.localStorage.getItem(rememberedKey) === current.id) {
          window.localStorage.removeItem(rememberedKey);
        }
      } catch {}

      if (nextPage) {
        setPageId(nextPage.id);
        await openPage(nextPage.id);
      }

      try {
        const remaining = owner ? await loadPages(owner, current.section) : [];
        await Promise.all([
          loadNotebooks(),
          loadSections(),
          owner ? refreshNotebookPages(owner) : Promise.resolve(),
        ]);
        if (!nextPage && remaining[0]) await openPage(remaining[0].id);
      } catch {
        setError('The page is in the trash, but the sidebar could not fully refresh.');
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the page.');
      return false;
    } finally {
      deletingPageRef.current = false;
    }
  }

  useEffect(() => {
    setCanDelete(Boolean(draft));
  }, [draft, setCanDelete]);

  useEffect(() => {
    registerActions({
      create: () => createPage(),
      remove: () => deletePage(),
    });
  }, [registerActions, notebookId, sectionName, sectionId, draft?.id]);


  async function importFile(event: FormEvent) {
    event.preventDefault();
    if (!importModal?.file) { setError('Choose a file to import.'); return; }
    if (!notebookId) { setError('Create a notebook first.'); return; }
    setSavingModal(true);
    setError('');
    try {
      const form = new FormData();
      form.set('file', importModal.file);
      form.set('title', importModal.title.trim() || importModal.file.name.replace(/\.[^.]+$/, ''));
      form.set('notebookId', notebookId);
      form.set('course', activeNotebook?.course || activeNotebook?.name || '');
      form.set('semester', activeNotebook?.semester || '');
      form.set('section', importModal.section.trim() || sectionName || 'Notes');
      form.set('classDate', importModal.classDate);
      form.set('sourceType', importModal.sourceType);
      form.set('topics', importModal.topics);
      const data = await api('/api/notes', { method: 'POST', body: form });
      const page = data.note as Page;
      setImportModal(null);
      await Promise.all([loadNotebooks(), loadSections()]);
      setSectionId(page.sectionId || '');
      setSectionName(page.section);
      await loadPages(notebookId, page.section);
      await openPage(page.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import the file.');
    } finally {
      setSavingModal(false);
    }
  }

  /**
   * A copy of the notes that lives outside this app. One notebook, or the lot.
   * The server assembles the Markdown in tree order; the browser just saves it.
   */
  /** Wait until the editor has no save in flight and no newer revision queued. */
  async function flushPendingSave(): Promise<boolean> {
    if (dirtyRef.current) await savePage(true);
    for (let attempt = 0; attempt < 80 && (savingRef.current || dirtyRef.current); attempt++) {
      await new Promise(resolve => window.setTimeout(resolve, 50));
      if (!savingRef.current && dirtyRef.current && !conflictRef.current) await savePage(true);
    }
    if (dirtyRef.current || conflictRef.current) {
      setError('Save this page successfully before exporting it.');
      return false;
    }
    return true;
  }

  async function downloadBackup(notebook: string | null) {
    if (!await flushPendingSave()) return;
    const query = notebook ? `?notebookId=${encodeURIComponent(notebook)}` : '';
    const anchor = document.createElement('a');
    anchor.href = `/api/notes/export${query}`;
    anchor.rel = 'noopener';
    anchor.click();
  }

  async function exportPage() {
    const current = draftRef.current;
    if (!current || !await flushPendingSave()) return;
    try {
      // Re-read the page so the file is made from the exact server copy that
      // the status line now calls saved, not from an older React snapshot.
      const data = await api(`/api/notes/${encodeURIComponent(current.id)}`);
      const page = data.note as Page;
      const meta = [
        page.notebookName ? `Notebook: ${page.notebookName}` : '',
        page.section ? `Section: ${page.section}` : '',
        page.classDate ? `Class date: ${page.classDate}` : '',
        page.topics.length ? `Tags: ${page.topics.join(', ')}` : '',
      ].filter(Boolean).join('\n');
      const body = `# ${page.title}\n\n${meta ? `${meta}\n\n---\n\n` : ''}${page.content}`;
      const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename(page.title)}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to export the page.');
    }
  }

  async function reorderPages(targetId: string) {
    if (!dragPageId || dragPageId === targetId || searchResults) return;
    const ordered = pages.map(page => page.id);
    const from = ordered.indexOf(dragPageId);
    const to = ordered.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ordered.splice(to, 0, ordered.splice(from, 1)[0]);
    const byId = new Map(pages.map(page => [page.id, page] as const));
    setPages(ordered.map(id => byId.get(id)!).filter(Boolean));
    setDragPageId('');
    try {
      await api('/api/notes/reorder', {
        method: 'PUT',
        body: JSON.stringify({ notebookId, section: sectionName, orderedIds: ordered }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the page order.');
      await loadPages(notebookId, sectionName);
    }
  }

  async function movePageToSection(targetSectionId: string) {
    const current = draftRef.current;
    const target = notebookSections.find(section => section.id === targetSectionId);
    if (!current || !target || target.id === current.sectionId) return;
    try {
      const data = await api(`/api/notes/${encodeURIComponent(current.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sectionId: target.id, section: target.name }),
      });
      const moved = data.note as Page;
      dirtyRef.current = false;
      setDirty(false);
      draftRef.current = moved;
      setDraft(moved);
      setSectionId(target.id);
      setSectionName(target.name);
      await Promise.all([loadSections(), loadNotebooks(), refreshNotebookPages(notebookId)]);
      await loadPages(notebookId, target.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to move the page.');
    }
  }

  const saveLabel = saveState === 'saving' ? 'Saving…'
    : saveState === 'error' ? 'Save failed'
    : dirty ? 'Unsaved changes'
    : 'All changes saved';

  // ------------------------------------------------------------------- views

  if (!booted) {
    return <main className="nb-boot">Opening your notebooks…<NotesStyles /></main>;
  }

  // Boot finished but nothing loaded and something went wrong: say so, and
  // offer the one thing that helps, rather than showing an empty workspace
  // that invites the user to start again over the top of existing notes.
  if (!notebooks.length && error) {
    return (
      <main className="nb-empty-state">
        <h2>Your notes could not be loaded</h2>
        <p>{error}</p>
        <p className="nb-boot-hint">
          Nothing has been lost — this is the page failing to reach the server, not the notes
          themselves. If a reload does not help, the deployment may still be starting up.
        </p>
        <button type="button" className="nb-primary" onClick={() => window.location.reload()}>
          Try again
        </button>
        <NotesStyles />
      </main>
    );
  }

  if (!notebooks.length) {
    return (
      <main className="nb-empty-state">
        <div className="nb-empty-card">
          <h2>Start your first notebook</h2>
          <p>
            Notes are organised the way OneNote is: a notebook per course, coloured section tabs
            inside it, and pages inside each section. Everything you write here is what your Law
            School Assistant searches.
          </p>
          <button type="button" className="nb-primary" onClick={() => setNotebookModal({ id: null, name: '', semester: term?.name || '', color: SECTION_COLORS[0] })}>
            Create a notebook
          </button>
        </div>
        {notebookModal && (
          <NotebookModal
            form={notebookModal}
            saving={savingModal}
            semesterChoices={semesterChoices}
            onChange={setNotebookModal}
            onSubmit={saveNotebook}
            onClose={() => setNotebookModal(null)}
            onDelete={null}
          />
        )}
        <NotesStyles />
      </main>
    );
  }

  return (
    <main className={`nb-shell${railOpen ? '' : ' nb-rail-collapsed'}${pageListOpen ? '' : ' nb-pages-collapsed'}`}>
      {error && (
        <div className="nb-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button>
        </div>
      )}

      <div className="nb-frame" style={{ ['--tab' as any]: activeSectionColor }}>
        {/* Semester > subject > week > pages, all collapsible */}
        <aside className="nb-rail">
          <div className="nb-rail-head">
            <span>Notebooks</span>
            <button
              type="button"
              className="nb-icon-button"
              title="New notebook"
              onClick={() => setNotebookModal({ id: null, name: '', semester: term?.name || '', color: SECTION_COLORS[0] })}
            >
              +
            </button>
          </div>
          <div className="nb-rail-search">
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search all notes…"
              aria-label="Search all notes"
            />
          </div>
          {taskFilter && (
            <div className="nb-rail-filter">
              <div>
                <span className="nb-rail-filter-label">Notes for</span>
                <strong>{assignments.find(t => t.id === taskFilter)?.title || 'this assignment'}</strong>
              </div>
              <div className="nb-rail-filter-actions">
                <button
                  type="button"
                  onClick={() => void createPage(notebookId, sectionName, sectionId, taskFilter)}
                >
                  New page for it
                </button>
                <button type="button" onClick={() => { setTaskFilter(''); setSearchResults(null); }}>
                  Show all
                </button>
              </div>
            </div>
          )}
          <div className="nb-rail-scroll">
            <NotesTree
              notebooks={notebooks}
              sections={sections}
              pagesByNotebook={pagesByNotebook}
              expanded={expanded}
              onToggle={toggleNode}
              selectedNotebookId={notebookId}
              selectedSectionId={sectionId}
              selectedPageId={pageId}
              loadingNotebookId={loadingNotebookId}
              onSelectPage={(nb, secId, section, id) => void selectTreePage(nb, secId, section, id)}
              onNewNotebook={semester => setNotebookModal({ id: null, name: '', semester, color: SECTION_COLORS[0] })}
              onEditNotebook={notebook => setNotebookModal({
                id: notebook.id,
                name: notebook.name,
                semester: notebook.semester || '',
                color: notebook.color || SECTION_COLORS[0],
              })}
              onNewSection={(nb, parentId) => { setNotebookId(nb); setSectionModal({ id: null, parentId, name: '', color: SECTION_COLORS[sections.filter(x => x.notebookId === nb).length % SECTION_COLORS.length] }); }}
              onEditSection={(section, colour) => { setNotebookId(section.notebookId); setSectionModal({ id: section.id, parentId: section.parentId, name: section.name, color: colour }); }}
              onNewPage={(nb, secId, section) => void createPageIn(nb, secId, section)}
              searchResults={searchResults}
              onMovePage={(pageId, targetSectionId, beforePageId) => void movePage(pageId, targetSectionId, beforePageId)}
              onMoveSection={(sectionId, newParentId) => void moveSection(sectionId, newParentId)}
            />
          </div>
          <div className="nb-rail-foot-row">
            <button type="button" className="nb-rail-foot" onClick={() => void loadSetAside()}>
              Set aside — trash &amp; archive
            </button>
            <button
              type="button"
              className="nb-rail-foot"
              onClick={() => void downloadBackup(null)}
              title="Download every notebook as one Markdown file"
            >
              Back up everything
            </button>
          </div>
        </aside>

        <div className="nb-body">
          <div className="nb-tabbar">
            <button
              type="button"
              className="nb-rail-toggle"
              title={railOpen ? 'Hide the notebook tree' : 'Show the notebook tree'}
              aria-expanded={railOpen}
              onClick={() => setRailOpen(open => !open)}
            >
              ☰
            </button>
            <div className="nb-crumbs">
              {activeNotebook && <span className="nb-crumb">{activeNotebook.name}</span>}
              {activeNotebook && sectionName && <span className="nb-crumb-sep">›</span>}
              {sectionName && <span className="nb-crumb" style={{ color: activeSectionColor }}>{sectionName}</span>}
            </div>
            {activeSection && (
              <button
                type="button"
                className="nb-tab-settings"
                title="Section settings"
                onClick={() => setSectionModal({
                  id: activeSection.id,
                  parentId: activeSection.parentId,
                  name: activeSection.name,
                  color: activeSectionColor,
                })}
              >
                Section ⋯
              </button>
            )}
            <button
              type="button"
              className="nb-tab-settings"
              title={pageListOpen ? 'Hide the page list and use the full width' : 'Show the page list'}
              aria-expanded={pageListOpen}
              onClick={() => setPageListOpen(open => !open)}
            >
              {pageListOpen ? 'Focus ⤢' : 'Pages ⤡'}
            </button>
          </div>

          <div className="nb-workspace">
            <section className="nb-canvas-column">
              {loadingPage ? (
                <div className="nb-placeholder">Opening page…</div>
              ) : !draft ? (
                <div className="nb-placeholder">
                  <h3>No page open</h3>
                  <p>Create a page in this section to start writing.</p>
                  <button type="button" className="nb-primary" onClick={() => void createPage()}>New page</button>
                </div>
              ) : (
                <>
                  <div className="nb-page-head">
                    <input
                      className="nb-page-title"
                      value={draft.title}
                      onChange={event => patchDraft({ title: event.target.value })}
                      onBlur={() => !draft.title.trim() && patchDraft({ title: 'Untitled Page' })}
                      aria-label="Page title"
                      placeholder="Untitled Page"
                    />
                    <div className="nb-page-meta">
                      <span>{longDate(draft.updatedAt)}</span>
                      <span className="nb-sep">·</span>
                      <span>{draft.wordCount.toLocaleString()} words</span>
                      <span className="nb-sep">·</span>
                      <span className={`nb-save nb-save-${saveState}${dirty ? ' is-dirty' : ''}`}>{saveLabel}</span>
                      {draft.originalFilename && (
                        <>
                          <span className="nb-sep">·</span>
                          <span>Imported from {draft.originalFilename}</span>
                        </>
                      )}
                    </div>
                    <div className="nb-page-actions">
                      <button
                        type="button"
                        className={`nb-chip${draft.pinned ? ' is-on' : ''}`}
                        onClick={() => patchDraft({ pinned: !draft.pinned })}
                        title={draft.pinned ? 'Unpin page' : 'Pin page to the top'}
                      >
                        {draft.pinned ? '★ Pinned' : '☆ Pin'}
                      </button>
                      <button type="button" className={`nb-chip${showDetails ? ' is-on' : ''}`} aria-expanded={showDetails} onClick={() => setShowDetails(open => !open)}>Page info</button>
                      <button type="button" className="nb-chip" onClick={() => void exportPage()}>Export page</button>
                      <button
                        type="button"
                        className="nb-chip"
                        onClick={() => void downloadBackup(notebookId)}
                        title="Download this whole notebook as one Markdown file"
                      >
                        Export notebook
                      </button>
                      <button
                        type="button"
                        className="nb-chip"
                        onClick={() => setOutlineModal({ notebookId, tag: '' })}
                        title="Compile this notebook's pages into one running document"
                      >
                        Outline
                      </button>
                      <button type="button" className="nb-chip" onClick={() => void savePage(true)}>Save now</button>
                    </div>
                  </div>

                  {showDetails && (
                    <div className="nb-details">
                      <label>
                        <span>Section</span>
                        <select value={draft.sectionId || ''} onChange={event => void movePageToSection(event.target.value)}>
                          {notebookSections.map(section => (
                            <option key={section.id} value={section.id}>{section.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Page type</span>
                        <select value={draft.sourceType} onChange={event => patchDraft({ sourceType: event.target.value })}>
                          {SOURCE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Class date</span>
                        <input
                          type="date"
                          value={draft.classDate || ''}
                          onChange={event => patchDraft({ classDate: event.target.value || null })}
                        />
                      </label>
                      <label>
                        <span>For assignment</span>
                        <select
                          value={draft.taskId || ''}
                          onChange={event => patchDraft({ taskId: event.target.value || null })}
                        >
                          <option value="">Not linked</option>
                          {/* The page's own task stays listed even once the
                              assignment is done and off the shortlist. */}
                          {assignmentChoices.map(task => (
                            <option key={task.id} value={task.id}>
                              {task.course ? `${task.course} — ` : ''}{task.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="nb-details-wide">
                        <span>Tags, separated by commas</span>
                        <input
                          value={draft.topics.join(', ')}
                          onChange={event => patchDraft({
                            topics: event.target.value.split(',').map(item => item.trim()).filter(Boolean),
                          })}
                          placeholder="hearsay, exam, professor emphasis"
                        />
                      </label>
                      <div className="nb-details-actions">
                        <button type="button" className="nb-link-warn" onClick={() => void archivePage()}>Archive page</button>
                        <button type="button" className="nb-link-danger" onClick={() => void deletePage()}>Move to trash</button>
                      </div>
                    </div>
                  )}

                  <RichEditor
                    pageId={draft.id}
                    initialHtml={draft.contentHtml}
                    onChange={html => {
                      htmlRef.current = html;
                      revisionRef.current += 1;
                      dirtyRef.current = true;
                      setDirty(true);
                      setSaveState('idle');
                    }}
                    onSaveNow={() => void savePage(true)}
                    onUploadImage={uploadImage}
                  />
                </>
              )}
            </section>

            {!pageListOpen && (
              <button
                type="button"
                className="nb-pages-reopen"
                title="Show the page list"
                onClick={() => setPageListOpen(true)}
              >
                ‹ Pages
              </button>
            )}

            <aside className="nb-pages">
              <div className="nb-pages-head">
                <div className="nb-pages-title">
                  <span>Pages</span>
                  <button
                    type="button"
                    className="nb-collapse"
                    title="Collapse the page list"
                    aria-label="Collapse the page list"
                    onClick={() => setPageListOpen(false)}
                  >
                    ›
                  </button>
                </div>
                <button type="button" className="nb-primary nb-block" onClick={() => void createPage()}>
                  + New page
                </button>
                <button
                  type="button"
                  className="nb-secondary nb-block"
                  onClick={() => setImportModal({
                    title: '', section: sectionName || 'Notes', classDate: '',
                    sourceType: 'class-notes', topics: '', file: null,
                  })}
                >
                  Import a file
                </button>
                <input
                  className="nb-search"
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Search all notes…"
                  aria-label="Search all notes"
                />
              </div>
              {availableTags.length > 0 && (
                <div className="nb-tag-filter" role="group" aria-label="Filter by tag">
                  {availableTags.map(tag => (
                    <button
                      key={tag}
                      type="button"
                      className={`nb-tag-chip${activeTag === tag ? ' is-active' : ''}`}
                      onClick={() => setActiveTag(current => (current === tag ? '' : tag))}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
              <div className="nb-pages-list">
                {searchResults && (
                  <div className="nb-pages-note">
                    {searchResults.length} result{searchResults.length === 1 ? '' : 's'} across all notebooks
                  </div>
                )}
                {loadingPages ? (
                  <p className="nb-pages-empty">Loading pages…</p>
                ) : visiblePages.length === 0 ? (
                  <p className="nb-pages-empty">
                    {activeTag
                      ? `No pages tagged “${activeTag}” here.`
                      : searchResults ? 'Nothing matched that search.' : 'This section has no pages yet.'}
                  </p>
                ) : visiblePages.map(page => (
                  <button
                    key={page.id}
                    type="button"
                    draggable={!searchResults}
                    onDragStart={() => setDragPageId(page.id)}
                    onDragOver={event => { if (dragPageId) event.preventDefault(); }}
                    onDrop={() => void reorderPages(page.id)}
                    onDragEnd={() => setDragPageId('')}
                    className={`nb-page-item${page.id === pageId ? ' is-active' : ''}${dragPageId === page.id ? ' is-dragging' : ''}`}
                    onClick={() => void (searchResults
                      ? selectTreePage(page.notebookId || '', page.sectionId || '', page.section, page.id)
                      : selectPage(page.id))}
                  >
                    <span className="nb-page-item-title">{page.pinned ? '★ ' : ''}{page.title}</span>
                    <span className="nb-page-item-meta">
                      {searchResults ? `${page.section} · ` : ''}{formatUpdated(page.updatedAt)}
                    </span>
                    <span className="nb-page-item-preview">{page.preview || 'Empty page'}</span>
                  </button>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </div>

      {setAside && (
        <div className="nb-modal-scrim" onMouseDown={event => event.target === event.currentTarget && setSetAside(null)}>
          <div className="nb-modal nb-modal-wide">
            <div className="nb-modal-head">
              <div>
                <h3>Set aside</h3>
                <p>
                  Deleted pages wait {setAside.retentionDays} days before they are thrown out.
                  Archived pages stay until you say otherwise.
                </p>
              </div>
              <button type="button" onClick={() => setSetAside(null)} aria-label="Close">×</button>
            </div>
            <div className="nb-aside-list">
              {[['In the trash', setAside.trashed, true] as const, ['Archived', setAside.archived, false] as const].map(([label, list, purgeable]) => (
                <section key={label}>
                  <div className="nb-aside-head">
                    <span>{label} · {list.length}</span>
                    {purgeable && list.length > 0 && (
                      <button type="button" className="nb-link-danger" onClick={() => void emptyTrash()}>
                        Empty the trash
                      </button>
                    )}
                  </div>
                  {list.length === 0 ? <p className="nb-tree-empty">Nothing here.</p> : list.map(page => (
                    <div key={page.id} className="nb-aside-row">
                      <div className="nb-aside-main">
                        <span className="nb-node-label">{page.title}</span>
                        <span className="nb-node-meta">
                          {page.notebookName || 'Unfiled'} · {page.section}
                          {purgeable && page.deletedAt
                            ? ` · ${daysLeft(page.deletedAt, setAside.retentionDays)}`
                            : ''}
                        </span>
                      </div>
                      <button type="button" className="nb-secondary" onClick={() => void restorePage(page.id)}>Restore</button>
                      {purgeable && (
                        <button type="button" className="nb-link-danger" onClick={() => void purgePage(page.id, page.title)}>Delete forever</button>
                      )}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {outlineModal && (
        <div className="nb-modal-scrim" onMouseDown={event => event.target === event.currentTarget && setOutlineModal(null)}>
          <div className="nb-modal nb-modal-wide">
            <div className="nb-modal-head">
              <div>
                <h3>{outlineData?.notebook.name || 'Outline'}</h3>
                <p>
                  Every page in this notebook, compiled into one running document in tree order.
                  Narrow it to one tag - for example everything you have marked “outline” - or leave
                  it blank for the whole notebook.
                </p>
              </div>
              <button type="button" onClick={() => setOutlineModal(null)} aria-label="Close">×</button>
            </div>
            <div className="nb-outline-controls">
              <input
                value={outlineModal.tag}
                onChange={event => setOutlineModal(current => current && { ...current, tag: event.target.value })}
                placeholder="Filter by tag (optional), e.g. outline"
                aria-label="Filter outline by tag"
              />
              <button type="button" className="nb-secondary" onClick={printOutline} disabled={outlineLoading}>
                Print / Save as PDF
              </button>
            </div>
            <div className="nb-outline-body">
              {outlineLoading ? (
                <p className="nb-pages-empty">Compiling…</p>
              ) : outlineError ? (
                <p className="nb-pages-empty">{outlineError}</p>
              ) : !outlineData || (outlineData.sections.length === 0 && outlineData.unfiled.length === 0) ? (
                <p className="nb-pages-empty">
                  {outlineModal.tag ? `Nothing tagged “${outlineModal.tag}” yet.` : 'This notebook has no pages yet.'}
                </p>
              ) : (
                <>
                  {outlineData.sections.map(section => (
                    <section key={section.id} style={{ marginLeft: section.depth * 16 }}>
                      <h4 className="nb-outline-section-head">{section.name}</h4>
                      {section.pages.map(page => (
                        <article key={page.id} className="nb-outline-page">
                          <h5>{page.title}</h5>
                          {(page.classDate || page.topics.length > 0) && (
                            <p className="nb-outline-meta">
                              {[page.classDate, page.topics.join(', ')].filter(Boolean).join(' · ')}
                            </p>
                          )}
                          <div dangerouslySetInnerHTML={{ __html: page.contentHtml }} />
                        </article>
                      ))}
                    </section>
                  ))}
                  {outlineData.unfiled.length > 0 && (
                    <section>
                      <h4 className="nb-outline-section-head">Unfiled</h4>
                      {outlineData.unfiled.map(page => (
                        <article key={page.id} className="nb-outline-page">
                          <h5>{page.title}</h5>
                          <div dangerouslySetInnerHTML={{ __html: page.contentHtml }} />
                        </article>
                      ))}
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmAsk && (
        <div className="nb-modal-scrim" onMouseDown={event => event.target === event.currentTarget && answerConfirm(false)}>
          <div className="nb-modal" role="alertdialog" aria-labelledby="nb-confirm-title">
            <div className="nb-modal-head">
              <div>
                <h3 id="nb-confirm-title">{confirmAsk.title}</h3>
                <p>{confirmAsk.body}</p>
              </div>
            </div>
            <div className="nb-modal-foot">
              <span />
              <div>
                <button type="button" className="nb-secondary" onClick={() => answerConfirm(false)}>
                  Cancel
                </button>
                <button type="button" className="nb-primary" autoFocus onClick={() => answerConfirm(true)}>
                  {confirmAsk.action}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {conflict && (
        // No scrim dismiss and no close button: leaving this without choosing
        // is how one of the two versions gets lost.
        <div className="nb-modal-scrim">
          <div className="nb-modal nb-modal-wide" role="alertdialog" aria-labelledby="nb-conflict-title">
            <div className="nb-modal-head">
              <div>
                <h3 id="nb-conflict-title">This page changed somewhere else</h3>
                <p>
                  It was saved from another tab or device while you were writing. Both versions are
                  below — pick one, or keep both.
                </p>
              </div>
            </div>
            <div className="nb-conflict">
              <section>
                <div className="nb-aside-head">
                  Yours · not saved yet
                </div>
                <div className="nb-conflict-body" dangerouslySetInnerHTML={{ __html: conflict.myHtml }} />
              </section>
              <section>
                <div className="nb-aside-head">
                  Saved version · {formatUpdated(conflict.theirs.updatedAt)}
                </div>
                <div
                  className="nb-conflict-body"
                  dangerouslySetInnerHTML={{ __html: conflict.theirs.contentHtml || '' }}
                />
              </section>
            </div>
            <div className="nb-modal-foot">
              <button
                type="button"
                className="nb-secondary"
                disabled={savingModal}
                onClick={() => void resolveConflict('theirs')}
              >
                Discard mine
              </button>
              <div>
                <button
                  type="button"
                  className="nb-secondary"
                  disabled={savingModal}
                  onClick={() => void resolveConflict('both')}
                >
                  Keep both
                </button>
                <button
                  type="button"
                  className="nb-primary"
                  disabled={savingModal}
                  onClick={() => void resolveConflict('mine')}
                >
                  {savingModal ? 'Saving…' : 'Keep mine'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {notebookModal && (
        <NotebookModal
          form={notebookModal}
          saving={savingModal}
          semesterChoices={semesterChoices}
          onChange={setNotebookModal}
          onSubmit={saveNotebook}
          onClose={() => setNotebookModal(null)}
          onDelete={notebookModal.id ? deleteNotebook : null}
        />
      )}

      {sectionModal && (
        <div className="nb-modal-scrim" onMouseDown={event => event.target === event.currentTarget && setSectionModal(null)}>
          <form className="nb-modal" onSubmit={saveSection}>
            <div className="nb-modal-head">
              <h3>{sectionModal.id ? 'Section settings' : 'New section'}</h3>
              <button type="button" onClick={() => setSectionModal(null)} aria-label="Close">×</button>
            </div>
            <label className="nb-field">
              <span>Section name</span>
              <input
                required
                autoFocus
                value={sectionModal.name}
                onChange={event => setSectionModal({ ...sectionModal, name: event.target.value })}
                placeholder="Hearsay"
              />
            </label>
            <label className="nb-field">
              <span>Sits under</span>
              <select
                value={sectionModal.parentId || ''}
                onChange={event => setSectionModal({ ...sectionModal, parentId: event.target.value || null })}
              >
                <option value="">Top level of {activeNotebook?.name || 'this notebook'}</option>
                {sectionParentOptions.map(option => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="nb-field">
              <span>Tab colour</span>
              <div className="nb-color-row">
                {SECTION_COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    className={`nb-color-dot${sectionModal.color === color ? ' is-on' : ''}`}
                    style={{ background: color }}
                    aria-label={`Use colour ${color}`}
                    onClick={() => setSectionModal({ ...sectionModal, color })}
                  />
                ))}
              </div>
            </div>
            <div className="nb-modal-foot">
              {sectionModal.id
                ? <button type="button" className="nb-link-danger" onClick={() => void deleteSection()}>Delete section</button>
                : <span />}
              <div>
                <button type="button" className="nb-secondary" onClick={() => setSectionModal(null)}>Cancel</button>
                <button className="nb-primary" disabled={savingModal}>{savingModal ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {importModal && (
        <div className="nb-modal-scrim" onMouseDown={event => event.target === event.currentTarget && setImportModal(null)}>
          <form className="nb-modal nb-modal-wide" onSubmit={importFile}>
            <div className="nb-modal-head">
              <div>
                <h3>Import into {activeNotebook?.name}</h3>
                <p>PDF, DOCX, TXT or Markdown. The text becomes an editable page.</p>
              </div>
              <button type="button" onClick={() => setImportModal(null)} aria-label="Close">×</button>
            </div>
            <label className="nb-field">
              <span>File</span>
              <input
                required
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain"
                onChange={event => setImportModal({ ...importModal, file: event.target.files?.[0] || null })}
              />
            </label>
            <label className="nb-field">
              <span>Page title</span>
              <input
                value={importModal.title}
                onChange={event => setImportModal({ ...importModal, title: event.target.value })}
                placeholder="Uses the file name when blank"
              />
            </label>
            <div className="nb-field-grid">
              <label className="nb-field">
                <span>Section</span>
                <select
                  value={importModal.section}
                  onChange={event => setImportModal({ ...importModal, section: event.target.value })}
                >
                  {notebookSections.map(section => (
                    <option key={section.id} value={section.name}>{section.name}</option>
                  ))}
                </select>
              </label>
              <label className="nb-field">
                <span>Type</span>
                <select
                  value={importModal.sourceType}
                  onChange={event => setImportModal({ ...importModal, sourceType: event.target.value })}
                >
                  {SOURCE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="nb-field">
                <span>Class date</span>
                <input
                  type="date"
                  value={importModal.classDate}
                  onChange={event => setImportModal({ ...importModal, classDate: event.target.value })}
                />
              </label>
              <label className="nb-field">
                <span>Tags</span>
                <input
                  value={importModal.topics}
                  onChange={event => setImportModal({ ...importModal, topics: event.target.value })}
                  placeholder="hearsay, week 3"
                />
              </label>
            </div>
            <div className="nb-modal-foot">
              <span />
              <div>
                <button type="button" className="nb-secondary" onClick={() => setImportModal(null)}>Cancel</button>
                <button className="nb-primary" disabled={savingModal}>{savingModal ? 'Importing…' : 'Import as page'}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      <NotesStyles />
    </main>
  );
}

function NotebookModal({ form, saving, semesterChoices, onChange, onSubmit, onClose, onDelete }: {
  form: NotebookForm;
  saving: boolean;
  semesterChoices: string[];
  onChange: (next: NotebookForm) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  onDelete: null | (() => void | Promise<void>);
}) {
  return (
    <div className="nb-modal-scrim" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <form className="nb-modal" onSubmit={onSubmit}>
        <div className="nb-modal-head">
          <div>
            <h3>{form.id ? 'Notebook settings' : 'New notebook'}</h3>
            <p>One notebook per course, grouped by semester.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <label className="nb-field">
          <span>Notebook or course name</span>
          <input
            required
            autoFocus
            value={form.name}
            onChange={event => onChange({ ...form, name: event.target.value })}
            placeholder="Evidence"
          />
        </label>
        <label className="nb-field">
          <span>Semester</span>
          <select
            value={form.semester}
            onChange={event => onChange({ ...form, semester: event.target.value })}
          >
            <option value="">Unsorted</option>
            {semesterChoices.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className="nb-field">
          <span>Colour</span>
          <div className="nb-color-row">
            {SECTION_COLORS.map(color => (
              <button
                key={color}
                type="button"
                className={`nb-color-dot${form.color === color ? ' is-on' : ''}`}
                style={{ background: color }}
                aria-label={`Use colour ${color}`}
                onClick={() => onChange({ ...form, color })}
              />
            ))}
          </div>
        </div>
        <div className="nb-modal-foot">
          {onDelete
            ? <button type="button" className="nb-link-danger" onClick={() => void onDelete()}>Delete notebook</button>
            : <span />}
          <div>
            <button type="button" className="nb-secondary" onClick={onClose}>Cancel</button>
            <button className="nb-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
