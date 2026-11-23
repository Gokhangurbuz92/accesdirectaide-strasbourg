// @ts-check
/**
 * G14-PS — Passeport Social: the person's LOCAL vault. Documents (PDF / images) and a structured situation summary, encrypted with a key derived from the
 * person's passphrase (src/lib/passeport/crypto.js), stored in THIS browser's IndexedDB only — database « ada-passeport-social-v1 » (deliberately distinct
 * from every other IndexedDB database of the site, Mon Parcours offline included). Nothing here uses the network: no fetch, no XMLHttpRequest, no beacon,
 * no service-worker message (tests/unit/g14-passeport-local.test.js asserts it). There is no copy anywhere else: losing the device or forgetting the
 * passphrase loses the data, which the page states plainly, with the backup options (encrypted export file).
 *
 * Records (all values encrypted, except ids and the kind):
 *   meta  'vault'   { salt, iterations, verifier, createdAt }       — what is needed to check a passphrase; no secret
 *   items <id>      { id, kind: 'doc' | 'doc-data' | 'summary', box: { iv, ct } }
 * Sharing never goes through ADA: (a) show on screen; (b) an encrypted package file « .adapass » opened with a SEPARATE one-time code; (c) a plain PDF of
 * the summary that the person decides to hand over. Import of a .adapass on another device of the same person.
 */
import { checkVerifier, decryptBytes, decryptJson, deriveKey, encryptBytes, encryptJson, fromB64, KDF_ITERATIONS, makeVerifier, newExportCode, normaliseExportCode,
  passphraseProblem, randomBytes, toB64 } from './crypto.js';

export const PASSPORT_DB_NAME = 'ada-passeport-social-v1';
export const PACKAGE_FORMAT = 'ada.passeport-social/1';
export const PACKAGE_EXTENSION = '.adapass';
/** one document: 10 MB at most; 60 documents at most (the browser's quota is the person's) */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export const MAX_DOCS = 60;
export const ACCEPTED_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
/** inactivity before the vault locks itself (the page also locks when it is hidden for longer than HIDDEN_LOCK_MS) */
export const AUTO_LOCK_MS = 5 * 60 * 1000;
export const HIDDEN_LOCK_MS = 60 * 1000;

/**
 * @typedef {{ get: (store: string, key: string) => Promise<any>, put: (store: string, value: any, key?: string) => Promise<void>, del: (store: string, key: string) => Promise<void>,
 *   all: (store: string) => Promise<any[]>, clear: () => Promise<void> }} Backend
 */

/** in-memory backend (tests, and a fallback when IndexedDB is refused: then nothing survives the page) @returns {Backend} */
export function memoryBackend() {
  /** @type {Record<string, Map<string, any>>} */ const m = { meta: new Map(), items: new Map() };
  const clone = (/** @type {any} */ v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    async get(store, key) { return clone(m[store].get(key)); },
    async put(store, value, key) { m[store].set(key ?? value.id, clone(value)); },
    async del(store, key) { m[store].delete(key); },
    async all(store) { return [...m[store].values()].map(clone); },
    async clear() { m.meta.clear(); m.items.clear(); },
  };
}

/** IndexedDB backend on PASSPORT_DB_NAME @param {IDBFactory} [factory] @returns {Backend} */
export function indexedDbBackend(factory = globalThis.indexedDB) {
  /** @type {Promise<IDBDatabase> | null} */ let opening = null;
  const open = () => {
    if (!factory) return Promise.reject(Object.assign(new Error('IndexedDB indisponible'), { code: 'NO_INDEXEDDB' }));
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const req = factory.open(PASSPORT_DB_NAME, 1);
        req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { opening = null; reject(req.error); };
      });
    }
    return opening;
  };
  const tx = async (/** @type {string[]} */ stores, /** @type {IDBTransactionMode} */ mode, /** @type {(t: IDBTransaction) => IDBRequest | void} */ fn) => {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode); let result = /** @type {unknown} */ (undefined);
      const r = fn(t); if (r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => resolve(result); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    });
  };
  return {
    get: (store, key) => tx([store], 'readonly', (t) => t.objectStore(store).get(key)),
    put: async (store, value, key) => { await tx([store], 'readwrite', (t) => (store === 'items' ? t.objectStore(store).put(value) : t.objectStore(store).put(value, key))); },
    del: async (store, key) => { await tx([store], 'readwrite', (t) => t.objectStore(store).delete(key)); },
    all: async (store) => /** @type {any[]} */ (await tx([store], 'readonly', (t) => t.objectStore(store).getAll())) || [],
    clear: async () => { await tx(['meta', 'items'], 'readwrite', (t) => { t.objectStore('meta').clear(); t.objectStore('items').clear(); }); },
  };
}

