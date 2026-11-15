/** A-23 — GET /api/auth/me returns the signed-in account's OWN stored interface language (REAL PostgreSQL, synthetic accounts); null when the person has no profile row. */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { id: `a23-a-${TS}`, email: `a23-a-${TS}@example.test` }, B = { id: `a23-b-${TS}`, email: `a23-b-${TS}@example.test` }, C = { id: `a23-c-${TS}`, email: `a23-c-${TS}@example.test` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('A-23 auth/me carries the account language (real DB)', () => {
  let db, userAuth, me;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async (as) => { const r = mk(); await me({ method: 'GET', url: '/api/auth/me', query: {}, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}) } }, r); return r; };
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); userAuth = await import('../../api/_utils/user-auth.js'); me = (await import('../../api/_handlers/auth/me.js')).default;
    for (const u of [A, B, C]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenProfile" ("userId", "preferredLanguage", "updatedAt") VALUES (${A.id}, 'ar', NOW()), (${B.id}, 'tr', NOW())`);
  });
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A.id}, ${B.id}, ${C.id})`); });

  it('each account gets its own language; an account without a profile gets null; signed out gets 401', async () => {
    const a = await call(A); expect(a.statusCode).toBe(200); expect(a.body.user).toMatchObject({ id: A.id, preferredLanguage: 'ar' });
    expect((await call(B)).body.user.preferredLanguage).toBe('tr');
    const c = await call(C); expect(c.statusCode).toBe(200); expect(c.body.user.preferredLanguage).toBeNull();
    expect((await call(null)).statusCode).toBe(401);
  });
});
