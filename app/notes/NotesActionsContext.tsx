'use client';

import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

type RegisteredActions = {
  create: () => Promise<void>;
  /** Resolves to whether a page was actually moved to trash (false if cancelled). */
  remove: () => Promise<boolean>;
};

type DeleteNotice = {
  title: string;
};

type NotesActionsValue = {
  registerActions: (actions: RegisteredActions) => void;
  setCanDelete: (available: boolean) => void;
  canDelete: boolean;
  busy: 'create' | 'delete' | null;
  deletedNotice: DeleteNotice | null;
  clearDeletedNotice: () => void;
  runCreate: () => Promise<void>;
  runDelete: () => Promise<void>;
};

const NotesActionsContext = createContext<NotesActionsValue | null>(null);

export function NotesActionsProvider({ children }: { children: ReactNode }) {
  const actionsRef = useRef<RegisteredActions | null>(null);
  const busyRef = useRef<'create' | 'delete' | null>(null);
  const [canDelete, setCanDeleteState] = useState(false);
  const [busy, setBusy] = useState<'create' | 'delete' | null>(null);
  const [deletedNotice, setDeletedNotice] = useState<DeleteNotice | null>(null);

  const registerActions = useCallback((actions: RegisteredActions) => {
    actionsRef.current = actions;
  }, []);
  const setCanDelete = useCallback((available: boolean) => setCanDeleteState(available), []);
  const clearDeletedNotice = useCallback(() => setDeletedNotice(null), []);

  const run = useCallback(async (kind: 'create' | 'delete') => {
    if (busyRef.current) return;
    const actions = actionsRef.current;
    if (!actions) throw new Error('Notes are still loading. Try again in a moment.');

    // Read before the delete runs: the title input (and the page itself)
    // is gone from the DOM by the time `remove()` resolves.
    const beforeTitle = kind === 'delete'
      ? document.querySelector<HTMLInputElement>('.nb-page-title')?.value.trim() || 'Page'
      : '';

    if (kind === 'create') setDeletedNotice(null);
    busyRef.current = kind;
    setBusy(kind);
    try {
      if (kind === 'create') {
        await actions.create();
      } else {
        // `remove()` reports whether a page was actually moved to trash, so
        // a cancelled confirmation cannot be mistaken for a real deletion -
        // no DOM inspection required.
        const deleted = await actions.remove();
        if (deleted) setDeletedNotice({ title: beforeTitle });
      }
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }, []);
  const runCreate = useCallback(() => run('create'), [run]);
  const runDelete = useCallback(() => run('delete'), [run]);
  const value = useMemo<NotesActionsValue>(() => ({
    registerActions,
    setCanDelete,
    canDelete,
    busy,
    deletedNotice,
    clearDeletedNotice,
    runCreate,
    runDelete,
  }), [
    registerActions,
    setCanDelete,
    canDelete,
    busy,
    deletedNotice,
    clearDeletedNotice,
    runCreate,
    runDelete,
  ]);
  return <NotesActionsContext.Provider value={value}>{children}</NotesActionsContext.Provider>;
}

export function useNotesActions(): NotesActionsValue {
  const value = useContext(NotesActionsContext);
  if (!value) throw new Error('useNotesActions must be used inside NotesActionsProvider.');
  return value;
}