const newId = () => toB64(randomBytes(12)).replace(/[^A-Za-z0-9]/g, '').slice(0, 16) || String(Date.now());

/**
 * The vault. Lock state lives in this object only (the key is a non-extractable CryptoKey held in memory; locking drops it).
 * @param {Backend} backend @param {{ iterations?: number, now?: () => Date }} [opts] iterations: tests may lower it (the page always uses KDF_ITERATIONS)
 */
export function createVault(backend, opts = {}) {
  const iterations = opts.iterations || KDF_ITERATIONS;
  const now = opts.now || (() => new Date());
  /** @type {CryptoKey | null} */ let key = null;
  const need = () => { if (!key) throw Object.assign(new Error('Passeport verrouillé'), { code: 'LOCKED' }); return key; };
  const api = {
    /** does a vault exist on this device */
    async exists() { return Boolean(await backend.get('meta', 'vault')); },
    isUnlocked: () => key !== null,
    /** create the vault (refused when one exists: delete it first) @param {string} passphrase */
    async create(passphrase) {
      const p = passphraseProblem(passphrase); if (p) throw Object.assign(new Error('Phrase secrète trop courte'), { code: p });
      if (await api.exists()) throw Object.assign(new Error('Un passeport existe déjà sur cet appareil'), { code: 'EXISTS' });
      const salt = randomBytes(16);
      const k = await deriveKey(passphrase, salt, iterations);
      await backend.put('meta', { salt: toB64(salt), iterations, verifier: await makeVerifier(k), createdAt: now().toISOString() }, 'vault');
      key = k;
    },
    /** @param {string} passphrase @returns {Promise<boolean>} false = wrong passphrase (nothing decrypted) */
    async unlock(passphrase) {
      const meta = await backend.get('meta', 'vault');
      if (!meta) throw Object.assign(new Error('Aucun passeport sur cet appareil'), { code: 'NO_VAULT' });
      const k = await deriveKey(passphrase, fromB64(meta.salt), meta.iterations || KDF_ITERATIONS);
      if (!(await checkVerifier(k, meta.verifier))) return false;
      key = k; return true;
    },
    lock() { key = null; },
    /** @param {{ name: string, type: string, bytes: Uint8Array }} doc */
    async addDocument(doc) {
      const k = need();
      if (!ACCEPTED_TYPES.includes(doc.type)) throw Object.assign(new Error('Type de fichier non accepté'), { code: 'TYPE' });
      if (!(doc.bytes instanceof Uint8Array) || doc.bytes.byteLength === 0 || doc.bytes.byteLength > MAX_DOC_BYTES) throw Object.assign(new Error('Fichier vide ou trop lourd'), { code: 'SIZE' });
      if ((await api.listDocuments()).length >= MAX_DOCS) throw Object.assign(new Error('Trop de documents'), { code: 'COUNT' });
      const id = newId();
      await backend.put('items', { id: `${id}.data`, kind: 'doc-data', box: await encryptBytes(k, doc.bytes) });
      await backend.put('items', { id, kind: 'doc', box: await encryptJson(k, { name: String(doc.name || 'document').slice(0, 120), type: doc.type, size: doc.bytes.byteLength, addedAt: now().toISOString() }) });
      return id;
    },
    /** @returns {Promise<{ id: string, name: string, type: string, size: number, addedAt: string }[]>} */
    async listDocuments() {
      const k = need();
      const rows = (await backend.all('items')).filter((r) => r.kind === 'doc');
      const out = [];
      for (const r of rows) out.push({ id: r.id, ...(await decryptJson(k, r.box)) });
      return out.sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
    },
    /** @param {string} id @returns {Promise<{ name: string, type: string, bytes: Uint8Array } | null>} */
    async getDocument(id) {
      const k = need();
      const meta = await backend.get('items', id); const data = await backend.get('items', `${id}.data`);
      if (!meta || !data) return null;
      const m = await decryptJson(k, meta.box);
      return { name: m.name, type: m.type, bytes: await decryptBytes(k, data.box) };
    },
    /** @param {string} id */
    async deleteDocument(id) { need(); await backend.del('items', id); await backend.del('items', `${id}.data`); },
    /** @param {Record<string, unknown>} summary */
    async saveSummary(summary) { const k = need(); await backend.put('items', { id: 'summary', kind: 'summary', box: await encryptJson(k, { ...summary, updatedAt: now().toISOString() }) }); },
    /** @returns {Promise<Record<string, any> | null>} */
    async getSummary() { const k = need(); const r = await backend.get('items', 'summary'); return r ? decryptJson(k, r.box) : null; },
    /** erase EVERYTHING on this device (no confirmation here: the page asks) — works locked or unlocked */
    async deleteAll() { await backend.clear(); key = null; },

    /**
     * the encrypted package of the WHOLE passport (or of selected documents) for another device of the same person or for a person they choose. It is
     * encrypted with a NEW one-time code (not the passphrase), returned separately: the file alone opens nothing.
     * @param {{ documentIds?: string[], includeSummary?: boolean }} [sel] @returns {Promise<{ bytes: Uint8Array, code: string, fileName: string }>}
     */
    async exportPackage(sel = {}) {
      need();
      const docs = await api.listDocuments();
      const chosen = sel.documentIds ? docs.filter((d) => sel.documentIds?.includes(d.id)) : docs;
      const content = { summary: sel.includeSummary === false ? null : await api.getSummary(), documents: /** @type {any[]} */ ([]) };
      for (const d of chosen) { const full = await api.getDocument(d.id); if (full) content.documents.push({ name: full.name, type: full.type, data: toB64(full.bytes) }); }
      const code = newExportCode(); const salt = randomBytes(16);
      const pk = await deriveKey(normaliseExportCode(code), salt, iterations);
      const pkg = { format: PACKAGE_FORMAT, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) }, box: await encryptJson(pk, content), createdAt: now().toISOString() };
      return { bytes: new TextEncoder().encode(JSON.stringify(pkg)), code, fileName: `passeport-social-${now().toISOString().slice(0, 10)}${PACKAGE_EXTENSION}` };
    },
    /**
     * opens a package with its code and ADDS its content to this (unlocked) vault (the summary replaces the current one only when `replaceSummary`).
     * @param {Uint8Array} bytes @param {string} code @param {{ replaceSummary?: boolean }} [opt] @returns {Promise<{ documents: number, summary: boolean }>}
     */
    async importPackage(bytes, code, opt = {}) {
      need();
      const content = await openPackage(bytes, code);
      let n = 0;
      for (const d of content.documents || []) { await api.addDocument({ name: d.name, type: d.type, bytes: fromB64(d.data) }); n += 1; }
      const withSummary = Boolean(content.summary) && (opt.replaceSummary === true || !(await api.getSummary()));
      if (withSummary) await api.saveSummary(content.summary);
      return { documents: n, summary: withSummary };
    },
  };
  return api;
}

/** decrypts a .adapass package (throws BAD_PACKAGE / BAD_CODE) @param {Uint8Array} bytes @param {string} code */
export async function openPackage(bytes, code) {
  let pkg;
  try { pkg = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw Object.assign(new Error('Fichier illisible'), { code: 'BAD_PACKAGE' }); }
  if (!pkg || pkg.format !== PACKAGE_FORMAT || !pkg.kdf || !pkg.box) throw Object.assign(new Error('Ce fichier n’est pas un passeport social'), { code: 'BAD_PACKAGE' });
  const pk = await deriveKey(normaliseExportCode(code), fromB64(pkg.kdf.salt), Number(pkg.kdf.iterations) || KDF_ITERATIONS);
  try { return await decryptJson(pk, pkg.box); } catch { throw Object.assign(new Error('Code incorrect'), { code: 'BAD_CODE' }); }
}
