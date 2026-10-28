/**
 * PKG-2 batch 3 — C23 delegation on REAL PostgreSQL (migration 0018), through the real handler:
 *  invitation by e-mail, accepted only by the account whose VERIFIED e-mail is the invited one, one use, expiring; read-only scoped projections (no notes, no document
 *  content, no storage key), every view logged for the principal; no write path through a delegation; either side ends it; expiry closes it; legal mandates stay
 *  PROOF_REQUIRED and the database refuses ACTIVE for them; the access log is append-only; DSR export lists delegations (no token hash) and erasure removes them.
 * Object storage is an in-memory map; the mailer is the in-memory 'test' provider. Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));
const BLOBS = vi.hoisted(() => new Map());
vi.mock('../../api/lib/storage.js', () => ({
  storage: {
    upload: async (buf) => { const k = `b3-key-${BLOBS.size}-${Math.random().toString(36).slice(2)}`; BLOBS.set(k, Buffer.from(buf)); return k; },
    download: async (k) => { if (!BLOBS.has(k)) throw new Error('missing blob'); return BLOBS.get(k); },
    delete: async (k) => { BLOBS.delete(k); },
  },
}));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const P = { id: `b3-p-${TS}`, email: `b3-p-${TS}@example.test` };
const D = { id: `b3-d-${TS}`, email: `b3-d-${TS}@example.test` };
const X = { id: `b3-x-${TS}`, email: `b3-x-${TS}@example.test` };
const T = { id: `b3-t-${TS}`, email: `b3-t-${TS}@example.test` };
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('b3 synthetic '.repeat(40))]);
const NOTE = `private-note-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const tokenOf = (link) => new URL(link, 'http://localhost').searchParams.get('invitation');

describe.skipIf(!hasDatabase)('PKG-2 batch 3 — C23 delegation (real DB)', () => {
  let db, userAuth, H, mailer, privacy;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async (h, { method = 'GET', body, query = {}, as } = {}) => { const r = mk(); await h({ method, url: '/api/x', query, body, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}) } }, r); return r; };
  const invite = (as, body) => call(H.dlg, { method: 'POST', as, body: { action: 'invite', ...body } });
  const respond = (as, token, accept = true) => call(H.dlg, { method: 'POST', as, body: { action: 'respond', token, accept } });
  const look = (as, id, view) => call(H.dlg, { as, query: { id, view } });
  let active; let itemId;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    userAuth = await import('../../api/_utils/user-auth.js'); mailer = await import('../../api/_utils/mailer.js'); privacy = await import('../../api/_services/privacy.js');
    H = { dlg: (await import('../../api/_handlers/citizen/delegations.js')).default, coffre: (await import('../../api/_handlers/citizen/coffre.js')).default, parcours: (await import('../../api/_handlers/citizen/parcours.js')).default };
    for (const u of [P, D, X, T]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
    itemId = `b3-item-${TS}`;
    await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, note, "updatedAt") VALUES (${itemId}, ${P.id}, 'MANUAL', 'custom', 'Déposer le dossier CAF', ${NOTE}, NOW())`);
    const up = await call(H.coffre, { method: 'POST', as: P, body: { category: 'logement', originalName: 'bail.pdf', fileBase64: PDF.toString('base64') } });
    expect(up.statusCode, JSON.stringify(up.body)).toBe(201);
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test'; mailer.__clearTestOutbox();
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${P.id}, ${D.id}, ${X.id}, ${T.id})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${P.id}, ${D.id}, ${X.id}, ${T.id})`);
  });

  it('invitation: validated, one live delegation per person, e-mailed (delivery reported), the link carries a one-time token only', async () => {
    expect((await invite(P, { email: P.email, role: 'AIDANT', scopes: ['PARCOURS_READ'], days: 30 })).body.error).toBe('SELF_DELEGATION');
    expect((await invite(P, { email: D.email, role: 'AIDANT', scopes: ['PARCOURS_WRITE'], days: 30 })).body.error).toBe('INVALID_SCOPES');
    expect((await invite(P, { email: D.email, role: 'AIDANT', scopes: ['PARCOURS_READ'], days: 1000 })).body.error).toBe('INVALID_DURATION');
    expect((await invite(P, { email: D.email, role: 'BOSS', scopes: ['PARCOURS_READ'], days: 30 })).body.error).toBe('INVALID_ROLE');
    const r = await invite(P, { email: D.email.toUpperCase(), role: 'AIDANT', scopes: ['PARCOURS_READ', 'COFFRE_LIST'], days: 90 });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
    expect(r.body.delegation).toMatchObject({ status: 'INVITED', proofStatus: 'NOT_REQUIRED', inviteEmail: D.email });
    expect(r.body.delivery).toBe('TEST_RECORDED');   // PKG-4: the in-memory test outbox is TEST_RECORDED, never DELIVERED (nothing reached a real mailbox)
    const mail = mailer.__getTestOutbox().filter((m) => m.to === D.email);
    expect(mail.length).toBe(1); expect(mail[0].text).toContain(tokenOf(r.body.inviteLink));
    const [row] = (await db.execute(sql`SELECT "inviteTokenHash" h FROM "CitizenDelegation" WHERE id = ${r.body.delegation.id}`)).rows;
    expect(row.h).not.toBe(tokenOf(r.body.inviteLink)); // only the hash is stored
    expect((await invite(P, { email: D.email, role: 'AIDANT', scopes: ['PARCOURS_READ'], days: 30 })).statusCode).toBe(409);
    active = { id: r.body.delegation.id, token: tokenOf(r.body.inviteLink) };
  });

  it('only the invited verified account accepts, once; another account gets 403 and opens nothing', async () => {
    expect((await respond(X, active.token)).statusCode).toBe(403);
    expect((await look(X, active.id, 'parcours')).statusCode).toBe(404);
    expect((await look(D, active.id, 'parcours')).statusCode, 'not active before acceptance').toBe(404);
    const ok = await respond(D, active.token);
    expect(ok.statusCode).toBe(200); expect(ok.body.delegation.status).toBe('ACTIVE');
    expect((await respond(D, active.token)).statusCode, 'one use').toBe(404);
    expect((await respond(D, 'not-a-token')).statusCode).toBe(404);
  });

  it('read-only projections: Parcours without private notes, Coffre names without content or keys, scope enforced; every view is logged for the principal only', async () => {
    const p = await look(D, active.id, 'parcours');
    expect(p.statusCode).toBe(200); expect(p.body.delegation.principalEmail).toBe(P.email);
    expect(p.body.items.map((i) => i.title)).toEqual(['Déposer le dossier CAF']);
    expect(JSON.stringify(p.body)).not.toContain(NOTE);
    const c = await look(D, active.id, 'coffre');
    expect(c.statusCode).toBe(200); expect(c.body.documents).toEqual([expect.objectContaining({ name: 'bail.pdf', category: 'logement' })]);
    expect(JSON.stringify(c.body)).not.toMatch(/storageKey|filenameEncrypted|fileBase64/);
    expect(Object.keys(c.body.documents[0]).sort(), 'no document id: nothing to download').toEqual(['byteLength', 'category', 'createdAt', 'expired', 'name']);
    expect((await look(D, active.id, 'rdv')).body.error, 'scope not granted').toBe('SCOPE_NOT_GRANTED');
    expect((await look(P, active.id, 'parcours')).statusCode, 'the principal is not a delegate of themself').toBe(404);
    const log = await call(H.dlg, { as: P, query: { log: active.id } });
    expect(log.body.events.map((e) => e.action).sort()).toEqual(['COFFRE_LISTED', 'PARCOURS_VIEWED']);
    expect((await call(H.dlg, { as: D, query: { log: active.id } })).statusCode).toBe(404);
  });

  it('no write through a delegation: the delegate cannot change or delete the principal’s step', async () => {
    expect((await call(H.parcours, { method: 'DELETE', as: D, body: { id: itemId } })).statusCode).toBe(404);
    expect((await call(H.parcours, { method: 'POST', as: D, body: { action: 'status', id: itemId, status: 'CLOSED' } })).statusCode).toBeGreaterThanOrEqual(400);
    const [row] = (await db.execute(sql`SELECT status, note FROM "ParcoursItem" WHERE id = ${itemId}`)).rows;
    expect(row).toEqual({ status: 'NOT_STARTED', note: NOTE });
  });

  it('legal mandates stay PROOF_REQUIRED and open nothing; the database refuses ACTIVE, foreign scopes and more than a year', async () => {
    const r = await invite(P, { email: T.email, role: 'TUTEUR', scopes: ['PARCOURS_READ'], days: 365 });
    expect(r.body.delegation.proofStatus).toBe('REQUIRED_NOT_VERIFIED');
    const a = await respond(T, tokenOf(r.body.inviteLink));
    expect(a.body.delegation.status).toBe('PROOF_REQUIRED');
    expect((await look(T, r.body.delegation.id, 'parcours')).statusCode).toBe(404);
    const refuse = async (q) => { let code = null; try { await db.execute(q); } catch (e) { code = e.cause?.code || e.code; } return code; };
    expect(await refuse(sql`UPDATE "CitizenDelegation" SET status = 'ACTIVE' WHERE id = ${r.body.delegation.id}`)).toBe('23514');
    expect(await refuse(sql`UPDATE "CitizenDelegation" SET scopes = ARRAY['COFFRE_DOWNLOAD'] WHERE id = ${active.id}`)).toBe('23514');
    expect(await refuse(sql`UPDATE "CitizenDelegation" SET "expiresAt" = "createdAt" + interval '400 days' WHERE id = ${active.id}`)).toBe('23514');
    expect(await refuse(sql`UPDATE "DelegationAccessEvent" SET action = 'RDV_VIEWED' WHERE "delegationId" = ${active.id}`), 'append-only').toBe('23000');
    expect((await call(H.dlg, { method: 'POST', as: T, body: { action: 'end', id: r.body.delegation.id } })).body.delegation).toMatchObject({ status: 'REVOKED', endedBy: 'DELEGATE' });
  });

  it('an expired invitation or delegation opens nothing; the principal revokes at any time', async () => {
    const r = await invite(P, { email: X.email, role: 'AIDANT', scopes: ['RDV_READ'], days: 30 });
    await db.execute(sql`UPDATE "CitizenDelegation" SET "inviteExpiresAt" = NOW() - interval '1 minute' WHERE id = ${r.body.delegation.id}`);
    expect((await respond(X, tokenOf(r.body.inviteLink))).statusCode).toBe(404);
    await db.execute(sql`UPDATE "CitizenDelegation" SET "createdAt" = NOW() - interval '40 days', "expiresAt" = NOW() - interval '1 day' WHERE id = ${active.id}`);
    expect((await look(D, active.id, 'parcours')).statusCode).toBe(404);
    expect((await call(H.dlg, { as: D })).body.received.find((d) => d.id === active.id).status).toBe('EXPIRED');
    await db.execute(sql`UPDATE "CitizenDelegation" SET "expiresAt" = NOW() + interval '1 day' WHERE id = ${active.id}`);
    expect((await look(D, active.id, 'parcours')).statusCode).toBe(200);
    const end = await call(H.dlg, { method: 'POST', as: P, body: { action: 'end', id: active.id } });
    expect(end.body.delegation).toMatchObject({ status: 'REVOKED', endedBy: 'PRINCIPAL' });
    expect((await look(D, active.id, 'parcours')).statusCode).toBe(404);
    expect((await call(H.dlg, { method: 'POST', as: P, body: { action: 'end', id: active.id } })).statusCode).toBe(409);
    expect((await call(H.dlg, { method: 'POST', as: X, body: { action: 'end', id: active.id } })).statusCode).toBe(404);
  });

  it('DSR: the export lists delegations given and received (no token hash) and the access log; erasure removes them', async () => {
    const svc = privacy.createPrivacyRightsService({ db, cryptoLib: await import('node:crypto') });
    const out = await svc.getExportData(P.id);
    expect(out.delegationsGiven.length).toBeGreaterThanOrEqual(3); expect(out.delegationAccess.length).toBeGreaterThan(0);
    expect(JSON.stringify(out.delegationsGiven)).not.toContain('inviteTokenHash');
    expect((await svc.getExportData(D.id)).delegationsReceived.length).toBe(1);
    const req = await svc.requestDeletion(P.id);
    await svc.updateDsrRequestStatus(req.id, 'APPROVED');
    await svc.executeApprovedDeletion(req.id);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "CitizenDelegation" WHERE "principalUserId" = ${P.id}`)).rows[0].n).toBe(0);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "DelegationAccessEvent" WHERE "principalUserId" = ${P.id}`)).rows[0].n).toBe(0);
  });
});
