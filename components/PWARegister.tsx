"use client";
import { useEffect } from 'react';

export default function PWARegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const isProd = process.env.NODE_ENV === 'production';
    const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
    const isLocal = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (isProd && isHttps && !isLocal) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    } else {
      // In dev/local, ensure no SW is controlling the page to avoid stale caches
      navigator.serviceWorker.getRegistrations?.().then((regs) => {
        regs.forEach(r => r.unregister().catch(() => {}));
      }).catch(() => {});
    }
  }, []);
  return null;
}
