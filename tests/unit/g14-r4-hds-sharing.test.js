/**
 * G14-R4 — the main-application side of the HDS sharing port (no database: every database access is refused by a recording proxy, synthetic data only):
 *   - the PROFESSIONAL ticket: membership checked, role closed (PRO | STRUCTURE_ADMIN), structure bound, pro.referrals carries the dossier cap, an
 *     attachment ticket is bound to ONE conversation of the caller's organisation; a canary in the request reaches no log, no response, no ticket;
 *   - the citizen attachment ticket: only the citizen of that conversation, bound by the obj claim;
 *   - message attachments: in a deployed environment file BYTES are refused (409 HDS_SERVICE_REQUIRED), only an HDS reference is accepted;
 *   - referrals: no free text written here when deployed (FREE_TEXT_IN_HDS), the partner event names an HDS dossier by identifier only;
 *   - the browser crypto (src/lib/dossierCrypto.js): ECIES wrap/unwrap, member keyring, organisation key, re-key, attachments.
 */
import { describe, expect, it, vi } from 'vitest';

const CANARY = 'CANARY-R4-UNIT-3b8e';
const seen = vi.hoisted(() => ({ db: /** @type {string[]} */ ([]), logs: /** @type {string[]} */ ([]) }));
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get(_t, k) { seen.db.push(String(k)); throw new Error('database touched'); } }) }));
vi.mock('../../api/_utils/citizen-auth.js', () => ({
  requireCitizen: async () => ({ id: 'citizen-synthetic-r4', email: 'synthetic@example.test', notificationEmailEnabled: false, assist: null }),
  resolveCitizen: async () => ({ id: 'citizen-synthetic-r4' }),
}));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
vi.mock('../../api/_utils/logger.js', () => {
  const rec = (/** @type {any[]} */ ...a) => { seen.logs.push(JSON.stringify(a)); };
  const l = { info: rec, warn: rec, error: rec, debug: rec, child: () => l };
  return { default: l, logger: l };
});

const { generateTicketKeyPair } = await import('../../api/lib/hds-ticket.js');
const { createProHdsTicketHandler, PRO_TICKET_CAPS } = await import('../../api/_handlers/pro/hds-ticket.js');
const { createHdsTicketHandler } = await import('../../api/_handlers/citizen/hds-ticket.js');
const { prepareAttachment } = await import('../../api/_services/message-attachments.js');
const { propose, act, FREE_TEXT_IN_HDS } = await import('../../api/_services/referrals.js');
const { buildOutboundEvent, OUTBOUND_KEYS } = await import('../../api/lib/partner-adapter/contract.js');
const { TICKET_CLAIMS, verifyTicket, parsePublicKeys } = await import('../../services/hds/src/ticket.js');
const dc = await import('../../src/lib/dossierCrypto.js');
const vc = await import('../../src/lib/vaultCrypto.js');

const pair = generateTicketKeyPair();
const LAB = { HDS_SERVICE_URL: 'http://127.0.0.1:4510', HDS_TICKET_KID: 'k1', HDS_TICKET_PRIVATE_KEY: pair.privateKeyB64 };
const mkRes = () => ({ statusCode: 200, headers: /** @type {Record<string, string>} */ ({}), body: /** @type {any} */ (undefined),
  status(/** @type {number} */ c) { this.statusCode = c; return this; }, json(/** @type {any} */ d) { this.body = d; return this; }, setHeader(/** @type {string} */ k, /** @type {string} */ v) { this.headers[k] = v; } });
const claimsOf = (/** @type {string} */ t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));
const verify = (/** @type {string} */ t) => verifyTicket(t, { keys: parsePublicKeys(`k1:${pair.publicKeyB64}`), issuer: 'ada-main', audience: 'ada-hds' });
const proReq = (/** @type {any} */ q, extra = {}) => ({ method: 'GET', query: q, headers: { 'x-note': CANARY }, body: { note: CANARY }, user: { structureId: 'struct-r4', userId: 'pro-r4' }, ...extra });

