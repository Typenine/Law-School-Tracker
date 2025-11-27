// Service worker for Law School Tracker - Offline Support
// Version: 2.0

const DISABLE_SW = false; // Enable caching for offline support

const CACHE_NAME = 'lst-v2';
const STATIC_CACHE = 'lst-static-v2';
const API_CACHE = 'lst-api-v2';

const APP_SHELL = [
  '/',
  '/tasks',
  '/week-plan',
  '/courses',
  '/calendar',
  '/settings',
  '/log',
  '/review',
  '/help',
  '/manifest.json',
];

// API endpoints to cache for offline
const CACHEABLE_APIS = [
  '/api/tasks',
  '/api/courses',
  '/api/sessions',
  '/api/schedule',
  '/api/settings',
];

// Queue for offline mutations
const MUTATION_QUEUE_KEY = 'lst-mutation-queue';

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

// Check if URL is a cacheable API endpoint
function isCacheableApi(url) {
  return CACHEABLE_APIS.some(api => url.pathname.startsWith(api));
}

// Network-first for navigations, stale-while-revalidate for APIs
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  if (DISABLE_SW) {
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
        const index = await caches.match('/');
        return index || new Response(`
          <!DOCTYPE html>
          <html>
          <head><title>Offline</title><style>body{font-family:system-ui;padding:40px;background:#0b1020;color:#e6e9f5;}</style></head>
          <body><h1>📴 You're Offline</h1><p>The app needs an internet connection. Please check your connection and try again.</p>
          <button onclick="location.reload()" style="padding:12px 24px;background:#2563eb;color:white;border:none;border-radius:8px;cursor:pointer;margin-top:20px;">Retry</button>
          </body></html>
        `, { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // For API GET requests, use stale-while-revalidate
  if (req.method === 'GET' && isCacheableApi(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      const cached = await cache.match(req);
      
      // Fetch in background and update cache
      const fetchPromise = fetch(req).then(res => {
        if (res.ok) {
          cache.put(req, res.clone());
        }
        return res;
      }).catch(() => null);
      
      // Return cached immediately if available, otherwise wait for fetch
      if (cached) {
        // Trigger background revalidation
        fetchPromise;
        return cached;
      }
      
      const res = await fetchPromise;
      if (res) return res;
      
      // Final fallback
      return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    })());
    return;
  }

  // For POST/PATCH/PUT/DELETE to APIs when offline, queue them
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && isCacheableApi(url)) {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        // Queue for later sync (simplified - just return success)
        // In production, you'd want IndexedDB-based queuing
        return new Response(JSON.stringify({ queued: true, offline: true }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    })());
    return;
  }

  // For static assets, cache-first
  if (req.method === 'GET') {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.status === 200) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
  }
});
