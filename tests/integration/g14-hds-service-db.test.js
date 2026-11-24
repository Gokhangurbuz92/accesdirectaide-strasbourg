/**
 * G14-R3 — the HDS service end to end in the LAB: its own PostgreSQL database on the disposable test cluster (127.0.0.1:55434, *_test), its own
 * migrations, the real HTTP server on a free loopback port, tickets signed exactly as the main API signs them, and the browser's end-to-end crypto.
 *   - Mon Coffre: keyring, upload, list, download, delete, quotas, age policy, cross-person isolation, health consent gate;
 *   - tickets: single use (replay refused), scope, CORS (exact origin, preflight), no query strings;
 *   - shared-dossier data plane: grants, organisation access, revocation, access log;
 *   - encryption at rest: a pg_dump of the whole HDS database contains no canary (name, content, category);
 *   - logs: the service output contains no canary, no ticket, no subject id;
 *   - erasure + backup / restore drill: dump → erase → restore the dump → the erased person is back → re-apply the tombstones → gone again; the other
 *     person's document is intact and decrypts after the restore.
 * Run: npx vitest run tests/integration/g14-hds-service-db.test.js (skipped when the test cluster is unreachable).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
/** @typedef {import('pg').Pool} PgPool */
import { generateTicketKeyPair, parseTicketPrivateKey, signHdsTicket } from '../../api/lib/hds-ticket.js';
import { loadConfig } from '../../services/hds/src/config.js';
import { createPool, migrate } from '../../services/hds/src/db.js';
import { createApp } from '../../services/hds/src/app.js';
import { setLogSink } from '../../services/hds/src/log.js';
import { exportTombstones, reapplyTombstones } from '../../services/hds/src/service.js';
import * as vc from '../../src/lib/vaultCrypto.js';

const HOST = '127.0.0.1'; const PORT = 55434; const USER = 'ada_test';
const DB = 'ada_hds_g14r3_test'; const RESTORED = 'ada_hds_g14r3_restore_test';
const url = (/** @type {string} */ db) => `postgresql://${USER}@${HOST}:${PORT}/${db}`;
const ORIGIN = 'http://127.0.0.1:5173';
const CANARY = 'CANARY-HDS-91c2e4';
const pair = generateTicketKeyPair();
const key = /** @type {import('node:crypto').KeyObject} */ (parseTicketPrivateKey(pair.privateKeyB64));
const DATA_KEY = `k1:${'3c'.repeat(32)}`;

let reachable = false;
try { execFileSync('psql', [url('postgres'), '-Atc', 'SELECT 1'], { stdio: 'pipe', timeout: 5000 }); reachable = true; } catch { reachable = false; }

/** @type {string[]} */ const logLines = [];
/** @type {{ pool: PgPool, server: http.Server, base: string }[]} */ const running = [];

async function startService(/** @type {string} */ db, /** @type {Record<string, string>} */ extra = {}) {
  const cfg = loadConfig({ DATABASE_URL: url(db), ALLOWED_ORIGIN: ORIGIN, HDS_DATA_KEYS: DATA_KEY, HDS_TICKET_PUBLIC_KEYS: `k1:${pair.publicKeyB64}`, PORT: '4519', ...extra });
  const pool = createPool(cfg.databaseUrl);
  const server = http.createServer(createApp({ pool, cfg }));
  await new Promise((r) => { server.listen(0, HOST, () => r(undefined)); });
  const base = `http://${HOST}:${/** @type {any} */ (server.address()).port}`;
  const s = { pool, server, base };
  running.push(s);
  return s;
}
async function stop(/** @type {{ pool: PgPool, server: http.Server }} */ s) { await new Promise((r) => { s.server.close(() => r(undefined)); }); await s.pool.end(); }

