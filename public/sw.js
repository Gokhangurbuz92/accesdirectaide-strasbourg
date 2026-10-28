/* global self, caches, fetch */

/**
 * AccesDirectAide WS5 static app-shell service worker.
 * Static shell only. Dynamic personal/session/auth data is never cached.
 * PKG-9 / M01: a page opened without network shows /offline.html (static, no personal data, emergency numbers) instead of an app shell whose scripts may
 * be missing; a new version waits until the person accepts it (SKIP_WAITING message from the update prompt), never in the middle of a form.
 */

const CACHE_NAME = 'ada-static-shell-v1';   // unchanged name: a changed sw.js reinstalls and re-precaches (offline page included) anyway
const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = ['/index.html', '/manifest.json', OFFLINE_URL, '/icons/icon-192.png'];

const NEVER_CACHE_PREFIXES = [
  '/api/',
  '/uploads/',
  '/documents/',
  '/dossiers/',
  '/compte/',
  '/pro/',
  '/admin/',
  '/auth/',
];

const STATIC_PREFIXES = ['/assets/', '/icons/'];
const STATIC_EXACT_PATHS = new Set([
  '/manifest.json',
  '/offline.html',
  '/favicon.ico',
  '/logo.svg',
  '/logo.png',
]);

function pathMatchesPrefix(pathname, prefix) {
  return pathname === prefix.slice(0, -1) || pathname.startsWith(prefix);
}

function hasSensitiveRequestMetadata(request) {
  const getHeader = request?.headers?.get?.bind(request.headers);
  if (!getHeader) return false;

  return Boolean(
    getHeader('authorization') ||
    getHeader('x-csrf-token') ||
    getHeader('x-xsrf-token')
  );
}

function shouldBypass(request) {
  if (!request || request.method !== 'GET') return true;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return true;
  if (hasSensitiveRequestMetadata(request)) return true;

  return NEVER_CACHE_PREFIXES.some((prefix) =>
    pathMatchesPrefix(url.pathname, prefix)
  );
}

function isStaticAssetRequest(request) {
  if (shouldBypass(request)) return false;

  const url = new URL(request.url);

  if (STATIC_EXACT_PATHS.has(url.pathname)) return true;

  return STATIC_PREFIXES.some((prefix) =>
    pathMatchesPrefix(url.pathname, prefix)
  );
}

function responseMayBeCached(response) {
  if (!response || !response.ok) return false;

  const cacheControl = response.headers?.get?.('cache-control') || '';
  if (/\b(?:no-store|private)\b/i.test(cacheControl)) return false;

  return response.type === 'basic' || response.type === 'default';
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) return cached;

  const response = await fetch(request);

  if (responseMayBeCached(response)) {
    await cache.put(request, response.clone());
  }

  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

// R12 (M01): the cache name never changes, so a new version also drops the static files the previous version had cached (they piled up across releases:
// hashed assets of every deploy); only the precached shell stays, the rest is fetched again on demand
async function pruneCurrentCache() {
  const cache = await caches.open(CACHE_NAME);
  const keep = new Set(PRECACHE_URLS.map((u) => new URL(u, self.location.origin).href));
  const requests = await cache.keys();
  await Promise.all(requests.filter((r) => !keep.has(r.url)).map((r) => cache.delete(r)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('ada-static-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(pruneCurrentCache)
  );
});

async function offlineFallback() {
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(OFFLINE_URL)) || cache.match('/index.html');
}

/** PKG-9 / M01: any same-origin page navigation (public or private) goes to the network; only when the network fails is the static offline page shown. Nothing is cached here. */
function isPageNavigation(request) {
  return Boolean(request && request.mode === 'navigate' && request.method === 'GET' && new URL(request.url).origin === self.location.origin);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (isPageNavigation(request)) {
    event.respondWith(fetch(request).catch(offlineFallback));
    return;
  }

  if (shouldBypass(request)) {
    return;
  }

  if (isStaticAssetRequest(request)) {
    event.respondWith(cacheFirstStatic(request));
  }
});

// PKG-9 / M01: the update prompt (src/components/pwa/UpdatePrompt.jsx) asks the waiting worker to take over only when the person chooses to.
self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// R11 / N04 — a Web Push message (api/_services/web-push.js): generic words and a link INSIDE the site, shown as a notification; nothing personal is in it.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/compte';
  event.waitUntil(self.registration.showNotification(String(data.title || 'AccesDirectAide').slice(0, 80), {
    body: String(data.body || 'Vous avez une nouvelle information dans votre espace.').slice(0, 240), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', lang: 'fr', data: { url },
  }));
});
// a click opens (or focuses) the site at that page — same origin only
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/compte', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate?.(target.href); return c.focus(); }
    return self.clients.openWindow(target.href);
  }));
});
