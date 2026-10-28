/**
 * K0 on REAL PostgreSQL: a verification / reset link is single use even when it is submitted several times AT ONCE.
 * Before: the handlers read the token, then marked it used in a separate statement, so concurrent submissions could all pass. Now the claim is one conditional UPDATE ... RETURNING.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import crypto from 'node:crypto';
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const U = { id: `k0tok-${TS}`, email: `k0tok-${TS}@example.test` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('K0 auth tokens are single use under concurrency (real DB)', () => {
  let db, userAuth, reset, verify;
  const token = async (type) => { const raw = crypto.randomBytes(32).toString('base64url'); await db.execute(sql`INSERT INTO "AuthToken" (id, "userId", type, "tokenHash", "expiresAt") VALUES (${crypto.randomUUID()}, ${U.id}, ${type}, ${userAuth.hashAuthToken(raw)}, NOW() + interval '1 hour')`); return raw; };
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    userAuth = await import('../../api/_utils/user-auth.js');
    reset = (await import('../../api/_handlers/auth/reset-password.js')).default;
    verify = (await import('../../api/_handlers/auth/verify-email.js')).default;
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES (${U.id}, ${U.email}, 'x', NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuthToken" WHERE "userId" = ${U.id}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U.id}`);
  });

  it('five simultaneous resets with ONE link: exactly one succeeds, and the stored password is that one', async () => {
    const raw = await token('PASSWORD_RESET');
    const pws = [1, 2, 3, 4, 5].map((i) => `Qa-Passw0rd-${i}`);
    const out = await Promise.all(pws.map(async (password) => { const r = mk(); await reset({ method: 'POST', headers: {}, body: { token: raw, password } }, r); return { password, status: r.statusCode }; }));
    const ok = out.filter((o) => o.status === 200);
    expect(ok.length, JSON.stringify(out)).toBe(1);
    expect(out.filter((o) => o.status === 400).length).toBe(4);
    const [{ h }] = (await db.execute(sql`SELECT "passwordHash" h FROM "CitizenUser" WHERE id = ${U.id}`)).rows;
    expect(await userAuth.verifyPassword(ok[0].password, h)).toBe(true);
  });

  it('five simultaneous verifications with ONE link: one success, the others are told the link is no longer valid', async () => {
    const raw = await token('EMAIL_VERIFY');
    const out = await Promise.all([1, 2, 3, 4, 5].map(async () => { const r = mk(); await verify({ method: 'GET', url: `/api/auth/verify-email?token=${encodeURIComponent(raw)}`, query: { token: raw }, headers: { host: 'localhost' } }, r); return String(r.headers.Location || r.headers.location || ''); }));
    expect(out.filter((l) => l.includes('status=success')).length, JSON.stringify(out)).toBe(1);
    expect(out.filter((l) => l.includes('status=expired')).length).toBe(4);
  });
});
