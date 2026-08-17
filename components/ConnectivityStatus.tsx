'use client';

import { useEffect, useState } from 'react';

type State = 'online' | 'offline' | 'checking';

export default function ConnectivityStatus() {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    const update = () => setState(navigator.onLine ? 'online' : 'offline');
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (state === 'checking' || state === 'online') return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[1900] max-w-sm rounded-lg border border-amber-500/40 bg-[#17130a] px-3 py-2 text-xs text-amber-100 shadow-xl"
    >
      <div className="font-medium">Offline</div>
      <div className="mt-0.5 text-amber-100/75">Cached pages may still open, but changes are not saved until the server is reachable.</div>
    </div>
  );
}
