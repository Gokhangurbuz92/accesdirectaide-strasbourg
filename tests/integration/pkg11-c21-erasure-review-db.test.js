/**
 * PKG-11 / C21 — account erasure on REAL PostgreSQL through the real API entry (synthetic data only). Before: DELETE /api/auth/delete-account queued a request
 * for review that nothing could approve, so no account was ever erased. Now:
 *  - the person's request is idempotent while open and its state is readable (in review, refused with its reason, blocked by a legal hold);
 *  - two different MFA administrators: one proposes, the other confirms; an APPROVE runs the deletion engine at once (account and dossier gone, request COMPLETED);
 *  - an active legal hold blocks the execution (BLOCKED, account kept) until it is released; then a retry completes it;
 *  - a REJECT needs a reason, which the person sees; a new request can then be filed. Every step is journalised; the review shows counts, never content.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const TS = Date.now(); const CSRF = 'c21csrf' + TS;
const CIT = [1, 2, 3].map((n) => ({ id: `c21-cit${n}-${TS}`, email: `c21-cit${n}-${TS}@example.test` }));
const A = `c21-a-${TS}@example.test`; const B = `c21-b-${TS}@example.test`;
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe('PKG-11 / C21 two-person erasure review (real DB)', () => {
  let db, api, auth, userAuth; const shares = [];
  const call = async (method, url, { body, cit, bearer } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(cit ? { cookie: `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: cit.id, email: cit.email })).split(';')[0]}; __csrf=${CSRF}`, 'x-csrf-token': CSRF } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const mfa = (email) => auth.signAdminSessionToken({ email, role: 'admin', mfa_verified: true });
  const plain = () => auth.signAdminSessionToken({ email: `c21-plain-${TS}@example.test`, role: 'admin', mfa_verified: false });
  const erasure = (bearer, body) => call('POST', '/api/admin/dsr-erasure', { bearer, body });
  const openOf = async (requestId) => (await call('GET', '/api/admin/dsr-erasure', { bearer: plain() })).body.requests.find((r) => r.id === requestId);
  const exists = async (id) => (await db.execute(sql`SELECT count(*)::int AS n FROM "CitizenUser" WHERE id = ${id}`)).rows[0].n === 1;
  const audits = async (requestId) => (await db.execute(sql`SELECT action FROM "AuditLog" WHERE entity = 'DSR_REQUEST' AND entity_id = ${requestId} ORDER BY "timestamp", id`)).rows.map((r) => r.action);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    for (const c of CIT) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
    const created = await call('POST', '/api/share/create', { cit: CIT[0], body: { situation: { zipCode: '67000' }, results: { rights: [] } } });
    expect(created.statusCode).toBe(200); expect(created.body.shareId).toBeTruthy(); shares.push(created.body.shareId);
  }, 90000);

  afterAll(async () => {
    if (!db) return;
    for (const c of CIT) {
      await db.execute(sql`DELETE FROM "LegalHold" WHERE "recordId" = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
    }
    for (const s of shares) await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${s}`).catch(() => {});
  });

  it('APPROVE: the request is idempotent while open; one administrator proposes, ANOTHER confirms with the version read; the account and its dossier are erased', async () => {
    // R12: two presses at the SAME moment still give one request (the check and the creation run under a per-person lock)
    const [r1, r2] = await Promise.all([call('DELETE', '/api/auth/delete-account', { cit: CIT[0] }), call('DELETE', '/api/auth/delete-account', { cit: CIT[0] })]);
    expect(r1.statusCode).toBe(202); expect(r1.body.status).toBe('IN_REVIEW');
    expect([r2.statusCode, r2.body.requestId]).toEqual([202, r1.body.requestId]);   // no duplicate
    expect((await db.execute(sql`SELECT count(*)::int n FROM "DSRRequest" WHERE "subjectId" = ${CIT[0].id} AND "requestType" = 'DELETE'`)).rows[0].n).toBe(1);
    // launch-readiness item 63: an open request also says by when the answer is due (one month, GDPR art. 12(3)); a decided one does not (line below)
    expect((await call('GET', '/api/auth/delete-account', { cit: CIT[0] })).body.request).toEqual({ requestId: r1.body.requestId, status: 'IN_REVIEW', dueAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T23:59:59\.999Z$/) });
    const id = r1.body.requestId;
    expect((await openOf(id)).stage).toBe('AWAITING_PROPOSAL');
    expect((await call('GET', `/api/admin/dsr-erasure?id=${id}`, { bearer: plain() })).statusCode, 'reading needs MFA').toBe(403);
    const read = await call('GET', `/api/admin/dsr-erasure?id=${id}`, { bearer: mfa(A) });
    expect(read.body.summary).toEqual({ accountExists: true, dossiers: 1, appointments: 0, activeLegalHolds: 0 });
    expect(JSON.stringify(read.body)).not.toMatch(/67000|rights/);   // counts only, never content
    expect((await erasure(plain(), { id, decision: 'APPROVE' })).statusCode, 'proposing needs MFA').toBe(403);
    expect((await erasure(mfa(A), { id, decision: 'APPROVE' })).statusCode).toBe(200);
    const open = await openOf(id); expect([open.stage, open.proposed, open.proposedBy]).toEqual(['AWAITING_SECOND_REVIEWER', 'APPROVE', A]);
    expect((await erasure(mfa(A), { id, action: 'confirm', note: 'Identité vérifiée', proposedAt: open.proposedAt })).statusCode, 'never the proposer').toBe(403);
    expect((await erasure(mfa(B), { id, action: 'confirm', note: 'Identité vérifiée', proposedAt: 'stale' })).statusCode, 'version read').toBe(409);
    expect(await exists(CIT[0].id), 'nothing erased before the second person confirms').toBe(true);
    // owner LAB audit: the second reviewer confirms only after their own (journalised) reading of the request and the proposal
    expect((await erasure(mfa(B), { id, action: 'confirm', note: 'Identité vérifiée, aucune obligation de conservation', proposedAt: open.proposedAt })).body.error, 'not read yet').toBe('read_required');
    expect((await call('GET', `/api/admin/dsr-erasure?id=${id}`, { bearer: mfa(B) })).statusCode).toBe(200);
    const done = await erasure(mfa(B), { id, action: 'confirm', note: 'Identité vérifiée, aucune obligation de conservation', proposedAt: open.proposedAt });
    expect(done.statusCode).toBe(200); expect(done.body.request.status).toBe('COMPLETED');
    expect(await exists(CIT[0].id)).toBe(false);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "SharedDiagnostic" WHERE id = ${shares[0]}`)).rows[0].n).toBe(0);
    expect((await db.execute(sql`SELECT status FROM "DSRRequest" WHERE id = ${id}`)).rows[0].status).toBe('COMPLETED');
    expect(await audits(id)).toEqual(expect.arrayContaining(['DSR_DELETE_REVIEW_READ', 'DSR_DELETE_REVIEW_PROPOSED', 'DSR_DELETE_REVIEW_APPROVED']));
  });

  it('a legal hold blocks the execution (account kept, the person told why); after its release a retry completes it', async () => {
    await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status) VALUES (${`c21-hold-${TS}`}, 'CitizenUser', ${CIT[1].id}, 'LITIGATION', ${A}, 'ACTIVE')`);
    const id = (await call('DELETE', '/api/auth/delete-account', { cit: CIT[1] })).body.requestId;
    expect((await call('GET', `/api/admin/dsr-erasure?id=${id}`, { bearer: mfa(A) })).body.summary.activeLegalHolds).toBe(1);
    await erasure(mfa(A), { id, decision: 'APPROVE' });
    const open = await openOf(id);
    await call('GET', `/api/admin/dsr-erasure?id=${id}`, { bearer: mfa(B) });   // the second reviewer's reading
    const blocked = await erasure(mfa(B), { id, action: 'confirm', note: 'Conforme, sous réserve de conservation', proposedAt: open.proposedAt });
    expect([blocked.statusCode, blocked.body.request.status, blocked.body.blockedBy]).toEqual([200, 'BLOCKED', 'LEGAL_HOLD_ACTIVE']);
    expect(await exists(CIT[1].id)).toBe(true);
    expect((await call('GET', '/api/auth/delete-account', { cit: CIT[1] })).body.request.status).toBe('BLOCKED');
    expect((await openOf(id)).stage).toBe('BLOCKED_BY_LEGAL_HOLD');
    expect((await erasure(mfa(A), { id, action: 'retry' })).body.request.status, 'still held').toBe('BLOCKED');
    await db.execute(sql`UPDATE "LegalHold" SET status = 'RELEASED', "releasedAt" = NOW(), "releaseProposedBy" = ${A}, "releaseProposedAt" = NOW(), "releaseReason" = 'fin du litige', "releasedBy" = ${B} WHERE id = ${`c21-hold-${TS}`}`);
    const retried = await erasure(mfa(A), { id, action: 'retry' });
    expect(retried.body.request.status).toBe('COMPLETED');
    expect(await exists(CIT[1].id)).toBe(false);
  });

  it('REJECT needs a reason, which the person then reads; nothing is erased and a new request can be filed', async () => {
    const id = (await call('DELETE', '/api/auth/delete-account', { cit: CIT[2] })).body.requestId;
    expect((await erasure(mfa(A), { id, decision: 'REJECT' })).statusCode).toBe(400);
    expect((await erasure(mfa(A), { id, decision: 'REJECT', reason: 'Nous ne pouvons pas confirmer que la demande vient de vous.' })).statusCode).toBe(200);
    const open = await openOf(id);
    await call('GET', `/api/admin/dsr-erasure?id=${id}`, { bearer: mfa(B) });   // the second reviewer's reading
    expect((await erasure(mfa(B), { id, action: 'confirm', note: 'Doute sur l’auteur', proposedAt: open.proposedAt })).body.request.status).toBe('REJECTED');
    expect(await exists(CIT[2].id)).toBe(true);
    expect((await call('GET', '/api/auth/delete-account', { cit: CIT[2] })).body.request).toEqual({ requestId: id, status: 'REJECTED', reason: 'Nous ne pouvons pas confirmer que la demande vient de vous.' });
    const again = await call('DELETE', '/api/auth/delete-account', { cit: CIT[2] });
    expect(again.statusCode).toBe(202); expect(again.body.requestId).not.toBe(id);
    expect(await audits(id)).toEqual(expect.arrayContaining(['DSR_DELETE_REVIEW_PROPOSED', 'DSR_DELETE_REVIEW_REJECTED']));
  });

  it('the privacy console (MFA session) lists the open erasure requests, never the person behind them', async () => {
    const res = await call('GET', '/api/admin/privacy', { bearer: mfa(A) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.erasureRequests.requests)).toBe(true);
    expect(JSON.stringify(res.body.erasureRequests)).not.toMatch(/c21-cit/);
  });
});