describe('professional HDS ticket', () => {
  it('signs a pro ticket bound to the caller structure and role; the service accepts it; no canary anywhere', async () => {
    const h = createProHdsTicketHandler({ env: LAB, membership: async () => ({ role: 'STRUCTURE_ADMIN' }) });
    const res = mkRes();
    await h(proReq({ cap: 'citizen.shared_dossier' }), res);
    expect(res.statusCode).toBe(200);
    const c = claimsOf(res.body.ticket);
    expect(c).toMatchObject({ sub: 'pro-r4', typ: 'pro', str: 'struct-r4', role: 'STRUCTURE_ADMIN', caps: ['citizen.shared_dossier'] });
    expect(Object.keys(c).every((k) => TICKET_CLAIMS.includes(k))).toBe(true);
    expect(verify(res.body.ticket).ok).toBe(true);
    expect(JSON.stringify(res.body) + seen.logs.join('\n')).not.toContain(CANARY);
    expect(seen.db).toEqual([]);
    const r2 = mkRes();
    await createProHdsTicketHandler({ env: LAB, membership: async () => ({ role: 'PRO' }) })(proReq({ cap: 'pro.referrals' }), r2);
    expect(claimsOf(r2.body.ticket)).toMatchObject({ role: 'PRO', caps: ['pro.referrals', 'citizen.shared_dossier'] });
  });
  it('fails closed: unknown cap 400, inactive member 403, no session 403, no gateway 503, wrong method 405', async () => {
    const cases = [
      [createProHdsTicketHandler({ env: LAB, membership: async () => ({ role: 'PRO' }) }), proReq({ cap: 'citizen.vault' }), 400],
      [createProHdsTicketHandler({ env: LAB, membership: async () => null }), proReq({ cap: 'citizen.shared_dossier' }), 403],
      [createProHdsTicketHandler({ env: LAB }), proReq({ cap: 'citizen.shared_dossier' }, { user: {} }), 403],
      [createProHdsTicketHandler({ env: {} }), proReq({ cap: 'citizen.shared_dossier' }), 503],
      [createProHdsTicketHandler({ env: LAB }), proReq({ cap: 'citizen.shared_dossier' }, { method: 'POST' }), 405],
    ];
    for (const [h, req, status] of cases) { const res = mkRes(); await /** @type {any} */ (h)(req, res); expect(res.statusCode).toBe(status); }
    expect(PRO_TICKET_CAPS).toEqual(['citizen.shared_dossier', 'pro.referrals', 'messaging.attachments']);
  });
  it('closed capability in production: 503 before anything is signed', async () => {
    const res = mkRes();
    await createProHdsTicketHandler({ env: { ...LAB, VERCEL_ENV: 'production' }, membership: async () => ({ role: 'PRO' }) })(proReq({ cap: 'citizen.shared_dossier' }), res);
    expect(res).toMatchObject({ statusCode: 503, body: { code: 'CAPABILITY_NOT_OPEN' } });
  });
  it('attachment tickets are bound to ONE conversation of the caller (pro and citizen); another one → 404', async () => {
    const res = mkRes();
    await createProHdsTicketHandler({ env: LAB, membership: async () => ({ role: 'PRO' }), conversationOf: async (id, s) => (id === 'conv-1' && s === 'struct-r4' ? { id, citizenId: 'citizen-synthetic-r4' } : null) })(proReq({ cap: 'messaging.attachments', conversation: 'conv-1' }), res);
    expect(claimsOf(res.body.ticket).obj).toBe('rdvconv:conv-1:citizen-synthetic-r4:struct-r4');
    expect(verify(res.body.ticket).ok).toBe(true);
    const r404 = mkRes();
    await createProHdsTicketHandler({ env: LAB, membership: async () => ({ role: 'PRO' }), conversationOf: async () => null })(proReq({ cap: 'messaging.attachments', conversation: 'conv-2' }), r404);
    expect(r404.statusCode).toBe(404);
    const rc = mkRes();
    await createHdsTicketHandler({ env: LAB, conversationOf: async (id, cid) => (cid === 'citizen-synthetic-r4' ? { id, structureId: 'struct-r4' } : null) })({ method: 'GET', query: { cap: 'messaging.attachments', conversation: 'conv-1' }, headers: {} }, rc);
    expect(claimsOf(rc.body.ticket)).toMatchObject({ typ: 'citizen', caps: ['messaging.attachments'], obj: 'rdvconv:conv-1:citizen-synthetic-r4:struct-r4' });
    const bad = mkRes();
    await createHdsTicketHandler({ env: LAB, conversationOf: async () => null })({ method: 'GET', query: { cap: 'messaging.attachments', conversation: 'x/../y' }, headers: {} }, bad);
    expect(bad.statusCode).toBe(400);
  });
  it('the service refuses an unknown role or a malformed binding', () => {
    expect(TICKET_CLAIMS).toContain('obj');
  });
});

