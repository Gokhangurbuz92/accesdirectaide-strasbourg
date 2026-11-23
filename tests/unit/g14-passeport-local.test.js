// G14-PS — Passeport Social, local-first: encryption round-trip, wrong passphrase, lock, export / import (.adapass + separate code), delete-all, closed
// summary, and NOTHING leaves the device (no fetch / XMLHttpRequest / sendBeacon during a full journey, document bytes never handed to the network).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { checkVerifier, decryptBytes, deriveKey, encryptBytes, KDF_ITERATIONS, makeVerifier, newExportCode, normaliseExportCode, passphraseProblem } from '../../src/lib/passeport/crypto.js';
import { createVault, memoryBackend, openPackage, PASSPORT_DB_NAME, PACKAGE_FORMAT, AUTO_LOCK_MS } from '../../src/lib/passeport/vault.js';
import { cleanSummary, SUMMARY_FIELDS } from '../../src/lib/passeport/summary.js';
import { sensitiveTextCategories } from '../../api/lib/parcours-sensitivity.js';

const FAST = { iterations: 1000 };
const PASS = 'une phrase secrète longue';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x99, 0x42, 0x13, 0x37]);

describe('crypto', () => {
  it('PBKDF2-SHA256 600 000 iterations by default, non-extractable AES-GCM key, IV changes on every record', async () => {
    expect(KDF_ITERATIONS).toBe(600000);
    const k = await deriveKey(PASS, new Uint8Array(16), 1000);
    expect(k.extractable).toBe(false);
    expect(k.algorithm.name).toBe('AES-GCM');
    const a = await encryptBytes(k, PDF); const b = await encryptBytes(k, PDF);
    expect(a.iv).not.toBe(b.iv); expect(a.ct).not.toBe(b.ct);
    expect([...await decryptBytes(k, a)]).toEqual([...PDF]);
  });
  it('a wrong key fails the AES-GCM authentication (nothing decrypted)', async () => {
    const k = await deriveKey(PASS, new Uint8Array(16), 1000); const bad = await deriveKey('autre phrase secrète', new Uint8Array(16), 1000);
    const v = await makeVerifier(k);
    expect(await checkVerifier(k, v)).toBe(true);
    expect(await checkVerifier(bad, v)).toBe(false);
    await expect(decryptBytes(bad, await encryptBytes(k, PDF))).rejects.toThrow();
  });
  it('passphrase of at least 10 characters; export code 20 characters, unambiguous, normalised', () => {
    expect(passphraseProblem('court')).toBe('TOO_SHORT'); expect(passphraseProblem(PASS)).toBeNull();
    const c = newExportCode();
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
    expect(normaliseExportCode(c.toLowerCase().replace(/-/g, ' '))).toBe(c.replace(/-/g, ''));
  });
});

