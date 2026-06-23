"use client";

import { useEffect } from 'react';

export default function PWARegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const isProd = process.env.NODE_ENV === 'production';
    const isHttps = location.protocol === 'https:';
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

    const notifyReplay = () => {
      navigator.serviceWorker.controller?.postMessage({ type: 'REPLAY_MUTATIONS' });
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OFFLINE_MUTATION_REPLAYED') {
        window.dispatchEvent(new CustomEvent('tracker-data-changed'));
      }
      if (event.data?.type === 'OFFLINE_MUTATION_REJECTED') {
        window.dispatchEvent(new CustomEvent('tracker-offline-mutation-rejected', { detail: event.data }));
      }
    };

    if (isProd && isHttps && !isLocal) {
      navigator.serviceWorker.register('/sw.js').then(registration => {
        if (navigator.onLine) registration.active?.postMessage({ type: 'REPLAY_MUTATIONS' });
      }).catch(() => undefined);
      window.addEventListener('online', notifyReplay);
      navigator.serviceWorker.addEventListener('message', onMessage);
    } else {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => registration.unregister().catch(() => undefined));
      }).catch(() => undefined);
    }

    return () => {
      window.removeEventListener('online', notifyReplay);
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, []);
  return null;
}