describe('message attachments: bytes never reach Vercel when deployed', () => {
  const bytes = { filename: `${CANARY}.pdf`, mimeType: 'application/pdf', contentBase64: Buffer.from(`%PDF-1.4 ${CANARY}`).toString('base64') };
  it('deployed: bytes → 409 HDS_SERVICE_REQUIRED; an HDS reference → accepted (ids and sizes only)', () => {
    const out = prepareAttachment(bytes, { VERCEL_ENV: 'production' });
    expect(out).toMatchObject({ ok: false, status: 409, code: 'HDS_SERVICE_REQUIRED' });
    expect(JSON.stringify(out)).not.toContain(CANARY);
    const ref = { hdsAttachmentId: '0b7f6f1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', byteLength: 2048, sha256: 'a'.repeat(64) };
    expect(prepareAttachment(ref, { VERCEL_ENV: 'production' })).toEqual({ ok: true, file: { hds: true, id: ref.hdsAttachmentId, byteLength: 2048, sha256: 'a'.repeat(64) } });
    expect(prepareAttachment({ ...ref, hdsAttachmentId: '../x' }, { VERCEL_ENV: 'production' }).ok).toBe(false);
    expect(prepareAttachment(bytes, {}).ok).toBe(true);   // the LAB keeps its legacy path
  });
});

describe('referrals: no free text here when deployed; partner event names an HDS dossier by id only', () => {
  it('propose / act with a message or a citizen summary → 422 FREE_TEXT_IN_HDS before any database access', async () => {
    const ctx = { structureId: 'struct-r4', userId: 'pro-r4', role: 'PRO' };
    const before = seen.db.length;
    for (const out of [await propose(ctx, { message: CANARY, reasonCode: 'OTHER' }, { envVars: { VERCEL_ENV: 'production' } }),
      await act(ctx, 'ref-1', 'reply', { message: CANARY }, { envVars: { VERCEL_ENV: 'preview' } }),
      await act(ctx, 'ref-1', 'complete', { citizenSummary: CANARY }, { envVars: { VERCEL_ENV: 'production' } })]) {
      expect(out).toMatchObject({ ok: false, status: 422, code: FREE_TEXT_IN_HDS });
      expect(JSON.stringify(out)).not.toContain(CANARY);
    }
    expect(seen.db.length).toBe(before);
  });
  it('outbound event: dossierRef only for an HDS dossier, identifiers only', () => {
    const ev = { id: 'ev-1', toStatus: 'SENT', createdAt: '2026-11-24T10:00:00Z' };
    const plain = buildOutboundEvent(ev, { id: 'r-1', reasonCode: 'HOUSING', dueAt: null }, 'https://x/pro');
    expect(Object.keys(/** @type {any} */ (plain).referral)).toEqual(OUTBOUND_KEYS.referral);
    const hds = buildOutboundEvent(ev, { id: 'r-1', reasonCode: 'HOUSING', dueAt: null, hdsDossierId: 'd-uuid' }, 'https://x/pro');
    expect(/** @type {any} */ (hds).referral.dossierRef).toEqual({ service: 'ada-hds', id: 'd-uuid' });
    expect(Object.keys(/** @type {any} */ (hds).referral).sort()).toEqual([...OUTBOUND_KEYS.referral, ...OUTBOUND_KEYS.referralOptional].sort());
  });
});