describe('vault', () => {
  it('stores only ciphertext: neither the document bytes, its name nor the summary appear in the stored records', async () => {
    const be = memoryBackend(); const v = createVault(be, FAST);
    await v.create(PASS);
    await v.addDocument({ name: 'avis-imposition-2026.pdf', type: 'application/pdf', bytes: PDF });
    await v.saveSummary(cleanSummary({ housing: 'tenant_social', note: 'note très personnelle' }));
    const dump = JSON.stringify([await be.all('meta'), await be.all('items'), await be.get('meta', 'vault')]);
    expect(dump).not.toContain('avis-imposition'); expect(dump).not.toContain('tenant_social'); expect(dump).not.toContain('note très');
    expect(dump).not.toContain(Buffer.from(PDF).toString('base64'));
    expect(dump).not.toContain(PASS);
  });
  it('round-trip, wrong passphrase, lock', async () => {
    const be = memoryBackend(); const v = createVault(be, FAST);
    await v.create(PASS);
    const id = await v.addDocument({ name: 'quittance.pdf', type: 'application/pdf', bytes: PDF });
    v.lock();
    expect(v.isUnlocked()).toBe(false);
    await expect(v.listDocuments()).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(v.getDocument(id)).rejects.toMatchObject({ code: 'LOCKED' });
    const other = createVault(be, FAST);   // a new page load: same device storage
    expect(await other.unlock('mauvaise phrase secrète')).toBe(false);
    expect(other.isUnlocked()).toBe(false);
    expect(await other.unlock(PASS)).toBe(true);
    const doc = await other.getDocument(id);
    expect(doc.name).toBe('quittance.pdf'); expect([...doc.bytes]).toEqual([...PDF]);
    expect((await other.listDocuments()).map((d) => d.name)).toEqual(['quittance.pdf']);
  });
  it('refuses a second vault, unknown types and empty / oversized files', async () => {
    const v = createVault(memoryBackend(), FAST); await v.create(PASS);
    await expect(v.create(PASS)).rejects.toMatchObject({ code: 'EXISTS' });
    await expect(v.addDocument({ name: 'x.exe', type: 'application/x-msdownload', bytes: PDF })).rejects.toMatchObject({ code: 'TYPE' });
    await expect(v.addDocument({ name: 'x.pdf', type: 'application/pdf', bytes: new Uint8Array() })).rejects.toMatchObject({ code: 'SIZE' });
    await expect(v.addDocument({ name: 'x.pdf', type: 'application/pdf', bytes: new Uint8Array(10 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: 'SIZE' });
  });
  it('export → import on another device: the file alone opens nothing, the separate code opens it once', async () => {
    const a = createVault(memoryBackend(), FAST); await a.create(PASS);
    await a.addDocument({ name: 'attestation-caf.png', type: 'image/png', bytes: PDF });
    await a.saveSummary(cleanSummary({ work: 'job_seeker', resources: ['rsa', 'housing_benefit'] }));
    const pkg = await a.exportPackage();
    expect(pkg.fileName).toMatch(/\.adapass$/);
    const text = new TextDecoder().decode(pkg.bytes);
    expect(JSON.parse(text).format).toBe(PACKAGE_FORMAT);
    expect(text).not.toContain('attestation-caf'); expect(text).not.toContain('job_seeker');
    await expect(openPackage(pkg.bytes, 'AAAAA-AAAAA-AAAAA-AAAAA')).rejects.toMatchObject({ code: 'BAD_CODE' });
    await expect(openPackage(new TextEncoder().encode('{"format":"autre"}'), pkg.code)).rejects.toMatchObject({ code: 'BAD_PACKAGE' });
    const b = createVault(memoryBackend(), FAST); await b.create('phrase de l’autre appareil');
    expect(await b.importPackage(pkg.bytes, pkg.code.toLowerCase())).toEqual({ documents: 1, summary: true });
    expect((await b.listDocuments())[0].name).toBe('attestation-caf.png');
    expect((await b.getSummary()).resources).toEqual(['rsa', 'housing_benefit']);
  });
  it('delete-all erases everything on the device and locks', async () => {
    const be = memoryBackend(); const v = createVault(be, FAST); await v.create(PASS);
    await v.addDocument({ name: 'a.pdf', type: 'application/pdf', bytes: PDF });
    await v.deleteAll();
    expect(v.isUnlocked()).toBe(false); expect(await v.exists()).toBe(false);
    expect(await be.all('items')).toEqual([]); expect(await be.all('meta')).toEqual([]);
  });
  it('auto-lock delay and its own IndexedDB database name (distinct from any other store of the site)', () => {
    expect(AUTO_LOCK_MS).toBe(300000);
    expect(PASSPORT_DB_NAME).toBe('ada-passeport-social-v1');
    const others = fs.readFileSync('src/lib/storage.js', 'utf8');
    expect(others).not.toContain(PASSPORT_DB_NAME);
  });
});

describe('nothing leaves the device', () => {
  const calls = [];
  let restore = [];
  beforeEach(() => {
    calls.length = 0;
    const spy = (name) => (...args) => { calls.push({ name, args }); throw new Error(`network call ${name}`); };
    const g = globalThis;
    restore = [['fetch', g.fetch], ['XMLHttpRequest', g.XMLHttpRequest], ['WebSocket', g.WebSocket]];
    g.fetch = vi.fn(spy('fetch')); g.XMLHttpRequest = vi.fn(spy('XMLHttpRequest')); g.WebSocket = vi.fn(spy('WebSocket'));
    if (!g.navigator) g.navigator = {};
    restore.push(['sendBeacon', g.navigator.sendBeacon]);
    g.navigator.sendBeacon = vi.fn(spy('sendBeacon'));
  });
  afterEach(() => { for (const [k, v] of restore) { if (k === 'sendBeacon') globalThis.navigator.sendBeacon = v; else globalThis[k] = v; } });
  it('a full journey (create, add, summary, lock, unlock, export, import, delete-all) makes no network call at all', async () => {
    const v = createVault(memoryBackend(), FAST); await v.create(PASS);
    const id = await v.addDocument({ name: 'bail.pdf', type: 'application/pdf', bytes: PDF });
    await v.saveSummary(cleanSummary({ household: 'single_parent' })); v.lock(); await v.unlock(PASS);
    await v.getDocument(id);
    const pkg = await v.exportPackage();
    const w = createVault(memoryBackend(), FAST); await w.create(PASS); await w.importPackage(pkg.bytes, pkg.code);
    await v.deleteAll();
    expect(calls).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled(); expect(globalThis.navigator.sendBeacon).not.toHaveBeenCalled();
  });
  it('the passport sources contain no network primitive', () => {
    for (const f of ['src/lib/passeport/crypto.js', 'src/lib/passeport/vault.js', 'src/lib/passeport/summary.js', 'src/pages/PasseportSocial.jsx']) {
      const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket|navigator\.serviceWorker|postMessage\(|citizenApi|proRdvRequest|\/api\//);
    }
  });
});

describe('closed summary', () => {
  it('drops unknown codes; no option names a sensitive category', () => {
    expect(cleanSummary({ housing: 'squat', resources: ['rsa', 'aah'], languages: ['fr', 'xx'], extra: 'x' })).toMatchObject({ housing: '', resources: ['rsa'], languages: ['fr'] });
    expect(cleanSummary({}).extra).toBeUndefined();
    for (const def of Object.values(SUMMARY_FIELDS)) for (const o of def.options) expect(sensitiveTextCategories(o.replace(/_/g, ' ')), o).toEqual([]);
    expect(SUMMARY_FIELDS.resources.options).not.toContain('aah');
  });
});
