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

  if (state === 'checking') return null;

  const title = state === 'online'
    ? 'Online'
    : state === 'offline'
      ? 'Offline'
      : state === 'syncing'
        ? 'Syncing'
        : 'Unsynced changes';

  const copy = state === 'offline'
    ? 'Cached pages may still open, but changes are not saved until the server is reachable.'
    : state === 'syncing'
      ? 'Sending the latest change to the server.'
      : state === 'unsynced'
        ? (message || 'A change was not saved. Reconnect or retry the action.')
        : '';

  const tone = state === 'online'
    ? 'border-emerald-500/20 bg-[#0b1727]/90 text-emerald-200'
    : state === 'syncing'
      ? 'border-blue-500/30 bg-[#0b1727] text-blue-100'
      : 'border-amber-500/40 bg-[#17130a] text-amber-100';

  return <div role="status" aria-live="polite" className={`fixed bottom-4 right-4 z-[1900] max-w-sm rounded-lg border px-3 py-2 text-xs shadow-xl ${tone}`}>
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${state === 'online' ? 'bg-emerald-400' : state === 'syncing' ? 'bg-blue-400 animate-pulse' : 'bg-amber-400'}`} />
      <span className="font-medium">{title}</span>
    </div>
    {copy ? <div className="mt-0.5 opacity-75">{copy}</div> : null}
  </div>;
}
