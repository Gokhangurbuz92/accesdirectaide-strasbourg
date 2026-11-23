/**
 * G14-LITE — Mon Parcours readable without Internet, ONLY when the person asks for it (« Garder Mon Parcours sur cet appareil », default OFF).
 *
 * What is kept: a projection of what the Mon Parcours screen already shows — each step's name, state, deadline, chosen place and the official
 * Service-Public links of its kind. Never the private note, the history, a document, a message, a token or any other API answer.
 * Where: this browser's IndexedDB (database « ada-offline-parcours »). The browser cannot encrypt it at rest for us, so the feature is opt-in, explained in
 * plain words, and the copy is tied to ONE account: it is stored with a one-way fingerprint of the account (SHA-256, never the identifier itself), erased
 * on « off », on logout, when another account (or no account) is recognised on this browser, and when the server says the session is over.
 * Offline, Mon Parcours is READ-ONLY: nothing typed offline is kept or sent later (see ParcoursOffline.jsx).
 * The service worker (public/sw.js) only keeps the static application shell for /compte/parcours; it never sees the steps.
 */

const DB_NAME = 'ada-offline-parcours';
const STORE = 'kv';
const KEY = 'current';
const HINT_KEY = 'ada_offline_parcours';
export const OFFLINE_PARCOURS_EVENT = 'ada:offline-parcours';
const SNAPSHOT_VERSION = 1;
const MAX_ITEMS = 200;
const MAX_TEXT = 300;

/** @typedef {{ get: () => Promise<any>, set: (v: any) => Promise<void>, destroy: () => Promise<void> }} Backend */

/** @returns {Backend | null} */
function indexedDbBackend() {
  if (typeof indexedDB === 'undefined' || !indexedDB) return null;
  /** @returns {Promise<IDBDatabase>} */
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  /** @param {IDBTransactionMode} mode @param {(s: IDBObjectStore) => IDBRequest} fn */
  const run = async (mode, fn) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode); const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  };
  // a non-personal hint (« a copy may exist ») so that the pages of a visitor who never used the feature do not even create the database
  const hint = { has: () => { try { return window.localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } },
    set: () => { try { window.localStorage.setItem(HINT_KEY, '1'); } catch { /* storage blocked: the database is still checked */ } },
    drop: () => { try { window.localStorage.removeItem(HINT_KEY); } catch { /* storage blocked */ } } };
  return {
    get: async () => (hint.has() ? run('readonly', (s) => s.get(KEY)) : undefined),
    set: async (v) => { hint.set(); await run('readwrite', (s) => s.put(v, KEY)); },
    destroy: () => new Promise((resolve) => {
      hint.drop();
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve(); req.onerror = () => resolve(); req.onblocked = () => resolve();
    }),
  };
}

/** @type {Backend | null | undefined} */
let backendOverride;
/** tests only: an in-memory backend (or null for « not supported ») */
export function __setOfflineParcoursBackend(/** @type {Backend | null | undefined} */ b) { backendOverride = b; }
const backend = () => (backendOverride !== undefined ? backendOverride : indexedDbBackend());

const subtle = () => (typeof globalThis.crypto !== 'undefined' && globalThis.crypto?.subtle ? globalThis.crypto.subtle : null);

/** the feature needs IndexedDB and a hash function; without them the switch is not offered */
export function offlineParcoursSupported() { return Boolean(backend() && subtle()); }

