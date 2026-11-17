/**
 * A-18 — a delegated view follows the capability gate of the part it shows (REAL PostgreSQL, real handler, synthetic accounts).
 * With delegations and Mon Parcours open but the vault closed (R45 gates on), the delegate of an ACTIVE delegation that holds COFFRE_LIST gets 404 on the Coffre
 * list — nothing read, nothing logged — while Mon Parcours still answers; the closed part is neither offered nor accepted in a new invitation.
 * Ownership (IDOR): an account that is not the delegate of that delegation gets 404 on every view, gates on or off.
 */
import { vi, afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const P = { id: `a18-p-${TS}`, email: `a18-p-${TS}@example.test` };
const D = { id: `a18-d-${TS}`, email: `a18-d-${TS}@example.test` };
const X = { id: `a18-x-${TS}`, email: `a18-x-${TS}@example.test` };
const GATES = ['ADA_CAPABILITY_ENFORCEMENT', 'ADA_CAPABILITIES_OPEN', 'ADA_HDS_CERTIFIED_HOSTING', 'ADA_PUBLIC_BETA_RESTRICTED'];
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const tokenOf = (link) => new URL(link, 'http://localhost').searchParams.get('invitation');

describe.skipIf(!hasDatabase)('A-18 delegateView honours capability gates (real DB)', () => {
  let db, userAuth, dlg, active;
  const saved = {};
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async ({ method = 'GET', body, query = {}, as } = {}) => { const r = mk(); await dlg({ method, url: '/api/citizen/delegations', query, body, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}) } }, r); return r; };
  const look = (as, view) => call({ as, query: { id: active.id, view } });
  const events = async () => (await db.execute(sql`SELECT action FROM "DelegationAccessEvent" WHERE "delegationId" = ${active.id} ORDER BY "createdAt"`)).rows.map((r) => r.action);
  // delegations + Mon Parcours listed open; the vault is not (and has no HDS attestation); booking is inside the AIPD (open with its surface)
  const closeVault = () => { process.env.ADA_CAPABILITY_ENFORCEMENT = '1'; process.env.ADA_CAPABILITIES_OPEN = 'citizen.delegations,citizen.parcours'; delete process.env.ADA_HDS_CERTIFIED_HOSTING; delete process.env.ADA_PUBLIC_BETA_RESTRICTED; };

  beforeAll(async () => {
    for (const k of GATES) saved[k] = process.env[k];
    for (const k of GATES) delete process.env[k];
    ({ db } = await import('../../src/db/index.js')); userAuth = await import('../../api/_utils/user-auth.js');
    dlg = (await import('../../api/_handlers/citizen/delegations.js')).default;
    for (const u of [P, D, X]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "updatedAt") VALUES (${`a18-item-${TS}`}, ${P.id}, 'MANUAL', 'custom', 'Étape de test', NOW())`);
    const inv = await call({ method: 'POST', as: P, body: { action: 'invite', email: D.email, role: 'AIDANT', scopes: ['PARCOURS_READ', 'COFFRE_LIST', 'RDV_READ'], days: 30 } });
    expect(inv.statusCode, JSON.stringify(inv.body)).toBe(201);
    const acc = await call({ method: 'POST', as: D, body: { action: 'respond', token: tokenOf(inv.body.inviteLink), accept: true } });
    expect(acc.body.delegation.status).toBe('ACTIVE');
    active = acc.body.delegation;
  });
  afterEach(() => { for (const k of GATES) delete process.env[k]; });
  afterAll(async () => {
    for (const k of GATES) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if (!db) return;
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${P.id}, ${D.id}, ${X.id})`);
  });

  it('LAB (enforcement off): the three granted views answer and are logged; every part is offered', async () => {
    for (const v of ['parcours', 'coffre', 'rdv']) expect((await look(D, v)).statusCode, v).toBe(200);
    expect(await events()).toEqual(['PARCOURS_VIEWED', 'COFFRE_LISTED', 'RDV_VIEWED']);
    expect((await call({ as: P })).body.offeredScopes).toEqual(['PARCOURS_READ', 'COFFRE_LIST', 'RDV_READ']);
  });

  it('vault closed: the Coffre list is 404 for the delegate (nothing read, nothing logged); Mon Parcours and appointments still answer', async () => {
    closeVault();
    const before = await events();
    const coffre = await look(D, 'coffre');
    expect(coffre.statusCode).toBe(404);
    expect(coffre.body.error).toBe('CAPABILITY_NOT_OPEN');
    expect(coffre.body.documents).toBeUndefined();
    expect(await events()).toEqual(before);
    expect((await look(D, 'parcours')).statusCode).toBe(200);
    expect((await look(D, 'rdv')).statusCode).toBe(200);
    expect(await events()).toEqual([...before, 'PARCOURS_VIEWED', 'RDV_VIEWED']);
  });

  it('vault closed: the closed part is not offered and a new invitation that names it is refused (nothing created)', async () => {
    closeVault();
    expect((await call({ as: P })).body.offeredScopes).toEqual(['PARCOURS_READ', 'RDV_READ']);
    const n = async () => (await db.execute(sql`SELECT count(*)::int AS n FROM "CitizenDelegation" WHERE "principalUserId" = ${P.id}`)).rows[0].n;
    const before = await n();
    const r = await call({ method: 'POST', as: P, body: { action: 'invite', email: X.email, role: 'AIDANT', scopes: ['PARCOURS_READ', 'COFFRE_LIST'], days: 30 } });
    expect(r.statusCode).toBe(409); expect(r.body.error).toBe('SCOPE_NOT_OPEN');
    expect(await n()).toBe(before);
  });

  it('Mon Parcours closed too: its delegated view closes with it', async () => {
    closeVault(); process.env.ADA_CAPABILITIES_OPEN = 'citizen.delegations';
    expect((await look(D, 'parcours')).statusCode).toBe(404);
    expect((await look(D, 'rdv')).statusCode).toBe(200);
  });

  it('IDOR: an account that is not the delegate (a stranger, the principal itself, a signed-out visitor) reads no view, gates on or off', async () => {
    const before = await events();
    for (const gates of [false, true]) {
      if (gates) closeVault();
      for (const v of ['parcours', 'coffre', 'rdv']) {
        expect((await look(X, v)).statusCode, `stranger ${v}`).toBe(404);
        expect((await look(P, v)).statusCode, `principal ${v}`).toBe(404);
        expect((await look(null, v)).statusCode, `signed out ${v}`).toBe(401);
      }
    }
    expect(await events()).toEqual(before);
  });
});
