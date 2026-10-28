/**
 * /api/secure-messages — real PostgreSQL, real pro JWTs / citizen cookies.
 * Contract: pro session required; conversation must belong to the caller's structure (foreign == unknown == 404);
 * sender identity comes from the session (body.senderId is ignored); size + rate limits enforced.
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.
 */
import { vi } from 'vitest';
const hoisted = vi.hoisted(() => ({ rl: [] }));
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn(async (action, key) => { hoisted.rl.push({ action, key }); return { allowed: true }; }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429),
}));
vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-secure-messages');

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S1 = `smdb-s1-${TS}`; const S2 = `smdb-s2-${TS}`; const SVC = `smdb-svc-${TS}`; const APT = `smdb-apt-${TS}`; const CONV = `smdb-conv-${TS}`;
const P1 = { id: `smdb-p1-${TS}`, email: `p1-${TS}@example.test` }; const P2 = { id: `smdb-p2-${TS}`, email: `p2-${TS}@example.test` };
const CIT = { id: `smdb-c-${TS}`, email: `c-${TS}@example.test` };
const makeRes = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, writeHead(c) { this.statusCode = c; return this; }, end(d) { if (d !== undefined) this.body = d; return this; } });

describe.skipIf(!hasDatabase)('secure-messages access control (real DB)', () => {
  let db, schema, auth, userAuth, handler;
  const call = async ({ method = 'GET', query = '', body, token, cookie }) => {
    const res = makeRes();
    await handler({ method, url: `/api/secure-messages${query}`, query: {}, body, headers: { host: 'localhost:3000', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) } }, res);
    return res;
  };
  const tok = (p, sid) => auth.signProToken({ id: p.id, email: p.email, structureId: sid, role: 'STRUCTURE_ADMIN' });
  const count = async () => (await db.execute(sql`SELECT count(*)::int AS n FROM "RdvConversationMessage" WHERE "conversationId" = ${CONV}`)).rows[0].n;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); schema = await import('../../src/db/schema.js');
    auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    ({ default: handler } = await import('../../api/_handlers/secure-messages.js'));
    for (const [sid, n] of [[S1, 1], [S2, 2]]) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, "updatedAt", "createdAt") VALUES (${sid}, ${'SM Test ' + n}, ${'smdb-slug-' + n + '-' + TS}, 'association', '1 rue test', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', NOW(), NOW())`);
    await db.insert(schema.ProUser).values([{ id: P1.id, email: P1.email, password_hash: 'x', structureId: S1, role: 'STRUCTURE_ADMIN', status: 'active' }, { id: P2.id, email: P2.email, password_hash: 'x', structureId: S2, role: 'STRUCTURE_ADMIN', status: 'active' }]);
    await db.insert(schema.CitizenUser).values({ id: CIT.id, email: CIT.email, passwordHash: 'x', emailVerifiedAt: new Date() });
    await db.insert(schema.ProRdvService).values({ id: SVC, structureId: S1, name: 'Svc', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    await db.insert(schema.ProAppointment).values({ id: APT, structureId: S1, serviceId: SVC, startAt: new Date(Date.now() + 86400000), endAt: new Date(Date.now() + 86400000 + 1800000), status: 'confirmed', beneficiaryName: 'Particulier', citizenUserId: CIT.id });
    await db.insert(schema.RdvConversation).values({ id: CONV, appointmentId: APT, structureId: S1, citizenUserId: CIT.id, lastMessageAt: new Date() });
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "RdvConversationMessage" WHERE "conversationId" = ${CONV}`);
    await db.execute(sql`DELETE FROM "RdvConversation" WHERE id = ${CONV}`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id = ${APT}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT.id}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id IN (${P1.id}, ${P2.id})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${S1}, ${S2})`);
  });

  it('401 without a pro session (anonymous and citizen cookie)', async () => {
    expect((await call({ query: `?shareId=${CONV}` })).statusCode).toBe(401);
    expect((await call({ method: 'POST', body: { shareId: CONV, encryptedContent: 'x' } })).statusCode).toBe(401);
    const cookie = userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: CIT.id, email: CIT.email })).split(';')[0];
    expect((await call({ query: `?shareId=${CONV}`, cookie })).statusCode).toBe(401);
    expect(await count()).toBe(0);
  });

  it('foreign-structure pro: 404 on read and write (no existence leak), nothing stored', async () => {
    const t2 = tok(P2, S2);
    expect((await call({ query: `?shareId=${CONV}`, token: t2 })).statusCode).toBe(404);
    expect((await call({ method: 'POST', body: { shareId: CONV, encryptedContent: 'blob' }, token: t2 })).statusCode).toBe(404);
    expect((await call({ query: '?shareId=does-not-exist', token: t2 })).statusCode).toBe(404);
    expect(await count()).toBe(0);
  });

  it('owner-structure pro: send + read round-trip; sender comes from the session, spoofed body.senderId ignored', async () => {
    const t1 = tok(P1, S1);
    const sent = await call({ method: 'POST', body: { shareId: CONV, senderId: CIT.id, receiverId: P2.id, encryptedContent: 'client-e2ee-blob==' }, token: t1 });
    expect(sent.statusCode).toBe(201);
    expect(sent.body.item.senderId).toBe(P1.id);
    const row = (await db.execute(sql`SELECT "senderType", "senderProUserId", "senderCitizenUserId", body FROM "RdvConversationMessage" WHERE "conversationId" = ${CONV}`)).rows[0];
    expect(row).toMatchObject({ senderType: 'PRO', senderProUserId: P1.id, senderCitizenUserId: null });
    expect(row.body).not.toBe('client-e2ee-blob=='); // server-side wrap
    const list = await call({ query: `?shareId=${CONV}`, token: t1 });
    expect(list.statusCode).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ senderId: P1.id, encryptedContent: 'client-e2ee-blob==' });
  });

  it('role matrix: admin JWT / legacy ADMIN_TOKEN / citizen are refused; PRO and STRUCTURE_ADMIN of the owning structure work; other-structure SUPERADMIN is scoped out', async () => {
    const adminJwt = auth.signAdminSessionToken({ email: 'admin@example.test', role: 'admin', mfa_verified: true });
    for (const token of [adminJwt, process.env.ADMIN_TOKEN]) {
      expect((await call({ query: `?shareId=${CONV}`, token })).statusCode).toBe(401);
      expect((await call({ method: 'POST', body: { shareId: CONV, encryptedContent: 'x' }, token })).statusCode).toBe(401);
    }
    const proRole = auth.signProToken({ id: P1.id, email: P1.email, structureId: S1, role: 'PRO' });
    expect((await call({ query: `?shareId=${CONV}`, token: proRole })).statusCode).toBe(200);
    expect((await call({ method: 'POST', body: { shareId: CONV, encryptedContent: 'from-pro-role' }, token: proRole })).statusCode).toBe(201);
    const superOther = auth.signProToken({ id: P2.id, email: P2.email, structureId: S2, role: 'SUPERADMIN' });
    expect((await call({ query: `?shareId=${CONV}`, token: superOther })).statusCode).toBe(404);
    expect((await call({ method: 'POST', body: { shareId: CONV, encryptedContent: 'x' }, token: superOther })).statusCode).toBe(404);
  });

  // ---- RC5: SharedDossier contract. A SharedDiagnostic id is resolved as a dossier, but a shareId is NOT authorization: only a structure with an ACTIVE grant (redeemed share token) reaches its thread.
  const dossierRow = async (id, { expired = false } = {}) => db.insert(schema.SharedDiagnostic).values({ id, expiresAt: new Date(Date.now() + (expired ? -86400000 : 86400000)), situation: {}, results: {}, viewCount: 0 });
  const grant = async (id, sid, pid) => db.insert(schema.SharedDossierGrant).values({ sharedDiagnosticId: id, structureId: sid, grantedByProUserId: pid });
  const nThreads = async (id) => (await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierThread" WHERE "sharedDiagnosticId" = ${id}`)).rows[0].n;
  it('RC5 contract: WITHOUT a grant a live shareId is a uniform 404 for read and write and creates nothing; WITH a grant GET is 200 empty (no side effect) and POST opens a thread bound to the caller structure', async () => {
    const sd = `smdb-sd-${TS}`; await dossierRow(sd);
    try {
      const t1 = tok(P1, S1), t2 = tok(P2, S2);
      expect((await call({ query: `?shareId=${sd}`, token: t1 })).statusCode).toBe(404);
      expect((await call({ method: 'POST', body: { shareId: sd, encryptedContent: 'x' }, token: t1 })).statusCode).toBe(404);
      expect(await nThreads(sd)).toBe(0);
      await grant(sd, S1, P1.id);
      const g = await call({ query: `?shareId=${sd}`, token: t1 }); expect(g.statusCode).toBe(200); expect(g.body.items).toEqual([]); expect(await nThreads(sd)).toBe(0);
      expect((await call({ method: 'POST', body: { shareId: sd, structureId: S2, encryptedContent: 'blob-1' }, token: t1 })).statusCode).toBe(201);
      const rows = (await db.execute(sql`SELECT "structureId", "openedByProUserId" FROM "SharedDossierThread" WHERE "sharedDiagnosticId" = ${sd}`)).rows;
      expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ structureId: S1, openedByProUserId: P1.id });
      expect((await call({ query: `?shareId=${sd}`, token: t2 })).statusCode).toBe(404);                                       // S2 still has no grant
      expect((await call({ method: 'POST', body: { shareId: sd, encryptedContent: 'intrusion' }, token: t2 })).statusCode).toBe(404);
      expect(await nThreads(sd)).toBe(1);
      await db.execute(sql`UPDATE "SharedDossierGrant" SET "revokedAt" = NOW() WHERE "sharedDiagnosticId" = ${sd} AND "structureId" = ${S1}`);
      expect((await call({ query: `?shareId=${sd}`, token: t1 })).statusCode).toBe(404);                                       // revoked
      expect((await call({ method: 'POST', body: { shareId: sd, encryptedContent: 'late' }, token: t1 })).statusCode).toBe(404);
      expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDossierMessage" m JOIN "SharedDossierThread" t ON t.id = m."threadId" WHERE t."sharedDiagnosticId" = ${sd}`)).rows[0].n).toBe(1);
    } finally { await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${sd}`); }
  });
  it('RC5 contract: expired dossier -> 410 for a granted structure (read and write, no thread), uniform 404 without a grant; a RdvConversation id is still the legacy path (owner 200, foreign 404)', async () => {
    const sd = `smdb-sdx-${TS}`; await dossierRow(sd, { expired: true }); await grant(sd, S1, P1.id);
    try {
      const t1 = tok(P1, S1);
      expect((await call({ query: `?shareId=${sd}`, token: t1 })).statusCode).toBe(410);
      expect((await call({ method: 'POST', body: { shareId: sd, encryptedContent: 'x' }, token: t1 })).statusCode).toBe(410);
      expect((await call({ query: `?shareId=${sd}`, token: tok(P2, S2) })).statusCode).toBe(404);
      expect(await nThreads(sd)).toBe(0);
      expect((await call({ query: `?shareId=${CONV}`, token: t1 })).statusCode).toBe(200);
      expect((await call({ query: `?shareId=${CONV}`, token: tok(P2, S2) })).statusCode).toBe(404);
    } finally { await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${sd}`); }
  });

  it('input limits and rate limiting', async () => {
    const t1 = tok(P1, S1);
    expect((await call({ method: 'POST', body: { shareId: CONV, encryptedContent: '' }, token: t1 })).statusCode).toBe(400);
    expect((await call({ method: 'POST', body: { shareId: 'x'.repeat(200), encryptedContent: 'a' }, token: t1 })).statusCode).toBe(400);
    expect((await call({ method: 'POST', body: { shareId: CONV, encryptedContent: 'a'.repeat(32 * 1024 + 1) }, token: t1 })).statusCode).toBe(413);
    expect((await call({ query: '', token: t1 })).statusCode).toBe(400);
    const writes = hoisted.rl.filter((r) => r.action === 'MESSAGE_PRO_SEND');
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.some((r) => r.key.includes(P1.id))).toBe(true);   // limiter keyed by authenticated user (+conversation, ip)
    expect(writes.every((r) => /^smdb-p[12]-/.test(r.key))).toBe(true); // foreign callers are rate-limited too
    expect(JSON.stringify(hoisted.rl)).not.toContain('@example.test'); // no e-mail in limiter keys
  });
});
