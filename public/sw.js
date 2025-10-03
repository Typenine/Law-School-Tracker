// Minimal service worker for Law School Tracker
// Kill-switch enabled to avoid stale UI during development.

const DISABLE_SW = true; // Set to false to enable caching again

const CACHE_NAME = 'lst-app-shell-v1';
const APP_SHELL = [
  '/',
  '/planner',
  '/calendar',
  '/settings',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  if (DISABLE_SW) return; // skip any caching
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
    } catch (e) {
      // ignore
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.clients.claim();
    if (DISABLE_SW) {
      try { await self.registration.unregister(); } catch {}
    }
  })());
});

// Network-first for navigations, cache-first for static GETs
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  if (DISABLE_SW) {
    // Bypass SW entirely
    return; // let the network handle it
  }

  // For navigation requests (HTML), use network-first with cache fallback
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
        return res;
      } catch {
        const cacheMatch = await caches.match(req);
        if (cacheMatch) return cacheMatch;
        // Fallback to cached index if available
        const index = await caches.match('/');
        return index || new Response('<html><body><h1>Offline</h1><p>The app is offline. Try again later.</p></body></html>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // For GET static resources, try cache-first then network
  if (req.method === 'GET') {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        // Only cache successful, basic/opaque responses
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
  }
});