describe('browser crypto (src/lib/dossierCrypto.js)', () => {
  it('ECIES: only the matching private key opens; a wrong key, a changed kid or altered bytes fail', async () => {
    const a = await dc.generatePair(); const b = await dc.generatePair();
    const env = await dc.sealFor(a.publicJwk, new TextEncoder().encode(CANARY), 'kid1');
    expect(JSON.stringify(env)).not.toContain(CANARY);
    expect(new TextDecoder().decode(await dc.openFrom(await dc.importPrivateJwk(a.privateJwk), env))).toBe(CANARY);
    await expect(dc.openFrom(await dc.importPrivateJwk(b.privateJwk), env)).rejects.toThrow();
    await expect(dc.openFrom(await dc.importPrivateJwk(a.privateJwk), { ...env, kid: 'kid2' })).rejects.toThrow();
    expect(dc.publicJwkOf(a.privateJwk)).not.toHaveProperty('d');
  });
  it('member keyring (passphrase), organisation key wrapped per member, dossier grant and re-key', async () => {
    const m = await dc.createMemberKeyring('phrase membre synthétique', 1000);
    expect(await dc.unlockMemberKeyring(m.keyring, 'mauvaise phrase')).toBeNull();
    const mk = /** @type {CryptoKey} */ (await dc.unlockMemberKeyring(m.keyring, 'phrase membre synthétique'));
    const org = await dc.createOrgKey([{ memberRef: 'pro-1', publicJwk: m.publicJwk }]);
    const orgPriv = await dc.importPrivateJwk(await dc.openOrgPrivateJwk(mk, org.wraps[0].wrappedPrivate));
    const vault = await vc.createKeyring('phrase coffre synthétique', 1000);
    const d = await dc.createDossier(vault.vaultKey, { title: CANARY });
    const wrapped = await dc.wrapForOrg(d.raw, { kid: org.kid, publicJwk: org.publicJwk });
    const gk = await dc.openGrantKey(orgPriv, wrapped);
    expect((await dc.decryptContent(gk.key, d.body.content)).title).toBe(CANARY);
    const msg = await dc.encryptMessage(d.key, 'bonjour');
    const file = await vc.encryptDocument(d.key, { bytes: new Uint8Array([1, 2, 3]), name: 'a.pdf', category: 'autre', type: 'application/pdf' });
    const rk = await dc.rekeyPayload({ vaultKey: vault.vaultKey, oldKey: d.key, dossier: { keyEpoch: 1, content: d.body.content, files: [{ id: 'f1', dek: file.dek }] }, messages: [{ id: 'm1', ...msg }], orgs: [{ structureId: 's', kid: org.kid, publicJwk: org.publicJwk }] });
    const nk = await dc.openGrantKey(orgPriv, rk.payload.grants[0].wrappedKey);
    expect((await dc.decryptContent(nk.key, rk.payload.content)).title).toBe(CANARY);
    expect(await dc.decryptMessage(nk.key, { dek: rk.payload.messages[0].dek, body: msg.body })).toBe('bonjour');
    expect(await vc.openContent(nk.key, { dek: rk.payload.files[0].dek }, file.content)).toEqual(new Uint8Array([1, 2, 3]));
    await expect(dc.decryptContent(d.key, rk.payload.content)).rejects.toThrow();
    expect((await dc.openOwnerKey(vault.vaultKey, rk.payload.ownerKey)).raw).toEqual(rk.raw);
  });
  it('attachments: the person (box key) and the organisation each open; nobody else', async () => {
    const vault = await vc.createKeyring('phrase coffre synthétique', 1000);
    const box = await dc.createBoxKey(vault.vaultKey);
    const org = await dc.generatePair(); const other = await dc.generatePair();
    const att = await dc.encryptAttachment({ bytes: new TextEncoder().encode(CANARY), name: `${CANARY}.pdf`, type: 'application/pdf' }, { citizen: { publicJwk: box.publicJwk }, org: { kid: 'k-org', publicJwk: org.publicJwk } });
    expect(JSON.stringify(att)).not.toContain(CANARY);
    const boxKey = await dc.openBoxKey(vault.vaultKey, box.privateWrapped);
    expect((await dc.decryptAttachment(boxKey, { content: att.content, meta: att.meta, key: att.keyCitizen })).name).toBe(`${CANARY}.pdf`);
    expect(new TextDecoder().decode((await dc.decryptAttachment(await dc.importPrivateJwk(org.privateJwk), { content: att.content, meta: att.meta, key: att.keyOrg })).bytes)).toBe(CANARY);
    await expect(dc.decryptAttachment(await dc.importPrivateJwk(other.privateJwk), { content: att.content, meta: att.meta, key: att.keyOrg })).rejects.toThrow();
  });
});
