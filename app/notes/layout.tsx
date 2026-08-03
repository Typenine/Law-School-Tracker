'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const sleep = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

function exactButton(label: string, root: ParentNode = document): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent?.replace(/\s+/g, ' ').trim() === label) || null;
}

async function waitForButton(label: string, root: ParentNode = document): Promise<HTMLButtonElement | null> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const button = exactButton(label, root);
    if (button) return button;
    await sleep(100);
  }
  return null;
}

/**
 * The Notes page owns the real create/delete logic. These header controls call
 * those same controls rather than maintaining a second copy of the data logic.
 * That makes the prominent app-header actions do exactly what the visible page
 * actions do, including the existing confirmation, autosave and trash flow.
 */
export default function NotesLayout({ children }: { children: ReactNode }) {
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState<'add' | 'delete' | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setActionsHost(document.querySelector<HTMLElement>('.lst-actions'));

    const update = () => setNoteOpen(Boolean(document.querySelector('.nb-page-title')));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  async function addNote() {
    if (busy) return;
    setBusy('add');
    setMessage('');
    try {
      // The page-list button is present even while that panel is collapsed.
      // When there is no page yet, the empty-state button is available instead.
      const button = await waitForButton('+ New page') || await waitForButton('New page');
      if (!button) {
        const createNotebook = exactButton('Create a notebook')
          || document.querySelector<HTMLButtonElement>('button[title="New notebook"]');
        if (createNotebook) {
          createNotebook.click();
          setMessage('Create a notebook first, then Add notes will create a page in it.');
        } else {
          setMessage('Notes are still loading. Try Add notes again in a moment.');
        }
        return;
      }

      button.click();
      for (let attempt = 0; attempt < 80; attempt++) {
        const title = document.querySelector<HTMLInputElement>('.nb-page-title');
        if (title) {
          title.focus();
          title.select();
          return;
        }
        await sleep(100);
      }
      setMessage('The new note request did not finish. No existing note was changed.');
    } finally {
      setBusy(null);
    }
  }

  async function deleteNote() {
    if (busy) return;
    setBusy('delete');
    setMessage('');
    try {
      if (!document.querySelector('.nb-page-title')) {
        setMessage('Open a note before deleting it.');
        return;
      }

      const pageActions = document.querySelector('.nb-page-actions') || document;
      const pageInfo = exactButton('Page info', pageActions);
      let deleteButton = exactButton(
        'Move to trash',
        document.querySelector('.nb-details-actions') || document,
      );
      if (!deleteButton) {
        if (!pageInfo) {
          setMessage('The note controls are not ready yet. Try again in a moment.');
          return;
        }
        pageInfo.click();
        deleteButton = await waitForButton(
          'Move to trash',
          document.querySelector('.nb-details-actions') || document,
        );
      }

      if (!deleteButton) {
        setMessage('The delete control could not be opened. The note was not changed.');
        return;
      }
      // This opens the Notes page's in-app confirmation. Nothing is removed
      // until the user explicitly confirms Move to trash there.
      deleteButton.click();

      // The details panel is only an implementation path to the existing trash
      // action. Do not leave it open after invoking the visible header control.
      if (pageInfo && document.querySelector('.nb-details')) pageInfo.click();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {children}
      <style jsx global>{`
        body[data-route='/notes'] .lst-actions > a.lst-add { display: none !important; }
        .notes-header-delete {
          min-height: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 8px 12px;
          border: 1px solid var(--red);
          border-radius: 7px;
          background: transparent;
          color: var(--red2);
          font-weight: 600;
          white-space: nowrap;
          cursor: pointer;
        }
        .notes-header-delete:hover { background: rgba(201,85,61,.14); }
        .notes-header-delete:disabled, .notes-header-add:disabled { opacity: .55; cursor: wait; }
        .notes-header-message {
          max-width: 250px;
          color: var(--red2);
          font-size: 11px;
          line-height: 1.25;
          text-align: right;
        }
        @media (max-width: 760px) {
          .notes-header-message { display: none; }
          .notes-header-delete { padding-inline: 9px; font-size: 12px; }
        }
        @media (max-width: 520px) {
          .notes-header-delete { width: 34px; padding: 0; font-size: 0; }
          .notes-header-delete::before { content: '⌫'; font-size: 17px; }
        }
      `}</style>
      {actionsHost && createPortal(
        <>
          {message ? <span className="notes-header-message" role="status">{message}</span> : null}
          {noteOpen ? (
            <button
              type="button"
              className="notes-header-delete"
              aria-label="Delete note"
              title="Move the open note to trash"
              disabled={busy !== null}
              onClick={() => void deleteNote()}
            >
              {busy === 'delete' ? 'Opening…' : 'Delete note'}
            </button>
          ) : null}
          <button
            type="button"
            className="lst-add notes-header-add"
            aria-label="Add notes"
            disabled={busy !== null}
            onClick={() => void addNote()}
          >
            {busy === 'add' ? 'Adding…' : 'Add notes'}
          </button>
        </>,
        actionsHost,
      )}
    </>
  );
}
