'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NotesActionsProvider, useNotesActions } from './NotesActionsContext';
import PasteOptions from './PasteOptions';

const NOTES_FOCUS_KEY = 'notesFocusMode';

function NotesHeaderActions() {
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
  const [message, setMessage] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const { canDelete, busy, deletedNotice, runCreate, runDelete } = useNotesActions();

  useEffect(() => setActionsHost(document.querySelector<HTMLElement>('.lst-actions')), []);

  useEffect(() => {
    let enabled = false;
    try { enabled = window.localStorage.getItem(NOTES_FOCUS_KEY) === '1'; } catch {}
    setFocusMode(enabled);
    document.body.classList.toggle('notes-focus-mode', enabled);
    return () => document.body.classList.remove('notes-focus-mode');
  }, []);

  function toggleFocusMode() {
    setFocusMode(current => {
      const next = !current;
      document.body.classList.toggle('notes-focus-mode', next);
      try { window.localStorage.setItem(NOTES_FOCUS_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  }

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
      <button
        type="button"
        className={`notes-header-focus${focusMode ? ' is-on' : ''}`}
        aria-pressed={focusMode}
        title={focusMode
          ? 'Restore the notebook tree and page list'
          : 'Hide the notebook tree and page list so the note uses the full workspace'}
        onClick={toggleFocusMode}
      >
        {focusMode ? 'Restore panels ⤡' : 'Expand notes ⤢'}
      </button>
      {canDelete && !deletedNotice ? (
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

function DeletedPageState() {
  const [canvasHost, setCanvasHost] = useState<HTMLElement | null>(null);
  const { deletedNotice, clearDeletedNotice, busy, runCreate } = useNotesActions();

  useEffect(() => {
    if (!deletedNotice) {
      setCanvasHost(null);
      document.body.classList.remove('notes-awaiting-page-selection');
      return;
    }

    setCanvasHost(document.querySelector<HTMLElement>('.nb-canvas-column'));
    document.body.classList.add('notes-awaiting-page-selection');

    const chooseAnotherPage = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(
        '.nb-page-item, .nb-node-page, .nb-page-title, [contenteditable="true"], .nb-page-head button',
      )) {
        clearDeletedNotice();
      }
    };
    document.addEventListener('click', chooseAnotherPage, true);
    document.addEventListener('focusin', chooseAnotherPage, true);
    return () => {
      document.removeEventListener('click', chooseAnotherPage, true);
      document.removeEventListener('focusin', chooseAnotherPage, true);
      document.body.classList.remove('notes-awaiting-page-selection');
    };
  }, [deletedNotice, clearDeletedNotice]);

  if (!deletedNotice || !canvasHost) return null;
  return createPortal(
    <div className="notes-deleted-state" role="status" aria-live="polite">
      <div className="notes-deleted-card">
        <span className="notes-deleted-kicker">Moved to Trash</span>
        <h2>{deletedNotice.title}</h2>
        <p>The page was removed. Select another page from the page list or notebook tree.</p>
        <button type="button" className="nb-primary" disabled={busy !== null}
          onClick={() => void runCreate()}>
          {busy === 'create' ? 'Creating…' : 'Create a new page'}
        </button>
      </div>
    </div>,
    canvasHost,
  );
}

export default function NotesLayout({ children }: { children: ReactNode }) {
  return (
    <NotesActionsProvider>
      {children}
      <style jsx global>{`
        body[data-route='/notes'] .lst-actions > a.lst-add { display: none !important; }
        .notes-header-focus { min-height:34px; display:inline-flex; align-items:center; justify-content:center; padding:8px 12px; border:1px solid var(--btn); border-radius:7px; background:var(--s2); color:var(--text2); font-weight:600; white-space:nowrap; cursor:pointer; }
        .notes-header-focus:hover { border-color:var(--hover); background:var(--s3); color:var(--text); }
        .notes-header-focus.is-on { border-color:var(--blue); color:var(--blue2); background:rgba(75,146,219,.12); }
        .notes-header-delete { min-height:34px; display:inline-flex; align-items:center; justify-content:center; padding:8px 12px; border:1px solid var(--red); border-radius:7px; background:transparent; color:var(--red2); font-weight:600; white-space:nowrap; cursor:pointer; }
        .notes-header-delete:hover { background:rgba(201,85,61,.14); }
        .notes-header-delete:disabled,.notes-header-add:disabled { opacity:.55; cursor:wait; }
        .notes-header-message { max-width:250px; color:var(--red2); font-size:11px; line-height:1.25; text-align:right; }
        .nb-canvas-column { position:relative; }
        .notes-deleted-state { position:absolute; inset:0; z-index:60; display:grid; place-items:center; padding:32px; background:var(--bg); pointer-events:none; }
        .notes-deleted-card { width:min(460px,100%); padding:28px; border:1px solid var(--line2); border-radius:12px; background:var(--s1); text-align:center; pointer-events:auto; }
        .notes-deleted-card h2 { margin:8px 0; font-size:24px; }
        .notes-deleted-card p { margin:0 auto 20px; max-width:360px; color:var(--muted); }
        .notes-deleted-kicker { color:var(--green2); font:500 10px/1 'IBM Plex Mono',monospace; letter-spacing:.12em; text-transform:uppercase; }
        body.notes-awaiting-page-selection .nb-page-item.is-active,
        body.notes-awaiting-page-selection .nb-node-page.is-active { background:transparent!important; box-shadow:none!important; }

        /* One-click wide editor mode. The Notes page already has independent
           tree/page-list toggles; this deliberately sits above them and hides
           both side panels without changing their saved open/closed state. */
        body.notes-focus-mode .nb-frame { grid-template-columns:minmax(0,1fr)!important; }
        body.notes-focus-mode .nb-rail { display:none!important; }
        body.notes-focus-mode .nb-workspace { grid-template-columns:minmax(0,1fr)!important; }
        body.notes-focus-mode .nb-pages,
        body.notes-focus-mode .nb-pages-reopen { display:none!important; }
        body.notes-focus-mode .nb-tabbar .nb-rail-toggle,
        body.notes-focus-mode .nb-tabbar > .nb-tab-settings:last-child { display:none!important; }

        @media(max-width:760px){.notes-header-message{display:none}.notes-header-focus,.notes-header-delete{padding-inline:9px;font-size:12px}.notes-deleted-state{padding:18px}}
        @media(max-width:520px){.notes-header-focus{width:34px;padding:0;font-size:0}.notes-header-focus::before{content:'⤢';font-size:17px}.notes-header-focus.is-on::before{content:'⤡'}.notes-header-delete{width:34px;padding:0;font-size:0}.notes-header-delete::before{content:'⌫';font-size:17px}}
      `}</style>
      <NotesHeaderActions />
      <DeletedPageState />
      <PasteOptions />
    </NotesActionsProvider>
  );
}