/** a one-way fingerprint of the account: the copy is tied to it without storing the account identifier @param {string} userId */
export async function ownerFingerprint(userId) {
  const s = subtle(); if (!s || !userId) return null;
  const bytes = await s.digest('SHA-256', new TextEncoder().encode(`ada-offline-parcours:${String(userId)}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

const notify = () => { try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OFFLINE_PARCOURS_EVENT)); } catch { /* no window */ } };

/** asks the service worker (if any) to keep / drop the static shell; never carries personal data @param {any} message */
function tellWorker(message) {
  try {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null;
    const target = sw?.controller;
    if (target) target.postMessage(message);
  } catch { /* no worker: the page still works online */ }
}

/** the static files this page has loaded (scripts, styles, fonts of this origin) — what the shell needs to start offline */
export function loadedStaticAssets() {
  try {
    const origin = window.location.origin;
    return [...new Set(performance.getEntriesByType('resource').map((e) => e.name)
      .filter((n) => { try { const u = new URL(n); return u.origin === origin && !u.search && /^\/(assets|fonts|icons)\//.test(u.pathname); } catch { return false; } }))];
  } catch { return []; }
}

const text = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : null);
const internalHref = (/** @type {unknown} */ v) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v.slice(0, MAX_TEXT) : null);
const officialUrl = (/** @type {unknown} */ v) => { try { const u = new URL(String(v)); return u.protocol === 'https:' ? u.href.slice(0, MAX_TEXT) : null; } catch { return null; } };

/**
 * The projection kept on the device: only what the Mon Parcours screen shows. @param {any} p the answer of GET /api/citizen/parcours
 * @returns {{ v: number, contract: string, items: any[], stepTypes: any[] }}
 */
export function projectParcours(p) {
  const items = (Array.isArray(p?.items) ? p.items : []).slice(0, MAX_ITEMS).map((/** @type {any} */ i) => {
    const place = (Array.isArray(i?.records) ? i.records : []).find((/** @type {any} */ r) => r?.type === 'structure');
    return {
      id: text(i?.id), stepType: text(i?.stepType), title: text(i?.title), status: text(i?.status), closure: text(i?.closure), dueDate: text(i?.dueDate),
      place: place ? { title: text(place.title), href: place.available ? internalHref(place.href) : null, available: place.available === true } : null,
    };
  });
  const used = new Set(items.map((/** @type {any} */ i) => i.stepType).filter(Boolean));
  const stepTypes = (Array.isArray(p?.stepTypes?.types) ? p.stepTypes.types : []).filter((/** @type {any} */ t) => used.has(t?.code)).map((/** @type {any} */ t) => ({
    code: text(t.code), label: text(t.label),
    sources: (Array.isArray(t.sources) ? t.sources : []).map((/** @type {any} */ s) => ({ title: text(s?.title), url: officialUrl(s?.url) })).filter((/** @type {any} */ s) => s.url),
  }));
  return { v: SNAPSHOT_VERSION, contract: p?.contract === 'limited' ? 'limited' : 'full', items, stepTypes };
}

/** the kept record, or null (never throws) */
export async function readOfflineParcours() {
  const b = backend(); if (!b) return null;
  try { const r = await b.get(); return r && typeof r === 'object' && r.v === SNAPSHOT_VERSION ? r : null; } catch { return null; }
}

/** erases everything this feature kept on the device (steps and static shell) */
export async function clearOfflineParcours() {
  const b = backend();
  try { if (b) await b.destroy(); } catch { /* nothing left to erase */ }
  tellWorker({ type: 'ADA_OFFLINE_PARCOURS_DROP' });
  notify();
}

/**
 * The account recognised on this browser changed (or there is none any more): a copy kept for another account is erased.
 * @param {string | null | undefined} userId the citizen account now signed in, null when none
 */
export async function reconcileOfflineOwner(userId) {
  const r = await readOfflineParcours(); if (!r) return false;
  const owner = userId ? await ownerFingerprint(userId) : null;
  if (owner && r.owner === owner) return false;
  await clearOfflineParcours();
  return true;
}

/** switches the feature on for this account and keeps the current screen @param {string} userId @param {any} parcoursAnswer */
export async function enableOfflineParcours(userId, parcoursAnswer) {
  const b = backend(); const owner = await ownerFingerprint(userId);
  if (!b || !owner) return false;
  await b.set({ v: SNAPSHOT_VERSION, owner, enabled: true, savedAt: new Date().toISOString(), data: projectParcours(parcoursAnswer) });
  tellWorker({ type: 'ADA_OFFLINE_PARCOURS_KEEP', assets: loadedStaticAssets() });
  notify();
  return true;
}

/**
 * After Mon Parcours was shown online: refresh the kept copy, only if the feature is on FOR THIS ACCOUNT; a copy of another account is erased.
 * @param {string} userId @param {any} parcoursAnswer @returns {Promise<'saved' | 'off' | 'cleared'>}
 */
export async function refreshOfflineParcours(userId, parcoursAnswer) {
  const r = await readOfflineParcours(); if (!r || !r.enabled) return 'off';
  const owner = await ownerFingerprint(userId);
  if (!owner || r.owner !== owner) { await clearOfflineParcours(); return 'cleared'; }
  const b = backend(); if (!b) return 'off';
  await b.set({ ...r, savedAt: new Date().toISOString(), data: projectParcours(parcoursAnswer) });
  tellWorker({ type: 'ADA_OFFLINE_PARCOURS_KEEP', assets: loadedStaticAssets() });
  return 'saved';
}

/** a request failed because there is no network (not because the server refused it) @param {any} err */
export const isNetworkFailure = (err) => Boolean(err && (err.code === 'network' || (err.status === 0 && err.code !== 'csrf_bootstrap')));