const ticket = (/** @type {string} */ sub, /** @type {string[]} */ caps, /** @type {any} */ extra = {}) => signHdsTicket({ sub, typ: 'citizen', caps, ...extra }, { privateKey: key, kid: 'k1' }).ticket;
/** @param {string} base @param {string} method @param {string} p @param {{ t?: string, body?: any, origin?: string | null }} [o] */
async function call(base, method, p, o = {}) {
  const res = await fetch(`${base}${p}`, { method, headers: { ...(o.t ? { Authorization: `Bearer ${o.t}` } : {}), ...(o.origin === null ? {} : { Origin: o.origin || ORIGIN }), ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}
const pdf = (/** @type {string} */ s) => new TextEncoder().encode(`%PDF-1.4\n${s}\n%%EOF`);

describe.skipIf(!reachable)('G14-R3 HDS service on the LAB test cluster', () => {
  /** @type {{ pool: pg.Pool, server: http.Server, base: string }} */ let svc;
  const A = 'citizen-a-synthetic'; const B = 'citizen-b-synthetic';
  /** @type {CryptoKey} */ let vkA; /** @type {any} */ let keyringA;
  /** @type {string} */ let docA;

  beforeAll(async () => {
    for (const db of [DB, RESTORED]) execFileSync('psql', [url('postgres'), '-qc', `DROP DATABASE IF EXISTS ${db}`], { stdio: 'pipe' });
    execFileSync('psql', [url('postgres'), '-qc', `CREATE DATABASE ${DB}`], { stdio: 'pipe' });
    const p = createPool(url(DB), { max: 1 });
    expect(await migrate(p)).toEqual(['0001_hds_init.sql', '0002_hds_r4_sharing.sql']);
    expect(await migrate(p)).toEqual([]);   // idempotent
    await p.end();
    setLogSink((l) => logLines.push(l));
    svc = await startService(DB);
  }, 60000);
  afterAll(async () => {
    for (const s of running.splice(0)) await stop(s).catch(() => {});
    setLogSink((l) => process.stdout.write(`${l}\n`));
    for (const db of [DB, RESTORED]) { try { execFileSync('psql', [url('postgres'), '-qc', `DROP DATABASE IF EXISTS ${db}`], { stdio: 'pipe' }); } catch { /* cleanup */ } }
  });

  it('health, CORS preflight with the exact origin only, foreign origin refused, query strings refused', async () => {
    expect((await call(svc.base, 'GET', '/health')).body).toEqual({ service: 'ada-hds', ok: true });
    expect((await call(svc.base, 'GET', '/health/ready')).body).toEqual({ service: 'ada-hds', ready: true });
    const pre = await fetch(`${svc.base}/v1/vault/documents`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(pre.headers.get('access-control-allow-credentials')).toBeNull();
    expect((await call(svc.base, 'GET', '/v1/vault/documents', { t: ticket(A, ['citizen.vault']), origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(svc.base, 'GET', '/v1/vault/documents?x=1', { t: ticket(A, ['citizen.vault']) })).status).toBe(400);
    expect((await call(svc.base, 'GET', '/v1/vault/documents')).status).toBe(401);
  });

  it('tickets: single use, scoped to their capability and type', async () => {
    const t = ticket(A, ['citizen.vault']);
    expect((await call(svc.base, 'GET', '/v1/vault/documents', { t })).status).toBe(200);
    expect(await call(svc.base, 'GET', '/v1/vault/documents', { t })).toMatchObject({ status: 401, body: { reason: 'TICKET_REPLAYED' } });
    expect((await call(svc.base, 'GET', '/v1/vault/documents', { t: ticket(A, ['citizen.shared_dossier']) })).status).toBe(403);
    expect((await call(svc.base, 'POST', '/v1/internal/erase-subject', { t: ticket(A, ['hds.erase']), body: {} })).status).toBe(403);   // a citizen ticket never erases
  });

  it('Mon Coffre end to end: keyring first, then encrypted upload, list, download; quotas and age policy hold', async () => {
    const k = await vc.createKeyring('phrase secrète synthétique A');
    keyringA = k.keyring; vkA = k.vaultKey;
    const boxes = await vc.encryptDocument(vkA, { bytes: pdf(CANARY), name: `${CANARY}-avis.pdf`, category: 'sante', type: 'application/pdf' });
    expect(await call(svc.base, 'POST', '/v1/vault/documents', { t: ticket(A, ['citizen.vault', 'vault.write']), body: boxes })).toMatchObject({ status: 409, body: { error: 'KEYRING_REQUIRED' } });
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: ticket(A, ['citizen.vault']), body: { keyring: { ...keyringA, iterations: 1000 } } })).status).toBe(400);
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: ticket(A, ['citizen.vault']), body: { keyring: keyringA } })).status).toBe(201);
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: ticket(A, ['citizen.vault']), body: { keyring: keyringA } })).body.error).toBe('KEYRING_EXISTS');
    expect((await call(svc.base, 'POST', '/v1/vault/documents', { t: ticket(A, ['citizen.vault']), body: boxes })).body.error).toBe('AGE_POLICY_PENDING');
    const up = await call(svc.base, 'POST', '/v1/vault/documents', { t: ticket(A, ['citizen.vault', 'vault.write']), body: { ...boxes, expiresAt: '2030-01-01' } });
    expect(up.status).toBe(201);
    docA = up.body.document.id;
    const list = await call(svc.base, 'GET', '/v1/vault/documents', { t: ticket(A, ['citizen.vault']) });
    expect(list.body.quota).toMatchObject({ files: 1, maxFiles: 20 });
    expect(list.body.keyring).toEqual(keyringA);
    const unlocked = /** @type {CryptoKey} */ (await vc.unlockKeyring(list.body.keyring, 'phrase secrète synthétique A'));
    const doc = list.body.documents[0];
    expect(await vc.openMeta(unlocked, doc)).toEqual({ name: `${CANARY}-avis.pdf`, category: 'sante', type: 'application/pdf' });
    const dl = await call(svc.base, 'GET', `/v1/vault/documents/${docA}/content`, { t: ticket(A, ['citizen.vault']) });
    expect(new TextDecoder().decode(await vc.openContent(unlocked, doc, dl.body.content))).toContain(CANARY);
    // malformed / oversized envelopes
    expect((await call(svc.base, 'POST', '/v1/vault/documents', { t: ticket(A, ['citizen.vault', 'vault.write']), body: { ...boxes, content: { iv: boxes.content.iv, ct: 'A'.repeat(5_000_000) } } })).status).toBe(413);
    expect((await call(svc.base, 'POST', '/v1/vault/documents', { t: ticket(A, ['citizen.vault', 'vault.write']), body: { ...boxes, dek: { iv: 'x', ct: 'y' } } })).body.error).toBe('INVALID_ENVELOPE');
  }, 30000);

  it('another person sees, downloads and deletes nothing of it', async () => {
    const tB = () => ticket(B, ['citizen.vault', 'vault.write']);
    expect((await call(svc.base, 'GET', '/v1/vault/documents', { t: tB() })).body.documents).toEqual([]);
    expect((await call(svc.base, 'GET', `/v1/vault/documents/${docA}/content`, { t: tB() })).status).toBe(404);
    expect((await call(svc.base, 'DELETE', `/v1/vault/documents/${docA}`, { t: tB() })).status).toBe(404);
    const kb = await vc.createKeyring('phrase secrète synthétique B');
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: tB(), body: { keyring: kb.keyring } })).status).toBe(201);
    const bx = await vc.encryptDocument(kb.vaultKey, { bytes: pdf('B'), name: 'b.pdf', category: 'identite', type: 'application/pdf' });
    expect((await call(svc.base, 'POST', '/v1/vault/documents', { t: tB(), body: bx })).status).toBe(201);
  }, 30000);

  it('health consent: refused unless enabled AND the approved version is given explicitly; withdrawal recorded', async () => {
    expect((await call(svc.base, 'POST', '/v1/vault/health-consent', { t: ticket(A, ['citizen.vault']), body: { explicit: true, version: 'consentement-sante@v1' } })).body.error).toBe('HEALTH_DOCUMENTS_NOT_ACCEPTED');
    const on = await startService(DB, { HDS_HEALTH_CATEGORY_ENABLED: 'true', HDS_HEALTH_CONSENT_VERSION: 'consentement-sante@v1-2026-12-01' });
    expect((await call(on.base, 'POST', '/v1/vault/health-consent', { t: ticket(A, ['citizen.vault']), body: { explicit: true, version: 'consentement-sante@v0' } })).status).toBe(400);
    expect((await call(on.base, 'POST', '/v1/vault/health-consent', { t: ticket(A, ['citizen.vault']), body: { explicit: true, version: 'consentement-sante@v1-2026-12-01' } })).status).toBe(201);
    expect((await call(on.base, 'GET', '/v1/vault/documents', { t: ticket(A, ['citizen.vault']) })).body.healthConsent).toBe('consentement-sante@v1-2026-12-01');
    // G14-R4b: the list announces the category and its version (the browser shows the box only for the text it knows); off = { enabled: false, version: null }
    expect((await call(on.base, 'GET', '/v1/vault/documents', { t: ticket(A, ['citizen.vault']) })).body.healthCategory).toEqual({ enabled: true, version: 'consentement-sante@v1-2026-12-01' });
    expect((await call(svc.base, 'GET', '/v1/vault/documents', { t: ticket(A, ['citizen.vault']) })).body).toMatchObject({ healthCategory: { enabled: false, version: null }, healthConsent: null });
    // a consent to an older text version does not count once the service carries a new one (the person is asked again)
    const v2 = await startService(DB, { HDS_HEALTH_CATEGORY_ENABLED: 'true', HDS_HEALTH_CONSENT_VERSION: 'coffre-sante@v2-2027-01-01' });
    expect((await call(v2.base, 'GET', '/v1/vault/documents', { t: ticket(A, ['citizen.vault']) })).body.healthConsent).toBeNull();
    expect((await call(on.base, 'DELETE', '/v1/vault/health-consent', { t: ticket(A, ['citizen.vault']) })).body.healthConsent).toBeNull();
    await stop(on); running.splice(running.indexOf(on), 1);
  }, 30000);

  it('shared-dossier data plane: owner only, nobody else (grants, keys, re-key: tests/integration/g14-r4-hds-sharing-db.test.js)', async () => {
    const c = (/** @type {string} */ sub) => ticket(sub, ['citizen.shared_dossier']);
    const pro = (/** @type {string} */ str) => signHdsTicket({ sub: 'pro-synthetic-1', typ: 'pro', caps: ['citizen.shared_dossier'], str }, { privateKey: key, kid: 'k1' }).ticket;
    const content = { iv: Buffer.alloc(12, 1).toString('base64'), ct: Buffer.from(`opaque client ciphertext ${'x'.repeat(40)}`).toString('base64') };
    const created = await call(svc.base, 'POST', '/v1/dossiers', { t: c(A), body: { content } });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await call(svc.base, 'GET', `/v1/dossiers/${id}`, { t: pro('struct-1') })).status).toBe(404);
    expect((await call(svc.base, 'GET', `/v1/dossiers/${id}`, { t: c(B) })).status).toBe(404);
    expect((await call(svc.base, 'GET', `/v1/dossiers/${id}`, { t: c(A) })).body).toMatchObject({ id, content, files: [], grants: [] });
    // a grant without the person's explicit consent, or to an organisation without a key, is refused
    const wrappedKey = { iv: Buffer.alloc(12, 2).toString('base64'), ct: Buffer.alloc(48, 3).toString('base64') };
    expect((await call(svc.base, 'POST', `/v1/dossiers/${id}/grants`, { t: c(A), body: { structureId: 'struct-1', wrappedKey } })).status).toBe(400);
    const log = await call(svc.base, 'GET', `/v1/dossiers/${id}/access-log`, { t: c(A) });
    expect(log.body.events.map((/** @type {any} */ e) => e.action)).toEqual(['DOSSIER_CREATED']);
  }, 30000);

  it('encryption at rest: a dump of the whole HDS database holds no canary, no file name, no category', () => {
    const dump = execFileSync('pg_dump', ['--data-only', url(DB)], { maxBuffer: 256 * 1024 * 1024 }).toString('latin1');
    expect(dump.length).toBeGreaterThan(1000);
    for (const needle of [CANARY, `${CANARY}-avis.pdf`, 'avis.pdf', '"sante"', 'application/pdf', Buffer.from(CANARY).toString('hex')]) expect(dump.includes(needle), needle).toBe(false);
  });

  it('backup / restore drill with anti-resurrection; the restored service opens the surviving documents', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hds-drill-'));
    const file = path.join(dir, 'hds.dump');
    try {
      execFileSync('pg_dump', ['-Fc', '-f', file, url(DB)]);                       // T0 backup (A and B present)
      const erased = await call(svc.base, 'POST', '/v1/internal/erase-subject', { t: signHdsTicket({ sub: A, typ: 'system', caps: ['hds.erase'] }, { privateKey: key, kid: 'k1' }).ticket, body: {}, origin: null });
      expect(erased).toMatchObject({ status: 200, body: { vaultDocuments: 1, dossiers: 1 } });
      expect((await call(svc.base, 'GET', '/v1/vault/documents', { t: ticket(A, ['citizen.vault']) })).body).toMatchObject({ keyring: null, documents: [] });
      const tombs = await exportTombstones(svc.pool);                               // kept OUTSIDE the HDS database (content-free)
      expect(tombs).toHaveLength(1);
      expect(JSON.stringify(tombs)).not.toContain(A);
      execFileSync('psql', [url('postgres'), '-qc', `CREATE DATABASE ${RESTORED}`], { stdio: 'pipe' });
      execFileSync('pg_restore', ['--no-owner', '-d', url(RESTORED), file]);         // restore the T0 backup
      const restored = await startService(RESTORED);
      expect((await call(restored.base, 'GET', '/v1/vault/documents', { t: ticket(A, ['citizen.vault']) })).body.documents).toHaveLength(1);   // resurrected by the restore
      expect(await reapplyTombstones(restored.pool, tombs.map((x) => x.subjectHash))).toEqual({ subjectsErasedAgain: 1, tombstones: 1 });
      expect((await call(restored.base, 'GET', '/v1/vault/documents', { t: ticket(A, ['citizen.vault']) })).body).toMatchObject({ keyring: null, documents: [] });
      const listB = await call(restored.base, 'GET', '/v1/vault/documents', { t: ticket(B, ['citizen.vault']) });
      const vkB = /** @type {CryptoKey} */ (await vc.unlockKeyring(listB.body.keyring, 'phrase secrète synthétique B'));
      const dB = listB.body.documents[0];
      const cB = await call(restored.base, 'GET', `/v1/vault/documents/${dB.id}/content`, { t: ticket(B, ['citizen.vault']) });
      expect(new TextDecoder().decode(await vc.openContent(vkB, dB, cB.body.content))).toContain('B');
      // a restore with a different KEK opens nothing (the key lives in the HDS environment, not in the dump)
      const wrongKek = await startService(RESTORED, { HDS_DATA_KEYS: `k1:${'9d'.repeat(32)}` });
      expect((await call(wrongKek.base, 'GET', `/v1/vault/documents/${dB.id}/content`, { t: ticket(B, ['citizen.vault']) })).status).toBe(500);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60000);

  it('the service output carries no canary, no ticket and no subject id', () => {
    const all = logLines.join('\n');
    expect(logLines.length).toBeGreaterThan(20);
    for (const needle of [CANARY, 'Bearer', 'eyJ', A, B, 'struct-1', 'pro-synthetic-1']) expect(all.includes(needle), needle).toBe(false);
    expect(JSON.parse(logLines.find((l) => l.includes('/v1/vault/documents/:id/content')) || '{}')).toMatchObject({ evt: 'req', route: '/v1/vault/documents/:id/content' });
  });
});
