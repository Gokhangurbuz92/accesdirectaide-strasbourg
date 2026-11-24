/**
 * G14-R4 — shared dossiers, organisation keys, referral payloads and message attachments in the HDS service, end to end on the LAB test cluster
 * (127.0.0.1:55434, its own *_test database, the real HTTP server, tickets signed as the main API signs them, the browser's crypto from src/lib/dossierCrypto.js):
 *   - keys: member key pairs (passphrase), organisation key (administrator only), wraps per member, rotation;
 *   - dossier: owner key, explicit consent to the approved text, expiry, organisation reads and decrypts, files both ways, thread, professional events;
 *   - revocation RE-WRAPS: after a revoke the dossier is re-keyed atomically; the remaining organisation still decrypts, the old key no longer opens;
 *   - referral payload: the sender wraps for the receiver → pending grant → only the person activates (or refuses, note erased);
 *   - attachments: bound to one conversation (ticket obj), wrapped for the person AND the organisation; another conversation sees nothing;
 *   - export (ciphertext, decryptable by the person), retention purge, erasure of the new objects, anti-resurrection list;
 *   - canaries: no clear text in a dump of the HDS database nor in the service output.
 * Run: npx vitest run tests/integration/g14-r4-hds-sharing-db.test.js (skipped when the test cluster is unreachable).
 */
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTicketKeyPair, parseTicketPrivateKey, signHdsTicket } from '../../api/lib/hds-ticket.js';
import { loadConfig } from '../../services/hds/src/config.js';
import { createPool, migrate } from '../../services/hds/src/db.js';
import { createApp } from '../../services/hds/src/app.js';
import { setLogSink } from '../../services/hds/src/log.js';
import { exportTombstones } from '../../services/hds/src/service.js';
import { purgeExpired } from '../../services/hds/src/sharing.js';
import * as vc from '../../src/lib/vaultCrypto.js';
import * as dc from '../../src/lib/dossierCrypto.js';

const HOST = '127.0.0.1'; const PORT = 55434; const USER = 'ada_test';
const DB = 'ada_hds_g14r4_test';
const url = (/** @type {string} */ db) => `postgresql://${USER}@${HOST}:${PORT}/${db}`;
const ORIGIN = 'http://127.0.0.1:5173';
const CANARY = 'CANARY-R4-SHARE-5d1e';
const CONSENT = 'partage-dossier@v1-2026-12-01';
const pair = generateTicketKeyPair();
const key = /** @type {import('node:crypto').KeyObject} */ (parseTicketPrivateKey(pair.privateKeyB64));

let reachable = false;
try { execFileSync('psql', [url('postgres'), '-Atc', 'SELECT 1'], { stdio: 'pipe', timeout: 5000 }); reachable = true; } catch { reachable = false; }

