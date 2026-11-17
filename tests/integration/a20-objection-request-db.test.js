/**
 * A-20 — objection to processing (RGPD art. 21) is actually FILED (REAL PostgreSQL, real citizen/restriction handler, synthetic accounts): one row in the
 * rights-request register (DSRRequest, type OBJECT, human review) and one sealed entry in the privacy queue administrators already read (SupportRequest, PRIVACY)
 * that names the register reference. One open objection per person; nothing of another account is touched or shown; answering the queue entry completes the
 * register row; the objection is in the person's export.
 */
import nodeCrypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { id: `a20-a-${TS}`, email: `a20-a-${TS}@example.test` }, B = { id: `a20-b-${TS}`, email: `a20-b-${TS}@example.test` };
const REASON = `raison-synthetique-${TS}`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('A-20 objection (art. 21) is filed through the rights register and the privacy queue (real DB)', () => {
  let db, userAuth, handler, support, privacy;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async (as, method = 'GET', body) => { const r = mk(); await handler({ method, url: '/api/citizen/restriction', query: {}, body, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}) } }, r); return r; };
  const dsr = async (u) => (await db.execute(sql`SELECT id, status, "executionMode", "reasonCode", "reviewOutcome" AS o, "completedAt" FROM "DSRRequest" WHERE "requestType" = 'OBJECT' AND "subjectId" = ${u.id} ORDER BY "createdAt"`)).rows;
  let supportId;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); userAuth = await import('../../api/_utils/user-auth.js');
    handler = (await import('../../api/_handlers/citizen/restriction.js')).default; support = await import('../../api/_services/support.js'); privacy = await import('../../api/_services/privacy.js');
    for (const u of [A, B]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    const ids = (await db.execute(sql`SELECT "reviewOutcome"->>'supportRequestId' AS s FROM "DSRRequest" WHERE "subjectId" IN (${A.id}, ${B.id}) AND "requestType" = 'OBJECT'`)).rows.map((r) => r.s);
    for (const s of ids) await db.execute(sql`DELETE FROM "SupportRequest" WHERE id = ${s}`);
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" IN (${A.id}, ${B.id})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A.id}, ${B.id})`);
  });

  it('signed out: 401, nothing filed; signed in without a request: objection is null', async () => {
    expect((await call(null, 'POST', { action: 'object' })).statusCode).toBe(401);
    const state = await call(A);
    expect(state.statusCode).toBe(200); expect(state.body.objection).toBeNull();
    expect(state.body.grounds).toContain('OBJECTION_PENDING');   // the restriction state is still returned
  });

  it('filing: a register row (OBJECT, RECEIVED, human review, no free text) and a sealed PRIVACY queue entry with the reference, the reason and the contact', async () => {
    const r = await call(A, 'POST', { action: 'object', reason: REASON });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
    expect(r.body.objection).toMatchObject({ status: 'OPEN', answeredAt: null });
    const rows = await dsr(A);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: r.body.objection.id, status: 'RECEIVED', executionMode: 'HUMAN_REVIEW_REQUIRED', reasonCode: 'PARTICULAR_SITUATION_STATED', completedAt: null });
    expect(rows[0].o).toMatchObject({ article: '21' });
    expect(JSON.stringify(rows[0])).not.toContain(REASON);   // the person's words are not in the register
    supportId = rows[0].o.supportRequestId;
    const [raw] = (await db.execute(sql`SELECT category, status, "messageEncrypted" AS m, "contactEncrypted" AS c FROM "SupportRequest" WHERE id = ${supportId}`)).rows;
    expect(raw).toMatchObject({ category: 'PRIVACY', status: 'OPEN' });
    expect(raw.m).not.toContain(REASON); expect(raw.c).not.toContain(A.email);   // sealed at rest
    const queue = (await support.listRequests({ actor: 'a20-admin' }, db)).requests.find((q) => q.id === supportId);
    expect(queue).toMatchObject({ category: 'PRIVACY', routedTo: 'PRIVACY_CONSOLE', contact: A.email });
    expect(queue.message).toContain(rows[0].id); expect(queue.message).toContain(REASON); expect(queue.message).toMatch(/article 21/);
    const audit = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE action = 'PROCESSING_OBJECTION_FILED' AND entity_id = ${rows[0].id}`)).rows;
    expect(audit).toHaveLength(1); expect(JSON.stringify(audit)).not.toContain(REASON);
  });

  it('one open objection per person: a second request returns the first and files nothing more', async () => {
    const again = await call(A, 'POST', { action: 'object', reason: 'autre texte synthétique' });
    expect(again.statusCode).toBe(200); expect(again.body.alreadyOpen).toBe(true);
    expect(await dsr(A)).toHaveLength(1);
    expect((await call(A)).body.objection).toMatchObject({ status: 'OPEN' });
  });

  it('isolation: the other account sees no objection, and its own request is a separate one; an oversized reason is refused', async () => {
    expect((await call(B)).body.objection).toBeNull();
    expect((await call(B, 'POST', { action: 'object', reason: 'x'.repeat(1001) })).statusCode).toBe(400);
    expect(await dsr(B)).toHaveLength(0);
    const b = await call(B, 'POST', { action: 'object' });
    expect(b.statusCode).toBe(201);
    const rows = await dsr(B);
    expect(rows).toHaveLength(1); expect(rows[0].reasonCode).toBe('NO_REASON_STATED');
    expect(rows[0].id).not.toBe((await dsr(A))[0].id);
  });

  it('answering the queue entry completes the register row of THAT person only; a new objection can then be filed', async () => {
    expect((await support.updateRequest(supportId, { status: 'ANSWERED', resolutionNote: 'Réponse envoyée (test).' }, 'a20-admin', db)).ok).toBe(true);
    const [a] = await dsr(A);
    expect(a.status).toBe('COMPLETED'); expect(a.completedAt).not.toBeNull();
    expect((await dsr(B))[0].status).toBe('RECEIVED');
    expect((await call(A)).body.objection).toMatchObject({ status: 'ANSWERED' });
    expect((await call(A, 'POST', { action: 'object' })).statusCode).toBe(201);
    expect(await dsr(A)).toHaveLength(2);
  });

  it('the objection is part of the person’s export (rights requests), not of the other account’s', async () => {
    const svc = privacy.createPrivacyRightsService({ db, cryptoLib: nodeCrypto });
    const out = await svc.getExportData(A.id);
    expect(out.dsrRequests.filter((r) => r.requestType === 'OBJECT')).toHaveLength(2);
    expect(JSON.stringify(out.dsrRequests)).not.toContain(B.id);
  });
});
