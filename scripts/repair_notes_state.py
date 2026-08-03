from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{label}: start marker not found")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{label}: end marker not found")
    return text[:start_index] + replacement + text[end_index:]


root = Path.cwd()
page_path = root / "app/notes/page.tsx"
test_path = root / "tests/notes-ui.test.py"
page = page_path.read_text()

page = replace_once(
    page,
    "import NotesTree, { notebookKey, sectionKey, semesterKey } from './NotesTree';\n",
    "import NotesTree, { notebookKey, sectionKey, semesterKey } from './NotesTree';\nimport { useNotesActions } from './NotesActionsContext';\n",
    "Notes actions import",
)
page = replace_once(
    page,
    "  const [pageListOpen, setPageListOpen] = useState(false);",
    "  const [pageListOpen, setPageListOpen] = useState(true);",
    "OneNote-style page pane default",
)
page = replace_once(
    page,
    "  const { term } = useTerm();\n",
    "  const { term } = useTerm();\n  const { registerActions, setCanDelete } = useNotesActions();\n",
    "Notes actions hook",
)
page = replace_once(
    page,
    "  const retryTimerRef = useRef<number | null>(null);\n",
    "  const retryTimerRef = useRef<number | null>(null);\n"
    "  const creatingPageRef = useRef(false);\n"
    "  const deletingPageRef = useRef(false);\n"
    "  const pageListRequestRef = useRef(0);\n"
    "  const openPageRequestRef = useRef(0);\n"
    "  const notebookRequestRef = useRef<Record<string, number>>({});\n"
    "  const notesMutationVersionRef = useRef(0);\n",
    "Notes synchronization refs",
)

load_pages = '''  const loadPages = useCallback(async (
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
'''
page = replace_between(page, "  const loadPages = useCallback(async (", "\n\n  const openPage = useCallback", load_pages, "Current section page loading")

open_page = '''  const openPage = useCallback(async (id: string) => {
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
'''
page = replace_between(page, "  const openPage = useCallback(async (id: string) => {", "\n\n  // ------------------------------------------------------------------ saving", open_page, "Open page request ordering")

load_notebook_pages = '''  /** Load a notebook's pages once, so its sections can list them. */
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
'''
page = replace_between(page, "  /** Load a notebook's pages once, so its sections can list them. */", "\n\n  const toggleNode", load_notebook_pages, "Notebook tree page loading")

create_page = '''  async function createPage(
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
'''
page = replace_between(page, "  async function createPage(\n", "\n\n  /** Re-read a notebook's pages after something changes them. */", create_page, "Create page mutation")

refresh_notebook = '''  /** Re-read a notebook's pages after something changes them. */
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
'''
page = replace_between(page, "  /** Re-read a notebook's pages after something changes them. */", "\n\n  async function saveNotebook", refresh_notebook, "Notebook tree reconciliation")

delete_page = '''  async function deletePage() {
    const current = draftRef.current;
    if (!current || deletingPageRef.current) return;

    deletingPageRef.current = true;
    try {
      if (!await ask(
        'Move to trash?',
        `“${current.title}” goes to the trash. You can restore it from Set aside.`,
        'Move to trash',
      )) return;

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the page.');
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
'''
page = replace_between(page, "  async function deletePage() {", "\n\n  async function importFile", delete_page, "Delete page mutation and header registration")
page = replace_once(page, "      const restored = data.note as Page;\n", "      const restored = data.note as Page;\n      notesMutationVersionRef.current += 1;\n", "Restore invalidates stale lists")
page_path.write_text(page)

