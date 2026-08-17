'use client';

import { useEffect, useState } from 'react';
import { SYNC_STATUS_EVENT, type SyncState } from '@/lib/apiClient';

type State = 'online' | 'offline' | 'checking' | 'syncing' | 'unsynced';

export default function ConnectivityStatus() {
  const [state, setState] = useState<State>('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const connectivity = () => {
      if (!navigator.onLine) setState('offline');
      else setState(prev => prev === 'unsynced' ? prev : 'online');
    };
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: SyncState; message?: string }>).detail || {};
      if (!navigator.onLine) { setState('offline'); return; }
      if (detail.state === 'syncing') { setState('syncing'); setMessage(''); }
      else if (detail.state === 'unsynced') { setState('unsynced'); setMessage(detail.message || 'A change was not saved.'); }
      else if (detail.state === 'online') { setState('online'); setMessage(''); }
    };
    connectivity();
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    window.addEventListener(SYNC_STATUS_EVENT, sync as EventListener);
    return () => {
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      window.removeEventListener(SYNC_STATUS_EVENT, sync as EventListener);
    };
  }, []);

  if (state === 'checking' || state === 'online') return null;
  const offline = state === 'offline';
  const syncing = state === 'syncing';
  const title = offline ? 'Offline' : syncing ? 'Saving…' : 'Unsynced change';
  const copy = offline
    ? 'Cached pages may still open, but changes are not saved until the server is reachable.'
    : syncing
      ? 'Sending the latest change to the server.'
      : message || 'A change was not saved. Reconnect or retry the action.';
  return <div role="status" aria-live="polite" className={`fixed bottom-4 right-4 z-[1900] max-w-sm rounded-lg border px-3 py-2 text-xs shadow-xl ${syncing ? 'border-blue-500/30 bg-[#0b1727] text-blue-100' : 'border-amber-500/40 bg-[#17130a] text-amber-100'}`}>
    <div className="font-medium">{title}</div><div className="mt-0.5 opacity-75">{copy}</div>
  </div>;
}