/** @type {string[]} */ const logLines = [];
const sign = (/** @type {any} */ who) => signHdsTicket(who, { privateKey: key, kid: 'k1' }).ticket;
const cit = (/** @type {string} */ sub, caps = ['citizen.shared_dossier', 'citizen.vault', 'vault.write'], extra = {}) => sign({ sub, typ: 'citizen', caps, ...extra });
const pro = (/** @type {string} */ sub, /** @type {string} */ str, role = 'PRO', caps = ['citizen.shared_dossier', 'pro.referrals'], extra = {}) => sign({ sub, typ: 'pro', caps, str, role, ...extra });
/** @param {string} base @param {string} method @param {string} p @param {{ t?: string, body?: any }} [o] */
async function call(base, method, p, o = {}) {
  const res = await fetch(`${base}${p}`, { method, headers: { ...(o.t ? { Authorization: `Bearer ${o.t}` } : {}), Origin: ORIGIN, ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const pdf = (/** @type {string} */ s) => new TextEncoder().encode(`%PDF-1.4\n${s}\n%%EOF`);

describe.skipIf(!reachable)('G14-R4 HDS sharing on the LAB test cluster', () => {
  /** @type {{ pool: import('pg').Pool, server: http.Server, base: string }} */ let svc;
  const P = 'citizen-r4-synthetic'; const Q = 'citizen-r4-other';
  const S1 = 'struct-r4-one'; const S2 = 'struct-r4-two';
  const ADMIN1 = 'pro-r4-admin-1'; const MEMBER1 = 'pro-r4-member-1'; const ADMIN2 = 'pro-r4-admin-2';
  /** @type {CryptoKey} */ let vaultKey; /** @type {Record<string, CryptoKey>} */ const memberKeys = {};
  /** @type {Record<string, CryptoKey>} */ const orgKeys = {};
  /** @type {string} */ let dossierId; /** @type {Uint8Array} */ let dossierRaw; /** @type {CryptoKey} */ let dossierKey;

  beforeAll(async () => {
    execFileSync('psql', [url('postgres'), '-qc', `DROP DATABASE IF EXISTS ${DB}`], { stdio: 'pipe' });
    execFileSync('psql', [url('postgres'), '-qc', `CREATE DATABASE ${DB}`], { stdio: 'pipe' });
    const cfg = loadConfig({ DATABASE_URL: url(DB), ALLOWED_ORIGIN: ORIGIN, HDS_DATA_KEYS: `k1:${'4e'.repeat(32)}`, HDS_TICKET_PUBLIC_KEYS: `k1:${pair.publicKeyB64}`, PORT: '4521', HDS_SHARE_CONSENT_VERSION: CONSENT });
    const pool = createPool(cfg.databaseUrl);
    expect(await migrate(pool)).toEqual(['0001_hds_init.sql', '0002_hds_r4_sharing.sql']);
    setLogSink((l) => logLines.push(l));
    const server = http.createServer(createApp({ pool, cfg }));
    await new Promise((r) => { server.listen(0, HOST, () => r(undefined)); });
    svc = { pool, server, base: `http://${HOST}:${/** @type {any} */ (server.address()).port}` };
  }, 60000);
  afterAll(async () => {
    if (svc) { await new Promise((r) => { svc.server.close(() => r(undefined)); }); await svc.pool.end(); }
    setLogSink((l) => process.stdout.write(`${l}\n`));
    try { execFileSync('psql', [url('postgres'), '-qc', `DROP DATABASE IF EXISTS ${DB}`], { stdio: 'pipe' }); } catch { /* cleanup */ }
  });

  it('member keys and organisation keys: passphrase-wrapped, administrator only, one wrap per member', async () => {
    for (const [m, s] of [[ADMIN1, S1], [MEMBER1, S1], [ADMIN2, S2]]) {
      const k = await dc.createMemberKeyring(`phrase pro ${m}`, 600000);
      expect((await call(svc.base, 'PUT', '/v1/pro/member-key', { t: pro(m, s), body: { publicJwk: k.publicJwk, keyring: { ...k.keyring, iterations: 1000 } } })).status).toBe(400);
      expect((await call(svc.base, 'PUT', '/v1/pro/member-key', { t: pro(m, s), body: { publicJwk: k.publicJwk, keyring: k.keyring } })).status).toBe(201);
      const state = await call(svc.base, 'GET', '/v1/pro/keys', { t: pro(m, s) });
      memberKeys[m] = /** @type {CryptoKey} */ (await dc.unlockMemberKeyring(state.body.member.keyring, `phrase pro ${m}`));
      expect(await dc.unlockMemberKeyring(state.body.member.keyring, 'wrong phrase here')).toBeNull();
    }
    const st1 = await call(svc.base, 'GET', '/v1/pro/keys', { t: pro(ADMIN1, S1, 'STRUCTURE_ADMIN') });
    const ok1 = await dc.createOrgKey([{ memberRef: ADMIN1, publicJwk: st1.body.member.publicJwk }]);
    expect((await call(svc.base, 'POST', '/v1/pro/org-keys', { t: pro(MEMBER1, S1), body: { kid: ok1.kid, publicJwk: ok1.publicJwk, wraps: ok1.wraps } })).status).toBe(403);   // not an administrator
    expect((await call(svc.base, 'POST', '/v1/pro/org-keys', { t: pro(ADMIN1, S1, 'STRUCTURE_ADMIN'), body: { kid: ok1.kid, publicJwk: ok1.publicJwk, wraps: [] } })).body.error).toBe('SELF_WRAP_REQUIRED');
    expect((await call(svc.base, 'POST', '/v1/pro/org-keys', { t: pro(ADMIN1, S1, 'STRUCTURE_ADMIN'), body: { kid: ok1.kid, publicJwk: { ...ok1.publicJwk, d: 'x' }, wraps: ok1.wraps } })).status).toBe(400);   // never a private key
    expect((await call(svc.base, 'POST', '/v1/pro/org-keys', { t: pro(ADMIN1, S1, 'STRUCTURE_ADMIN'), body: { kid: ok1.kid, publicJwk: ok1.publicJwk, wraps: ok1.wraps } })).status).toBe(201);
    // the administrator wraps the organisation key for the member who created a key afterwards
    const adm = await call(svc.base, 'GET', '/v1/pro/keys', { t: pro(ADMIN1, S1, 'STRUCTURE_ADMIN') });
    expect(adm.body.pendingMembers.map((/** @type {any} */ x) => x.memberRef)).toEqual([MEMBER1]);
    const orgJwk = await dc.openOrgPrivateJwk(memberKeys[ADMIN1], adm.body.orgKeys[0].wrappedPrivate);
    const w = await dc.wrapOrgPrivateFor(orgJwk, ok1.kid, adm.body.pendingMembers[0].publicJwk);
    expect((await call(svc.base, 'POST', '/v1/pro/org-keys/members', { t: pro(ADMIN1, S1, 'STRUCTURE_ADMIN'), body: { memberRef: MEMBER1, wraps: [{ kid: ok1.kid, wrappedPrivate: w }] } })).status).toBe(200);
    const mem = await call(svc.base, 'GET', '/v1/pro/keys', { t: pro(MEMBER1, S1) });
    orgKeys[S1] = await dc.importPrivateJwk(await dc.openOrgPrivateJwk(memberKeys[MEMBER1], mem.body.orgKeys[0].wrappedPrivate));
    expect(mem.body.pendingMembers).toEqual([]);   // only an administrator sees the members to wrap
    const st2 = await call(svc.base, 'GET', '/v1/pro/keys', { t: pro(ADMIN2, S2, 'STRUCTURE_ADMIN') });
    const ok2 = await dc.createOrgKey([{ memberRef: ADMIN2, publicJwk: st2.body.member.publicJwk }]);
    expect((await call(svc.base, 'POST', '/v1/pro/org-keys', { t: pro(ADMIN2, S2, 'STRUCTURE_ADMIN'), body: { kid: ok2.kid, publicJwk: ok2.publicJwk, wraps: ok2.wraps } })).status).toBe(201);
    orgKeys[S2] = await dc.importPrivateJwk(ok2.privateJwk);
  }, 60000);

  it('dossier: owner key, explicit consent to the approved text, expiry checks, organisation decrypts content, files and thread', async () => {
    const k = await vc.createKeyring('phrase secrète R4 personne');
    vaultKey = k.vaultKey;
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: cit(P), body: { keyring: k.keyring } })).status).toBe(201);
    const made = await dc.createDossier(vaultKey, { title: `${CANARY} dossier`, situation: { logement: 'synthétique' } });
    dossierRaw = made.raw; dossierKey = made.key;
    expect((await call(svc.base, 'POST', '/v1/dossiers', { t: cit(P), body: { ...made.body, expiresAt: '2001-01-01' } })).body.error).toBe('INVALID_DATE');
    const created = await call(svc.base, 'POST', '/v1/dossiers', { t: cit(P), body: made.body });
    expect(created.status).toBe(201);
    dossierId = created.body.id;
    const pub = await call(svc.base, 'GET', `/v1/orgs/${S1}/public-key`, { t: cit(P) });
    expect(pub.body).toMatchObject({ structureId: S1, kid: expect.any(String) });
    expect((await call(svc.base, 'GET', '/v1/orgs/struct-without-key/public-key', { t: cit(P) })).body.error).toBe('ORG_KEY_MISSING');
    const wrappedKey = await dc.wrapForOrg(dossierRaw, pub.body);
    const grant = (/** @type {any} */ extra) => call(svc.base, 'POST', `/v1/dossiers/${dossierId}/grants`, { t: cit(P), body: { structureId: S1, wrappedKey, keyEpoch: 1, ...extra } });
    expect((await grant({})).body.error).toBe('SHARE_CONSENT_REQUIRED');
    expect((await grant({ consent: { explicit: true, version: 'partage-dossier@v0' } })).body.error).toBe('SHARE_CONSENT_REQUIRED');
    expect((await grant({ consent: { explicit: true, version: CONSENT }, keyEpoch: 7 })).body.error).toBe('KEY_EPOCH_STALE');
    expect((await grant({ consent: { explicit: true, version: CONSENT }, expiresAt: '2030-06-30' })).status).toBe(200);
    // the organisation reads and decrypts with ITS key; another organisation and another person see nothing
    const seen = await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: pro(MEMBER1, S1) });
    expect(seen.status).toBe(200);
    const gk = await dc.openGrantKey(orgKeys[S1], seen.body.wrappedKey);
    expect((await dc.decryptContent(gk.key, seen.body.content)).title).toBe(`${CANARY} dossier`);
    expect((await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: pro(ADMIN2, S2) })).status).toBe(404);
    expect((await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: cit(Q) })).status).toBe(404);
    // files both ways: the person adds one, the organisation adds one; each side opens both
    const fileP = await vc.encryptDocument(dossierKey, { bytes: pdf(`${CANARY} attestation`), name: `${CANARY}.pdf`, category: 'autre', type: 'application/pdf' });
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/files`, { t: cit(P), body: { ...fileP, keyEpoch: 1 } })).status).toBe(201);
    const fileS = await vc.encryptDocument(gk.key, { bytes: pdf('réponse de la structure'), name: 'reponse.pdf', category: 'autre', type: 'application/pdf' });
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/files`, { t: pro(MEMBER1, S1), body: fileS })).status).toBe(201);
    const own = await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: cit(P) });
    expect(own.body.files).toHaveLength(2);
    const ownKey = await dc.openOwnerKey(vaultKey, own.body.ownerKey);
    for (const f of own.body.files) {
      const c = await call(svc.base, 'GET', `/v1/dossiers/${dossierId}/files/${f.id}/content`, { t: cit(P) });
      expect(new TextDecoder().decode(await vc.openContent(ownKey.key, f, c.body.content))).toMatch(/%PDF/);
    }
    // thread
    const msg = await dc.encryptMessage(dossierKey, `${CANARY} bonjour`);
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/threads/${S1}`, { t: cit(P), body: { ...msg, keyEpoch: 1 } })).status).toBe(201);
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/threads/${S2}`, { t: cit(P), body: { ...msg, keyEpoch: 1 } })).body.error).toBe('NO_ACTIVE_GRANT');
    const reply = await dc.encryptMessage(gk.key, 'réponse');
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/threads/${S1}`, { t: pro(MEMBER1, S1), body: { ...reply, keyEpoch: 1 } })).status).toBe(201);
    expect((await call(svc.base, 'GET', `/v1/dossiers/${dossierId}/threads/${S2}`, { t: pro(ADMIN2, S2) })).status).toBe(404);
    const th = await call(svc.base, 'GET', `/v1/dossiers/${dossierId}/threads/${S1}`, { t: pro(MEMBER1, S1) });
    expect(await Promise.all(th.body.messages.map((/** @type {any} */ m) => dc.decryptMessage(gk.key, m)))).toEqual([`${CANARY} bonjour`, 'réponse']);
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/events`, { t: pro(MEMBER1, S1), body: { action: 'SIAO_HANDOVER_PREPARED' } })).status).toBe(201);
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/events`, { t: pro(MEMBER1, S1), body: { action: 'ANYTHING' } })).status).toBe(400);
    expect((await call(svc.base, 'GET', '/v1/pro/dossiers', { t: pro(MEMBER1, S1) })).body.dossiers.map((/** @type {any} */ d) => d.id)).toEqual([dossierId]);
  }, 60000);

  it('referral payload: the sender wraps for the receiver, only the person activates; refusal erases the note', async () => {
    const seen = await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: pro(MEMBER1, S1) });
    const gk = await dc.openGrantKey(orgKeys[S1], seen.body.wrappedKey);
    const to = await call(svc.base, 'GET', `/v1/orgs/${S2}/public-key`, { t: pro(MEMBER1, S1) });
    const body = { toStructureId: S2, referralRef: 'referral-r4-0001', wrappedKey: await dc.wrapForOrg(gk.raw, to.body), keyEpoch: 1, note: await dc.encryptMessage(gk.key, `${CANARY} motif détaillé`) };
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/referrals`, { t: pro(MEMBER1, S1, 'PRO', ['citizen.shared_dossier']), body })).status).toBe(403);   // cap pro.referrals required
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/referrals`, { t: pro(MEMBER1, S1), body })).status).toBe(201);
    expect((await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: pro(ADMIN2, S2) })).status).toBe(404);   // pending: nothing visible to the receiver
    const sys = sign({ sub: 'ada-main', typ: 'system', caps: ['hds.dossier-ref'] });
    expect((await call(svc.base, 'POST', '/v1/internal/dossier-ref', { t: sys, body: { dossierId, structureId: S1, toStructureId: S2 } })).body).toEqual({ exists: true, active: true, ownerId: P, toStatus: 'pending_citizen' });
    expect((await call(svc.base, 'POST', '/v1/internal/dossier-ref', { t: cit(P), body: { dossierId, structureId: S1 } })).status).toBe(403);
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/referral-answer`, { t: cit(P), body: { structureId: S2, accept: true } })).body.error).toBe('SHARE_CONSENT_REQUIRED');
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/referral-answer`, { t: cit(P), body: { structureId: S2, accept: true, consent: { explicit: true, version: CONSENT } } })).body).toMatchObject({ status: 'active', referralRef: 'referral-r4-0001' });
    const r2 = await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: pro(ADMIN2, S2) });
    expect(r2.status).toBe(200);
    const k2 = await dc.openGrantKey(orgKeys[S2], r2.body.wrappedKey);
    expect((await dc.decryptContent(k2.key, r2.body.content)).title).toContain(CANARY);
    const note = (await call(svc.base, 'GET', `/v1/dossiers/${dossierId}/threads/${S2}`, { t: pro(ADMIN2, S2) })).body.messages[0];
    expect(note).toMatchObject({ kind: 'referral_note', referralRef: 'referral-r4-0001' });
    expect(await dc.decryptMessage(k2.key, note)).toBe(`${CANARY} motif détaillé`);
  }, 60000);

  it('revocation re-wraps: atomic re-key, the remaining organisation decrypts, the old key opens nothing new', async () => {
    const rv = await call(svc.base, 'DELETE', `/v1/dossiers/${dossierId}/grants`, { t: cit(P), body: { structureId: S1 } });
    expect(rv.body).toMatchObject({ active: false, rekeyRequired: true, keyEpoch: 1 });
    expect((await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: pro(MEMBER1, S1) })).status).toBe(404);
    const own = await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: cit(P) });
    expect(own.body.rekeyRequired).toBe(true);
    const oldKey = (await dc.openOwnerKey(vaultKey, own.body.ownerKey)).key;
    const messages = [];
    for (const g of own.body.grants) messages.push(...(await call(svc.base, 'GET', `/v1/dossiers/${dossierId}/threads/${g.structureId}`, { t: cit(P) })).body.messages);
    const remaining = own.body.grants.filter((/** @type {any} */ g) => g.status === 'active');
    const orgs = await Promise.all(remaining.map(async (/** @type {any} */ g) => ({ structureId: g.structureId, ...(await call(svc.base, 'GET', `/v1/orgs/${g.structureId}/public-key`, { t: cit(P) })).body })));
    const rk = await dc.rekeyPayload({ vaultKey, oldKey, dossier: own.body, messages, orgs });
    // incomplete → refused, nothing changed
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/rekey`, { t: cit(P), body: { ...rk.payload, files: rk.payload.files.slice(1) } })).body.error).toBe('REKEY_INCOMPLETE');
    expect((await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: cit(P) })).body.keyEpoch).toBe(1);
    expect((await call(svc.base, 'POST', `/v1/dossiers/${dossierId}/rekey`, { t: cit(P), body: rk.payload })).body).toEqual({ id: dossierId, keyEpoch: 2 });
    expect((await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: cit(P) })).body.rekeyRequired).toBe(false);
    const r2 = await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: pro(ADMIN2, S2) });
    const k2 = await dc.openGrantKey(orgKeys[S2], r2.body.wrappedKey);
    expect((await dc.decryptContent(k2.key, r2.body.content)).title).toContain(CANARY);
    await expect(dc.decryptContent(dossierKey, r2.body.content)).rejects.toThrow();   // the revoked organisation's copy of the OLD key opens nothing new
    const f = r2.body.files.find((/** @type {any} */ x) => x.addedBy === 'citizen');
    const fc = await call(svc.base, 'GET', `/v1/dossiers/${dossierId}/files/${f.id}/content`, { t: pro(ADMIN2, S2) });
    expect(new TextDecoder().decode(await vc.openContent(k2.key, f, fc.body.content))).toContain(CANARY);
    const note = (await call(svc.base, 'GET', `/v1/dossiers/${dossierId}/threads/${S2}`, { t: pro(ADMIN2, S2) })).body.messages[0];
    expect(await dc.decryptMessage(k2.key, note)).toContain(CANARY);
    const log = await call(svc.base, 'GET', `/v1/dossiers/${dossierId}/access-log`, { t: cit(P) });
    expect(log.body.events.map((/** @type {any} */ e) => e.action)).toEqual(expect.arrayContaining(['DOSSIER_ACCESS_GRANTED', 'DOSSIER_VIEWED', 'FILE_UPLOADED', 'THREAD_MESSAGE_POSTED',
      'SIAO_HANDOVER_PREPARED', 'REFERRAL_ACCESS_PROPOSED', 'REFERRAL_ACCESS_ACCEPTED', 'DOSSIER_ACCESS_REVOKED', 'DOSSIER_REKEYED']));
    expect(JSON.stringify(log.body)).not.toContain(MEMBER1);
  }, 60000);

  it('attachments: bound to ONE conversation, wrapped for the person and the organisation; nothing crosses conversations', async () => {
    const binding = `rdvconv:conv-r4-1:${P}:${S1}`;
    const tc = () => cit(P, ['messaging.attachments'], { obj: binding });
    const tp = () => pro(MEMBER1, S1, 'PRO', ['messaging.attachments'], { obj: binding });
    expect((await call(svc.base, 'GET', '/v1/attachments/keys', { t: cit(P, ['messaging.attachments']) })).status).toBe(403);   // no binding
    expect((await call(svc.base, 'GET', '/v1/attachments/keys', { t: cit(Q, ['messaging.attachments'], { obj: binding }) })).status).toBe(403);   // not the person of the binding
    expect((await call(svc.base, 'GET', '/v1/attachments/keys', { t: tc() })).body).toMatchObject({ ready: false, citizen: null });
    const box = await dc.createBoxKey(vaultKey);
    expect((await call(svc.base, 'PUT', '/v1/vault/box-key', { t: cit(P), body: { publicJwk: box.publicJwk, privateWrapped: box.privateWrapped } })).status).toBe(201);
    const keys = await call(svc.base, 'GET', '/v1/attachments/keys', { t: tp() });
    expect(keys.body.ready).toBe(true);
    const att = await dc.encryptAttachment({ bytes: pdf(`${CANARY} ordonnance`), name: `${CANARY}-ordonnance.pdf`, type: 'application/pdf' }, keys.body);
    const up = await call(svc.base, 'POST', '/v1/attachments', { t: tp(), body: att });
    expect(up.status).toBe(201);
    const mine = await call(svc.base, 'GET', `/v1/attachments/${up.body.id}`, { t: tc() });
    const boxKey = await dc.openBoxKey(vaultKey, (await call(svc.base, 'GET', '/v1/vault/box-key', { t: cit(P) })).body.boxKey.privateWrapped);
    const opened = await dc.decryptAttachment(boxKey, mine.body);
    expect(opened.name).toBe(`${CANARY}-ordonnance.pdf`);
    expect(new TextDecoder().decode(opened.bytes)).toContain(CANARY);
    const theirs = await call(svc.base, 'GET', `/v1/attachments/${up.body.id}`, { t: tp() });
    expect((await dc.decryptAttachment(orgKeys[S1], theirs.body)).type).toBe('application/pdf');
    expect((await call(svc.base, 'GET', `/v1/attachments/${up.body.id}`, { t: cit(P, ['messaging.attachments'], { obj: `rdvconv:conv-r4-2:${P}:${S1}` }) })).status).toBe(404);
    expect((await call(svc.base, 'GET', `/v1/attachments/${up.body.id}`, { t: pro(ADMIN2, S2, 'PRO', ['messaging.attachments'], { obj: binding }) })).status).toBe(404);   // another organisation: same « not found »
  }, 60000);

  it('export: everything the person owns, decryptable by the person only', async () => {
    const ex = await call(svc.base, 'GET', '/v1/vault/export', { t: cit(P) });
    expect(ex.body).toMatchObject({ format: 'ada-hds-export/1', dossiers: [expect.objectContaining({ id: dossierId })], attachments: [expect.objectContaining({ conversation: 'conv-r4-1' })] });
    expect(JSON.stringify(ex.body)).not.toContain(CANARY);
    const k = await dc.openOwnerKey(vaultKey, ex.body.dossiers[0].ownerKey);
    expect((await dc.decryptContent(k.key, ex.body.dossiers[0].content)).title).toContain(CANARY);
    expect(ex.body.consents.filter((/** @type {any} */ c) => c.purpose === 'dossier_share').length).toBeGreaterThanOrEqual(2);
  }, 30000);

  it('retention: an expired dossier is purged after the grace period; expired grants stop opening', async () => {
    const made = await dc.createDossier(vaultKey, { title: 'court' });
    const c = await call(svc.base, 'POST', '/v1/dossiers', { t: cit(P), body: made.body });
    await svc.pool.query("UPDATE hds.dossier SET expires_at = now() - interval '40 days' WHERE id = $1", [c.body.id]);
    await svc.pool.query("UPDATE hds.dossier_grant SET expires_at = now() - interval '1 day' WHERE dossier_id = $1 AND structure_id = $2", [dossierId, S2]);
    expect((await call(svc.base, 'GET', `/v1/dossiers/${dossierId}`, { t: pro(ADMIN2, S2) })).status).toBe(404);
    const out = await purgeExpired(svc.pool, { graceDays: 30 });
    expect(out).toMatchObject({ dossiersErased: 1, grantsExpired: 1 });
    expect((await call(svc.base, 'GET', `/v1/dossiers/${c.body.id}`, { t: cit(P) })).status).toBe(404);
  }, 30000);

  it('Mon Coffre recovery (zero-knowledge): a replacement needs the one-way proof and keeps the same vault key; recovery and passphrase change', async () => {
    const R = 'citizen-r4-recovery';
    const k = await vc.createKeyring('phrase initiale R4');
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: cit(R), body: { keyring: { ...k.keyring, authHash: undefined } } })).body.error).toBe('INVALID_KEYRING');   // a new keyring carries its proof hash
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: cit(R), body: { keyring: k.keyring } })).status).toBe(201);
    const box = await vc.encryptDocument(k.vaultKey, { bytes: pdf(`${CANARY} coffre`), name: 'a.pdf', category: 'autre', type: 'application/pdf' });
    expect((await call(svc.base, 'POST', '/v1/vault/documents', { t: cit(R), body: box })).status).toBe(201);
    // a stolen session cannot silently replace the protection (it would orphan every document)
    const other = await vc.createKeyring('phrase de l’attaquant');
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: cit(R), body: { keyring: other.keyring, replace: true } })).body.error).toBe('KEYRING_PROOF_REQUIRED');
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: cit(R), body: { keyring: other.keyring, replace: true, authToken: other.authToken } })).body.error).toBe('KEYRING_PROOF_REQUIRED');
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: cit(R), body: { keyring: other.keyring, replace: true, authToken: k.authToken } })).body.error).toBe('KEYRING_KEY_CHANGED');
    // forgotten passphrase: the recovery code
    const stored = (await call(svc.base, 'GET', '/v1/vault/documents', { t: cit(R) })).body;
    const rec = /** @type {any} */ (await vc.recoverWithCode(stored.keyring, k.recoveryCode, 'phrase après secours'));
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: cit(R), body: { keyring: rec.keyring, replace: true, authToken: rec.authToken, reason: 'recovery' } })).status).toBe(200);
    const after = (await call(svc.base, 'GET', '/v1/vault/documents', { t: cit(R) })).body;
    const vk = /** @type {CryptoKey} */ (await vc.unlockKeyring(after.keyring, 'phrase après secours'));
    const doc = after.documents[0];
    const c = await call(svc.base, 'GET', `/v1/vault/documents/${doc.id}/content`, { t: cit(R) });
    expect(new TextDecoder().decode(await vc.openContent(vk, doc, c.body.content))).toContain(CANARY);   // same vault key: documents intact
    expect(await vc.recoverWithCode(after.keyring, k.recoveryCode, 'zzzzzzzzzzzz')).toBeNull();   // the used code is spent
    const ch = /** @type {any} */ (await vc.changePassphrase(after.keyring, 'phrase après secours', 'phrase changée R4'));
    expect((await call(svc.base, 'PUT', '/v1/vault/keyring', { t: cit(R), body: { keyring: ch.keyring, replace: true, authToken: ch.authToken, reason: 'passphrase_change' } })).status).toBe(200);
    expect(await vc.recoverWithCode((await call(svc.base, 'GET', '/v1/vault/documents', { t: cit(R) })).body.keyring, rec.recoveryCode, 'phrase de secours 2')).not.toBeNull();
    const ev = (await svc.pool.query("SELECT action FROM hds.access_event WHERE owner_id = $1 AND object_type = 'vault_keyring' ORDER BY id", [R])).rows.map((r) => r.action);
    expect(ev).toEqual(['VAULT_KEYRING_CREATED', 'VAULT_RECOVERED_WITH_CODE', 'VAULT_PASSPHRASE_CHANGED']);
    const dump = execFileSync('pg_dump', ['--data-only', url(DB)], { maxBuffer: 256 * 1024 * 1024 }).toString('latin1');
    for (const secret of [k.recoveryCode.replace(/-/g, ''), rec.recoveryCode.replace(/-/g, ''), k.authToken, 'phrase changée']) expect(dump.includes(secret), 'secret in dump').toBe(false);
    await call(svc.base, 'POST', '/v1/internal/erase-subject', { t: sign({ sub: R, typ: 'system', caps: ['hds.erase'] }), body: {} });
  }, 120000);

  it('canaries: a dump of the HDS database holds no clear text; erasure covers the new objects; the output carries no id', async () => {
    const dump = execFileSync('pg_dump', ['--data-only', url(DB)], { maxBuffer: 256 * 1024 * 1024 }).toString('latin1');
    for (const needle of [CANARY, 'ordonnance', 'motif détaillé', 'bonjour', 'synthétique', 'application/pdf', '"d":']) expect(dump.includes(needle), needle).toBe(false);
    const erased = await call(svc.base, 'POST', '/v1/internal/erase-subject', { t: sign({ sub: P, typ: 'system', caps: ['hds.erase'] }), body: {} });
    expect(erased.body).toMatchObject({ dossiers: 1, attachments: 1 });
    for (const t of ['hds.dossier', 'hds.message_attachment', 'hds.citizen_box_key', 'hds.vault_keyring', 'hds.consent_record']) {
      expect(Number((await svc.pool.query(`SELECT count(*) FROM ${t} WHERE owner_id = $1`, [P])).rows[0].count), t).toBe(0);
    }
    const pm = await call(svc.base, 'POST', '/v1/internal/erase-subject', { t: sign({ sub: MEMBER1, typ: 'system', caps: ['hds.erase'] }), body: {} });
    expect(pm.body.memberKeys).toBe(1);
    expect((await exportTombstones(svc.pool)).length).toBe(3);
    const all = logLines.join('\n');
    for (const needle of [CANARY, 'Bearer', 'eyJ', P, S1, S2, MEMBER1, ADMIN1, 'rdvconv']) expect(all.includes(needle), needle).toBe(false);
  }, 30000);
});
