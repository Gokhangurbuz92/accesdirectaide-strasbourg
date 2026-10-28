/**
 * R12 / Q11 — the account lockout under CONCURRENT failures, on REAL PostgreSQL: five wrong passwords sent at the same moment (as five serverless instances would
 * receive them) all count — the counter is one atomic increment in the database, not a read-then-write that loses failures — and the account is locked; the right
 * password is then refused. Same for an administrator account (admin-identity). Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const PASSWORD = 'Sup3r-secret-pass!';
const makeRes = () => { const r = { statusCode: 200, headers: {}, body: null }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.getHeader = (k) => r.headers[k]; r.end = () => r; return r; };

describe.skipIf(!hasDatabase)('lockout counters under concurrent failures (real DB)', () => {
  let db; let login; let adminIdentity; const U = { id: `lock-${TS}`, email: `lock-${TS}@example.test` }; const A = { id: `lockadm-${TS}`, email: `lockadm-${TS}@example.test` };
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: login } = await import('../../api/_handlers/auth/login.js'));
    adminIdentity = await import('../../api/_services/admin-identity.js');
    const { hashPassword } = await import('../../api/_utils/password-hash.js');
    const h = await hashPassword(PASSWORD);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${U.id}, ${U.email}, ${h}, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "failedLoginAttempts", "mfaEnabled", "updatedAt") VALUES (${A.id}, ${A.email}, ${h}, 'admin', 0, false, NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE details::text LIKE ${`%${A.email}%`}`).catch(() => {});
    await db.execute(sql`DELETE FROM "AdminUser" WHERE id = ${A.id}`).catch(() => {});
  });

  it('five simultaneous wrong passwords of a citizen all count and lock the account; the right password is then refused', async () => {
    const post = (password, i) => { const res = makeRes(); return login({ method: 'POST', url: '/api/auth/login', query: {}, body: { email: U.email, password }, headers: { host: 'localhost:3000', 'content-type': 'application/json', 'x-forwarded-for': `10.9.${i}.1` }, socket: { remoteAddress: `10.9.${i}.1` } }, res).then(() => res); };
    const out = await Promise.all([0, 1, 2, 3, 4].map((i) => post('wrong-password-x', i)));
    expect(out.map((r) => r.statusCode)).toEqual([401, 401, 401, 401, 401]);
    const row = (await db.execute(sql`SELECT "failedLoginAttempts" AS n, "lockoutUntil" > NOW() AS locked FROM "CitizenUser" WHERE id = ${U.id}`)).rows[0];
    expect(row).toMatchObject({ n: 5, locked: true });
    expect((await post(PASSWORD, 9)).statusCode).toBe(401);
    // R12 (C01): once the lockout has run out, one wrong password starts a fresh count (it used to re-lock at once); the right one then signs in
    await db.execute(sql`UPDATE "CitizenUser" SET "lockoutUntil" = NOW() - interval '1 minute' WHERE id = ${U.id}`);
    expect((await post('wrong-password-x', 10)).statusCode).toBe(401);
    expect((await db.execute(sql`SELECT "failedLoginAttempts" AS n, "lockoutUntil" IS NULL AS clear FROM "CitizenUser" WHERE id = ${U.id}`)).rows[0]).toMatchObject({ n: 1, clear: true });
    expect((await post(PASSWORD, 11)).statusCode).toBe(200);
  });

  it('five simultaneous wrong passwords of an administrator all count and lock the account', async () => {
    const out = await Promise.all([0, 1, 2, 3, 4].map(() => adminIdentity.adminLogin({ email: A.email, password: 'wrong-password-x' }, { db })));
    expect(out.map((r) => r.ok)).toEqual([false, false, false, false, false]);
    const row = (await db.execute(sql`SELECT "failedLoginAttempts" AS n, "lockoutUntil" > NOW() AS locked FROM "AdminUser" WHERE id = ${A.id}`)).rows[0];
    expect(row.n).toBeGreaterThanOrEqual(5); expect(row.locked).toBe(true);
  });
});