(root / "app/notes/NotesActionsContext.tsx").write_text('''\
'use client';

import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

type RegisteredActions = {
  create: () => Promise<void>;
  remove: () => Promise<void>;
};

type NotesActionsValue = {
  registerActions: (actions: RegisteredActions) => void;
  setCanDelete: (available: boolean) => void;
  canDelete: boolean;
  busy: 'create' | 'delete' | null;
  runCreate: () => Promise<void>;
  runDelete: () => Promise<void>;
};

const NotesActionsContext = createContext<NotesActionsValue | null>(null);

export function NotesActionsProvider({ children }: { children: ReactNode }) {
  const actionsRef = useRef<RegisteredActions | null>(null);
  const busyRef = useRef<'create' | 'delete' | null>(null);
  const [canDelete, setCanDeleteState] = useState(false);
  const [busy, setBusy] = useState<'create' | 'delete' | null>(null);

  const registerActions = useCallback((actions: RegisteredActions) => {
    actionsRef.current = actions;
  }, []);
  const setCanDelete = useCallback((available: boolean) => setCanDeleteState(available), []);
  const run = useCallback(async (kind: 'create' | 'delete') => {
    if (busyRef.current) return;
    const actions = actionsRef.current;
    if (!actions) throw new Error('Notes are still loading. Try again in a moment.');
    busyRef.current = kind;
    setBusy(kind);
    try {
      if (kind === 'create') await actions.create();
      else await actions.remove();
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }, []);
  const runCreate = useCallback(() => run('create'), [run]);
  const runDelete = useCallback(() => run('delete'), [run]);
  const value = useMemo<NotesActionsValue>(() => ({
    registerActions, setCanDelete, canDelete, busy, runCreate, runDelete,
  }), [registerActions, setCanDelete, canDelete, busy, runCreate, runDelete]);
  return <NotesActionsContext.Provider value={value}>{children}</NotesActionsContext.Provider>;
}

export function useNotesActions(): NotesActionsValue {
  const value = useContext(NotesActionsContext);
  if (!value) throw new Error('useNotesActions must be used inside NotesActionsProvider.');
  return value;
}
''')

(root / "app/notes/layout.tsx").write_text('''\
'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NotesActionsProvider, useNotesActions } from './NotesActionsContext';

function NotesHeaderActions() {
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
  const [message, setMessage] = useState('');
  const { canDelete, busy, runCreate, runDelete } = useNotesActions();
  useEffect(() => setActionsHost(document.querySelector<HTMLElement>('.lst-actions')), []);

  async function perform(action: 'create' | 'delete') {
    setMessage('');
    try {
      if (action === 'create') await runCreate();
      else await runDelete();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'The note action failed.');
    }
  }
  if (!actionsHost) return null;
  return createPortal(
    <>
      {message ? <span className="notes-header-message" role="status">{message}</span> : null}
      {canDelete ? (
        <button type="button" className="notes-header-delete" aria-label="Delete note"
          title="Move the open note to trash" disabled={busy !== null}
          onClick={() => void perform('delete')}>
          {busy === 'delete' ? 'Deleting…' : 'Delete note'}
        </button>
      ) : null}
      <button type="button" className="lst-add notes-header-add" aria-label="Add notes"
        disabled={busy !== null} onClick={() => void perform('create')}>
        {busy === 'create' ? 'Adding…' : 'Add notes'}
      </button>
    </>,
    actionsHost,
  );
}

export default function NotesLayout({ children }: { children: ReactNode }) {
  return (
    <NotesActionsProvider>
      {children}
      <style jsx global>{`
        body[data-route='/notes'] .lst-actions > a.lst-add { display: none !important; }
        .notes-header-delete { min-height:34px; display:inline-flex; align-items:center; justify-content:center; padding:8px 12px; border:1px solid var(--red); border-radius:7px; background:transparent; color:var(--red2); font-weight:600; white-space:nowrap; cursor:pointer; }
        .notes-header-delete:hover { background:rgba(201,85,61,.14); }
        .notes-header-delete:disabled,.notes-header-add:disabled { opacity:.55; cursor:wait; }
        .notes-header-message { max-width:250px; color:var(--red2); font-size:11px; line-height:1.25; text-align:right; }
        @media(max-width:760px){.notes-header-message{display:none}.notes-header-delete{padding-inline:9px;font-size:12px}}
        @media(max-width:520px){.notes-header-delete{width:34px;padding:0;font-size:0}.notes-header-delete::before{content:'⌫';font-size:17px}}
      `}</style>
      <NotesHeaderActions />
    </NotesActionsProvider>
  );
}
''')

