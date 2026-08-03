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
