// Law School Tracker service worker: app shell, offline reads, durable mutation replay, and notifications.
const VERSION = 'lst-v3';
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const API_CACHE = `${VERSION}-api`;
const DB_NAME = 'lst-offline-v1';
const STORE_NAME = 'mutations';

const APP_SHELL = [
  '/', '/tasks', '/week-plan', '/courses', '/calendar', '/settings', '/log', '/review',
  '/questions', '/outline-updates', '/exam', '/help', '/manifest.json',
];

const CACHEABLE_APIS = [
  '/api/tasks', '/api/courses', '/api/sessions', '/api/schedule', '/api/settings',
  '/api/events', '/api/course-workspace', '/api/semesters', '/api/notifications',
];

function isCacheableApi(url) {
  return CACHEABLE_APIS.some(path => url.pathname.startsWith(path));
}

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const db = await openQueueDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let result;
      try { result = action(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function requestToMutation(request) {
  const clone = request.clone();
  const headers = {};
  clone.headers.forEach((value, key) => { headers[key] = value; });
  return {
    id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    url: clone.url,
    method: clone.method,
    headers,
    body: await clone.arrayBuffer(),
    createdAt: new Date().toISOString(),
  };
}

async function enqueueMutation(request) {
  const mutation = await requestToMutation(request);
  await withStore('readwrite', store => store.put(mutation));
  try { await self.registration.sync.register('lst-mutation-replay'); } catch {}
  return mutation;
}

async function queuedMutations() {
  const db = await openQueueDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function deleteMutation(id) {
  await withStore('readwrite', store => store.delete(id));
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function replayMutations() {
  const mutations = (await queuedMutations()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let replayed = 0;
  for (const mutation of mutations) {
    try {
      const response = await fetch(mutation.url, {
        method: mutation.method,
        headers: mutation.headers,
        body: mutation.body && mutation.body.byteLength ? mutation.body : undefined,
      });
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        await deleteMutation(mutation.id);
        replayed += 1;
        await notifyClients({ type: response.ok ? 'OFFLINE_MUTATION_REPLAYED' : 'OFFLINE_MUTATION_REJECTED', id: mutation.id, status: response.status });
        continue;
      }
      break;
    } catch {
      break;
    }
  }
  return replayed;
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(PAGE_CACHE).then(cache => cache.addAll(APP_SHELL)).catch(() => undefined));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC_CACHE, PAGE_CACHE, API_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => !keep.has(key)).map(key => caches.delete(key)));
    await self.clients.claim();
    await replayMutations();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(PAGE_CACHE)).put(request, response.clone());
        return response;
      } catch {
        return (await caches.match(request)) || (await caches.match('/')) || new Response('<h1>Offline</h1><p>This page has not been cached yet.</p>', { status: 503, headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  if (request.method === 'GET' && isCacheableApi(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return (await cache.match(request)) || new Response(JSON.stringify({ error: 'Offline', offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) && isCacheableApi(url)) {
    event.respondWith((async () => {
      try {
        return await fetch(request.clone());
      } catch {
        const mutation = await enqueueMutation(request);
        return new Response(JSON.stringify({ queued: true, offline: true, mutationId: mutation.id }), { status: 202, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  if (request.method === 'GET') {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
        return response;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
  }
});

self.addEventListener('sync', event => {
  if (event.tag === 'lst-mutation-replay') event.waitUntil(replayMutations());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'REPLAY_MUTATIONS') event.waitUntil(replayMutations());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.navigate(target);
      return;
    }
    await self.clients.openWindow(target);
  })());
});
