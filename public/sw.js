/* global self, caches, fetch */

/**
 * AccesDirectAide WS5 static app-shell service worker.
 * Static shell only. Dynamic personal/session/auth data is never cached.
 * PKG-9 / M01: a page opened without network shows /offline.html (static, no personal data, emergency numbers) instead of an app shell whose scripts may
 * be missing; a new version waits until the person accepts it (SKIP_WAITING message from the update prompt), never in the middle of a form.
 */

const CACHE_NAME = 'ada-static-shell-v1';   // unchanged name: a changed sw.js reinstalls and re-precaches (offline page included) anyway
const OFFLINE_URL = '/offline.html';
// R46 / M01: offline page revision 2 (six languages); G14-LITE revision 3 (the opt-in Mon Parcours line): editing this file is what makes installed workers
// reinstall and re-precache it
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

const STATIC_PREFIXES = ['/assets/', '/icons/', '/fonts/'];
const STATIC_EXACT_PATHS = new Set([
  '/manifest.json',
  '/offline.html',
  '/favicon.ico',
  '/logo.svg',
  '/logo.png',
]);

/**
 * G14-LITE — Mon Parcours readable offline, ONLY when the person switched on « Garder Mon Parcours sur cet appareil » (default off).
 * This worker never stores personal data: the steps themselves are kept by the page in IndexedDB (src/lib/offlineParcours.js). The worker keeps, in a
 * separate cache, the STATIC application shell the page asked for (the same /index.html every visitor gets, and the hashed /assets, /fonts files the page
 * had loaded) so that /compte/parcours can start without network. Any other page still shows /offline.html offline; /api, /auth, admin, pro,
 * documents, messages are never cached (NEVER_CACHE_PREFIXES, shouldBypass). The page clears this cache on « off », logout and account switch.
 */
const OFFLINE_SHELL_CACHE = 'ada-offline-parcours-shell-v1';
const OFFLINE_SHELL_KEY = '/__ada/offline-parcours-shell';
const OFFLINE_PARCOURS_PATH = '/compte/parcours';
// G14-PS (g14-r2 integration): the Passeport Social is browser-only (IndexedDB, nothing on the server), so it may start from the SAME kept static shell when
// it exists — never from anything else, and nothing is ever stored for it here; its lazy chunk is a hashed /assets file (cache-first like every static file)
const OFFLINE_SHELL_PATHS = [OFFLINE_PARCOURS_PATH, '/passeport-social'];
const MAX_SHELL_ASSETS = 200;

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

/** G14-LITE: looks in the kept shell WITHOUT creating it (caches.open would leave an empty cache behind when the person never switched it on) */
async function matchOfflineShell(request) {
  if (typeof caches.has !== 'function' || !(await caches.has(OFFLINE_SHELL_CACHE))) return undefined;
  const shell = await caches.open(OFFLINE_SHELL_CACHE);
  return shell.match(request);
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) return cached;

  // G14-LITE: a static file kept for the offline Mon Parcours shell (only exists when the person switched it on)
  const kept = await matchOfflineShell(request);
  if (kept) return kept;

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

/** G14-LITE: the offline Mon Parcours shell, if the person kept it; otherwise the static offline page */
async function offlineParcoursShell() {
  return (await matchOfflineShell(OFFLINE_SHELL_KEY)) || offlineFallback();
}

/** G14-LITE: only the exact Mon Parcours address (and the browser-only Passeport Social) may start from the kept shell (never another account page) */
function isOfflineParcoursNavigation(request) {
  if (!isPageNavigation(request)) return false;
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
  return OFFLINE_SHELL_PATHS.includes(pathname);
}

/**
 * G14-LITE: the shell files a page may ask this worker to keep — same origin, GET-able static files only (/assets, /fonts, /icons and the exact static
 * paths). Anything else (an /api address, an account page, another origin) is refused.
 */
function isShellAssetUrl(raw) {
  let url;
  try { url = new URL(String(raw), self.location.origin); } catch { return false; }
  if (url.origin !== self.location.origin || url.search || url.hash) return false;
  if (NEVER_CACHE_PREFIXES.some((prefix) => pathMatchesPrefix(url.pathname, prefix))) return false;
  if (STATIC_EXACT_PATHS.has(url.pathname)) return true;
  return STATIC_PREFIXES.some((prefix) => pathMatchesPrefix(url.pathname, prefix));
}

/** G14-LITE: keeps the static shell for offline Mon Parcours: the shared /index.html (stored under a private key) and the listed static files */
async function keepOfflineParcoursShell(assets) {
  const list = Array.isArray(assets) ? assets.filter(isShellAssetUrl).slice(0, MAX_SHELL_ASSETS) : [];
  const shell = await caches.open(OFFLINE_SHELL_CACHE);
  const page = await fetch('/index.html', { cache: 'no-store', credentials: 'omit' });
  if (!responseMayBeCached(page)) return false;
  await shell.put(OFFLINE_SHELL_KEY, page.clone());
  await Promise.all(list.map(async (raw) => {
    const url = new URL(String(raw), self.location.origin).href;
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (responseMayBeCached(res)) await shell.put(url, res.clone());
    } catch { /* a missing file only means that part will not start offline */ }
  }));
  return true;
}

async function dropOfflineParcoursShell() {
  await caches.delete(OFFLINE_SHELL_CACHE);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (isOfflineParcoursNavigation(request)) {
    event.respondWith(fetch(request).catch(offlineParcoursShell));
    return;
  }

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
  // G14-LITE: only messages from a page of this origin (event.source is a window client of this worker) — the page decides, the worker never asks
  const fromPage = !event?.origin || event.origin === self.location.origin;
  if (fromPage && event?.data?.type === 'ADA_OFFLINE_PARCOURS_KEEP') event.waitUntil?.(keepOfflineParcoursShell(event.data.assets));
  if (fromPage && event?.data?.type === 'ADA_OFFLINE_PARCOURS_DROP') event.waitUntil?.(dropOfflineParcoursShell());
});

// R11 / N04 — a Web Push message (api/_services/web-push.js): generic words and a link INSIDE the site, shown as a notification; nothing personal is in it.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/compte';
  // G14-CHAN: an optional tag (letters, digits, « - ») replaces an older notification of the same kind instead of piling them up
  const tag = typeof data.tag === 'string' && /^[a-z0-9-]{1,40}$/i.test(data.tag) ? data.tag : undefined;
  event.waitUntil(self.registration.showNotification(String(data.title || 'AccesDirectAide').slice(0, 80), {
    body: String(data.body || 'Vous avez une nouvelle information dans votre espace.').slice(0, 240), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', lang: 'fr', data: { url },
    ...(tag ? { tag } : {}),
  }));
});
// a click opens (or focuses) the site at that page — same origin only
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/compte', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((w) => w.url.startsWith(self.location.origin) && 'focus' in w);
    if (!c) return self.clients.openWindow(target.href);
    // R40: the open tab goes to the link, then gets the focus; navigate() rejects for a tab this worker does not control (opened before it was installed):
    // then a new window at the link — before, that rejection was unhandled and the old page was focused without the link
    return Promise.resolve(typeof c.navigate === 'function' ? c.navigate(target.href) : null).then((w) => (w || c).focus(), () => self.clients.openWindow(target.href));
  }));
});
