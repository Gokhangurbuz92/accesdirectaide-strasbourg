/**
 * Owner decision 18/11/2026 (« tek yönetici kuralı ») — account erasure with ONE administrator, on REAL PostgreSQL (synthetic data only).
 * The two-person rule of PKG-11 / C21 stays the rule; the proposer may confirm their own proposal only when they are the SOLE active named administrator
 * with MFA, after 24 h of reflection and a reading made after those 24 h. The outcome and the audit record say soleAdministrator.
 *  - soleAdministratorCheck counts enabled AdminUser rows with MFA (a disabled or MFA-less account is not a second administrator);
 *  - a proposer who is not a registered MFA administrator (the env identity) never qualifies: 403 as before;
 *  - with a second active MFA administrator: 403 as before;
 *  - sole: 409 sole_admin_delay before 24 h; read_required for a reading made before the delay ended; then COMPLETED.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0,
  lpush: async () => 1, ltrim: async () => 'OK', lrange: async () => [] } }));

const TS = Date.now(); const CSRF = 'soleadm' + TS;
const CIT = [1, 2].map((n) => ({ id: `sole-cit${n}-${TS}`, email: `sole-cit${n}-${TS}@example.test` }));
const S = `sole-s-${TS}@example.test`; const X = `sole-x-${TS}@example.test`; const Y = `sole-y-${TS}@example.test`;
const ADMINS = [S, X, Y];
function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; }, setHeader(k, v) { headers[String(k).toLowerCase()] = String(v); }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c) { this.statusCode = c; return this; }, json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

describe('owner decision 18/11: sole-administrator erasure confirmation (real DB)', () => {
  let db, api, auth, userAuth, svc;
  const call = async (method, url, { body, cit, bearer } = {}) => {
    const u = new URL(url, 'http://localhost:3000');
    const req = { method, url, query: Object.fromEntries(u.searchParams), body: body ?? null, cookies: {}, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(cit ? { cookie: `${userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: cit.id, email: cit.email })).split(';')[0]}; __csrf=${CSRF}`, 'x-csrf-token': CSRF } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const mfa = (email) => auth.signAdminSessionToken({ email, role: 'admin', mfa_verified: true });
  const addAdmin = (email, mfaEnabled) => db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "updatedAt", "failedLoginAttempts", "mfaEnabled")
    VALUES (${'id-' + email}, ${email}, 'x', 'admin', NOW(), 0, ${mfaEnabled})`);
  const request = async (cit) => {
    const r = await call('DELETE', '/api/auth/delete-account', { cit }); expect(r.statusCode).toBe(202); return r.body.requestId;
  };
  const proposal = async (id) => (await db.execute(sql`SELECT "reviewOutcome" AS o FROM "DSRRequest" WHERE id = ${id}`)).rows[0].o.proposal;
  const exists = async (id) => (await db.execute(sql`SELECT count(*)::int AS n FROM "CitizenUser" WHERE id = ${id}`)).rows[0].n === 1;
  const SOLE = { soleAdministratorCheck: async () => ({ registered: true, others: 0, sole: true }) };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    api = (await import('../../api/index.js')).default; auth = await import('../../api/_utils/auth.js'); userAuth = await import('../../api/_utils/user-auth.js');
    svc = await import('../../api/_services/dsr-erasure-review.js');
    for (const c of CIT) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${c.id}, ${c.email}, 'x', NOW(), NOW())`);
  }, 90000);

  afterAll(async () => {
    if (!db) return;
    for (const c of CIT) {
      await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${c.id}`).catch(() => {});
      await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${c.id}`).catch(() => {});
    }
    for (const a of ADMINS) await db.execute(sql`DELETE FROM "AdminUser" WHERE email = ${a}`).catch(() => {});
  });

  it('soleAdministratorCheck counts only enabled administrators with MFA', async () => {
    const base = (await svc.soleAdministratorCheck(db, `nobody-${TS}@example.test`)).others;
    await addAdmin(X, true); await addAdmin(Y, true);
    expect(await svc.soleAdministratorCheck(db, X)).toEqual({ registered: true, others: base + 1, sole: false });
    await db.execute(sql`UPDATE "AdminUser" SET "disabledAt" = NOW() WHERE email = ${Y}`);
    expect((await svc.soleAdministratorCheck(db, X)).others, 'a disabled administrator is not a second person').toBe(base);
    await db.execute(sql`UPDATE "AdminUser" SET "disabledAt" = NULL, "mfaEnabled" = false WHERE email = ${Y}`);
    expect((await svc.soleAdministratorCheck(db, X)).others, 'an administrator without MFA is not a second reviewer').toBe(base);
    expect((await svc.soleAdministratorCheck(db, X.toUpperCase())).registered, 'case-insensitive').toBe(true);
    expect((await svc.soleAdministratorCheck(db, `nobody-${TS}@example.test`)).registered).toBe(false);
    await db.execute(sql`DELETE FROM "AdminUser" WHERE email IN (${X}, ${Y})`);
  });

  it('an unregistered proposer (env identity) and a proposer with a second MFA administrator still get 403', async () => {
    const id = await request(CIT[0]);
    expect((await call('POST', '/api/admin/dsr-erasure', { bearer: mfa(S), body: { id, decision: 'APPROVE' } })).statusCode).toBe(200);
    const p = await proposal(id);
    const viaApi = await call('POST', '/api/admin/dsr-erasure', { bearer: mfa(S), body: { id, action: 'confirm', note: 'Seul administrateur', proposedAt: p.proposedAt } });
    expect([viaApi.statusCode, viaApi.body.error], 'S has no AdminUser row').toEqual([403, 'second_reviewer_required']);
    const two = await svc.confirmErasure(id, { action: 'confirm', note: 'Seul administrateur', proposedAt: p.proposedAt }, S, db, undefined,
      { soleAdministratorCheck: async () => ({ registered: true, others: 1, sole: false }) });
    expect([two.status, two.code]).toEqual([403, 'second_reviewer_required']);
    expect(await exists(CIT[0].id)).toBe(true);
  });

  it('sole administrator: waits 24 h, reads again after them, then the erasure runs and is recorded as soleAdministrator', async () => {
    const id = await request(CIT[1]);
    expect((await call('GET', `/api/admin/dsr-erasure?id=${id}`, { bearer: mfa(S) })).statusCode).toBe(200);   // reading before proposing
    expect((await call('POST', '/api/admin/dsr-erasure', { bearer: mfa(S), body: { id, decision: 'APPROVE' } })).statusCode).toBe(200);
    let p = await proposal(id);
    const list = (await svc.listOpenErasures(db)).requests.find((r) => r.id === id);
    expect(list.soleAdministratorConfirmableFrom).toBe(new Date(Date.parse(p.proposedAt) + svc.SOLE_ADMIN_DELAY_MS).toISOString());
    const early = await svc.confirmErasure(id, { action: 'confirm', note: 'Seul administrateur, identité vérifiée', proposedAt: p.proposedAt }, S, db, undefined, SOLE);
    expect([early.status, early.code]).toEqual([409, 'sole_admin_delay']);
    expect(early.confirmableFrom).toBe(list.soleAdministratorConfirmableFrom);
    expect(await exists(CIT[1].id), 'nothing erased during the reflection time').toBe(true);
    // 25 hours later (the proposal is moved back in time); the readings made before the end of the delay do not count
    const back = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    await db.execute(sql`UPDATE "DSRRequest" SET "reviewOutcome" = jsonb_set("reviewOutcome", '{proposal,proposedAt}', to_jsonb(${back}::text)) WHERE id = ${id}`);
    await db.execute(sql`UPDATE "AuditLog" SET "timestamp" = "timestamp" - interval '25 hours' WHERE entity = 'DSR_REQUEST' AND entity_id = ${id}`);
    p = await proposal(id); expect(p.proposedAt).toBe(back);
    const unread = await svc.confirmErasure(id, { action: 'confirm', note: 'Seul administrateur, identité vérifiée', proposedAt: p.proposedAt }, S, db, undefined, SOLE);
    expect(unread.code, 'a reading from before the end of the delay').toBe('read_required');
    expect((await svc.readErasure(id, S, db)).ok).toBe(true);
    const done = await svc.confirmErasure(id, { action: 'confirm', note: 'Seul administrateur, identité vérifiée', proposedAt: p.proposedAt }, S, db, undefined, SOLE);
    expect([done.ok, done.request.status]).toEqual([true, 'COMPLETED']);
    expect(await exists(CIT[1].id)).toBe(false);
    const approved = (await db.execute(sql`SELECT details FROM "AuditLog" WHERE entity = 'DSR_REQUEST' AND entity_id = ${id} AND action = 'DSR_DELETE_REVIEW_APPROVED'`)).rows;
    expect(approved).toHaveLength(1); expect(approved[0].details.soleAdministrator).toBe(true);
  });
});