tests = test_path.read_text()
old_header_test = '''        # The prominent app-header controls are the controls a user actually
        # sees first. Add notes must create and open a page; Delete note must be
        # visible, cancellable, and then move that exact page to the trash.
        before_count = len(notes_in_notebook(request, main_book['id']))
        header_add = page.locator('.lst-actions').get_by_role('button', name='Add notes')
        expect(header_add).to_be_visible(timeout=10_000)
        header_add.click()
        for _ in range(100):
            if len(notes_in_notebook(request, main_book['id'])) == before_count + 1:
                break
            time.sleep(.1)
        assert len(notes_in_notebook(request, main_book['id'])) == before_count + 1

        header_title = f'Header Action Audit {STAMP}'
        title.fill(header_title)
        expect(page.get_by_text('All changes saved')).to_be_visible(timeout=10_000)
        header_note = find_note(request, header_title)

        header_delete = page.locator('.lst-actions').get_by_role('button', name='Delete note')
        expect(header_delete).to_be_visible(timeout=10_000)
        header_delete.click()
        confirm = page.get_by_role('alertdialog')
        expect(confirm).to_contain_text('Move to trash?')
        confirm.get_by_role('button', name='Cancel').click()
        expect(title).to_have_value(header_title)

        header_delete.click()
        confirm = page.get_by_role('alertdialog')
        confirm.get_by_role('button', name='Move to trash').click()
        expect(title).not_to_have_value(header_title, timeout=10_000)
        for _ in range(100):
            remaining_ids = {item['id'] for item in notes_in_notebook(request, main_book['id'])}
            if header_note['id'] not in remaining_ids:
                break
            time.sleep(.1)
        assert header_note['id'] not in {item['id'] for item in notes_in_notebook(request, main_book['id'])}
'''
new_header_test = '''        # OneNote keeps the page pane visible and every mutation appears in both
        # navigation surfaces immediately. Three synchronous clicks must still
        # create exactly one page, not three parallel requests.
        pages_panel = page.locator('.nb-pages')
        expect(pages_panel).to_be_visible()
        before_count = len(notes_in_notebook(request, main_book['id']))
        header_add = page.locator('.lst-actions').get_by_role('button', name='Add notes')
        expect(header_add).to_be_visible(timeout=10_000)
        header_add.evaluate('(button) => { button.click(); button.click(); button.click(); }')
        for _ in range(100):
            if len(notes_in_notebook(request, main_book['id'])) == before_count + 1:
                break
            time.sleep(.1)
        page.wait_for_timeout(750)
        assert len(notes_in_notebook(request, main_book['id'])) == before_count + 1

        header_title = f'Header Action Audit {STAMP}'
        title.fill(header_title)
        expect(page.get_by_text('All changes saved')).to_be_visible(timeout=10_000)
        header_note = find_note(request, header_title)
        tree_row = page.locator('.nb-tree .nb-node-page').filter(has_text=header_title)
        page_row = pages_panel.locator('.nb-page-item').filter(has_text=header_title)
        expect(tree_row).to_be_visible(timeout=10_000)
        expect(page_row).to_be_visible(timeout=10_000)

        header_delete = page.locator('.lst-actions').get_by_role('button', name='Delete note')
        expect(header_delete).to_be_visible(timeout=10_000)
        header_delete.click()
        confirm = page.get_by_role('alertdialog')
        expect(confirm).to_contain_text('Move to trash?')
        confirm.get_by_role('button', name='Cancel').click()
        expect(title).to_have_value(header_title)
        expect(tree_row).to_be_visible()
        expect(page_row).to_be_visible()

        header_delete.click()
        confirm = page.get_by_role('alertdialog')
        confirm.get_by_role('button', name='Move to trash').click()
        expect(title).not_to_have_value(header_title, timeout=10_000)
        expect(tree_row).to_be_hidden(timeout=10_000)
        expect(page_row).to_be_hidden(timeout=10_000)
        for _ in range(100):
            remaining_ids = {item['id'] for item in notes_in_notebook(request, main_book['id'])}
            if header_note['id'] not in remaining_ids:
                break
            time.sleep(.1)
        assert header_note['id'] not in {item['id'] for item in notes_in_notebook(request, main_book['id'])}
'''
tests = replace_once(tests, old_header_test, new_header_test, "Header mutation browser test")
old_pages_test = '''        # Pages/Focus and the reopen tab show and hide the list predictably.
        page.get_by_role('button', name=re.compile(r'^Pages')).click()
        pages_panel = page.locator('.nb-pages')
        expect(pages_panel).to_be_visible()
        page.get_by_role('button', name=re.compile(r'^Focus')).click()
        expect(pages_panel).to_be_hidden()
        page.get_by_role('button', name='‹ Pages').click()
        expect(pages_panel).to_be_visible()
'''
new_pages_test = '''        # The page pane starts visible like OneNote; Focus hides it and the
        # persistent reopen tab brings it back.
        pages_panel = page.locator('.nb-pages')
        expect(pages_panel).to_be_visible()
        page.get_by_role('button', name=re.compile(r'^Focus')).click()
        expect(pages_panel).to_be_hidden()
        page.get_by_role('button', name='‹ Pages').click()
        expect(pages_panel).to_be_visible()
'''
tests = replace_once(tests, old_pages_test, new_pages_test, "Page pane browser test")
test_path.write_text(tests)
print('Applied consolidated Notes state synchronization repair.')
