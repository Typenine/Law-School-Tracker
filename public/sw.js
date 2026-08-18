// Law School Tracker service worker
// Version 5.0: durable application data is server-authoritative. The service
// worker may cache successful GETs as an offline fallback, but it never fakes a
// successful write. If a mutation cannot reach the server, the request fails
// visibly so the UI cannot tell the user an edit was saved when it was not.

const CACHE_VERSION = 'v5';
const SHELL_CACHE = `lst-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `lst-static-${CACHE_VERSION}`;
const API_CACHE = `lst-api-${CACHE_VERSION}`;
const NOTES_CACHE = `lst-notes-${CACHE_VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, STATIC_CACHE, API_CACHE, NOTES_CACHE]);

const APP_SHELL = [
  '/',
  '/tasks',
  '/reading',
  '/week-plan',
  '/courses',
  '/calendar',
  '/review',
  '/settings',
  '/archive',
  '/log',
  '/help',
  '/manifest.json',
];

const CACHEABLE_APIS = [
  '/api/tasks',
  '/api/courses',
  '/api/sessions',
  '/api/schedule',
  '/api/settings',
  '/api/events',
  '/api/semesters',
  '/api/reading',
];

function isCacheableApi(url) {
  return CACHEABLE_APIS.some(prefix => url.pathname.startsWith(prefix));
}

function offlineJson(message = 'Offline. This request could not reach the server.') {
  return new Response(JSON.stringify({ error: message, offline: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(APP_SHELL);
    } catch {
      // A shell pre-cache failure should not prevent the new worker installing.
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => !CURRENT_CACHES.has(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never queue or synthesize success for writes. The database is authoritative
  // and the calling UI must know whether the mutation really reached it.
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    if (!url.pathname.startsWith('/api/')) return;
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        return offlineJson('Offline. Changes were not saved. Reconnect and try again.');
      }
    })());
    return;
  }

  // Navigations are network-first so a deploy or mutation is visible
  // immediately; the shell is only a true offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(req, res.clone());
        }
        return res;
      } catch {
        return (await caches.match(req))
          || (await caches.match('/'))
          || new Response('<!doctype html><title>Offline</title><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;background:#07111f;color:#eaf0f7;padding:32px"><h1>Offline</h1><p>The tracker cannot reach the server. Your existing cached pages may still be readable, but changes will not be saved until you reconnect.</p><button onclick="location.reload()">Retry</button></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // Notes are especially mutation-sensitive, so always prefer the live server.
  if (req.method === 'GET' && url.pathname.startsWith('/api/notes')) {
    event.respondWith((async () => {
      const cache = await caches.open(NOTES_CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || offlineJson();
      }
    })());
    return;
  }

  // Other application GETs use the same network-first rule. Cached data is a
  // fallback only and never outranks a live server response.
  if (req.method === 'GET' && isCacheableApi(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || offlineJson();
      }
    })());
    return;
  }

  // GPT Actions, backups, archives, and other uncategorized APIs must remain
  // live-only; caching them can replay stale or sensitive responses.
  if (url.pathname.startsWith('/api/')) return;

  if (req.method === 'GET') {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(STATIC_CACHE);
          await cache.put(req, res.clone());
        }
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
  }
});
