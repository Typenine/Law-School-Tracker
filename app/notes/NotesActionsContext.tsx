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
