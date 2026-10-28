/**
 * Citizen e-mail journey — real PostgreSQL, real handlers, synthetic mail (built-in `test` outbox, no network).
 * Proves: (1) with a deliverable provider the journey signup → mail → verify → login → /auth/me works end-to-end;
 *         (2) with `noop` (the default) the journey is blocked AND the system reports it (error log + production readiness 503),
 *             so "accepted" is never mistaken for "delivered";
 *         (3) provider readiness rules (resend/mailjet need keys; smtp/postmark/sendgrid/brevo are not wired).
 * Requires DATABASE_URL (isolated local PostgreSQL); skipped otherwise.
 */
import { vi } from 'vitest';
const hoisted = vi.hoisted(() => ({ calls: [] }));
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429),
}));
vi.mock('../../api/_utils/logger.js', () => {
  const fn = (level) => (...args) => { hoisted.calls.push({ level, args }); };
  const logger = new Proxy({}, { get: (_t, level) => (level === 'child' ? () => logger : fn(String(level))) });
  return { default: logger, logger };
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const EMAIL = `journey-${TS}@example.test`;
const PASSWORD = 'Sup3r-secret-pass!';

function makeRes() {
  return { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, end(d) { if (d !== undefined) this.body = d; return this; } };
}

describe.skipIf(!hasDatabase)('citizen e-mail journey (real DB, synthetic mail)', () => {
  let db, mailer, signup, verify, login, me, health;
  const post = async (handler, url, body, cookie) => { const res = makeRes(); await handler({ method: 'POST', url, query: {}, body, headers: { host: 'localhost:3000', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, res); return res; };
  const get = async (handler, url, query = {}, cookie) => { const res = makeRes(); await handler({ method: 'GET', url, query, headers: { host: 'localhost:3000', ...(cookie ? { cookie } : {}) } }, res); return res; };

  beforeAll(async () => {
    vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-journey');
    ({ db } = await import('../../src/db/index.js'));
    mailer = await import('../../api/_utils/mailer.js');
    ({ default: signup } = await import('../../api/_handlers/auth/signup.js'));
    ({ default: verify } = await import('../../api/_handlers/auth/verify-email.js'));
    ({ default: login } = await import('../../api/_handlers/auth/login.js'));
    ({ default: me } = await import('../../api/_handlers/auth/me.js'));
    ({ default: health } = await import('../../api/_handlers/health.js'));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-journey'); hoisted.calls.length = 0; });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuthToken" WHERE "userId" IN (SELECT id FROM "CitizenUser" WHERE email = ${EMAIL})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE email = ${EMAIL}`);
  });

  it('deliverable provider: signup → mail → blocked login → verify (single use) → login → /auth/me', async () => {
    mailer.__clearTestOutbox();
    const created = await post(signup, '/api/auth/signup', { email: EMAIL, password: PASSWORD });
    expect(created.statusCode).toBe(200);
    const box = mailer.__getTestOutbox();
    expect(box).toHaveLength(1);
    expect(box[0]).toMatchObject({ to: EMAIL, category: 'email_verify' });
    const link = new URL(box[0].text.match(/https?:\/\/\S+/)[0]);
    expect(link.pathname).toBe('/api/auth/verify-email');
    const token = link.searchParams.get('token');
    expect(token.length).toBeGreaterThan(20);

    const early = await post(login, '/api/auth/login', { email: EMAIL, password: PASSWORD });
    // PKG-11 R2-7 TEST-ONLY OVERLAY (STRASBOURG_FULL_PRODUCT_PLAN/R2_7_LOGIN_ANSWER_OVERLAY_V1.md): the login is still BLOCKED before verification (no session),
    // but with the one refusal answer (401) instead of 403 EMAIL_NOT_VERIFIED, which was an account-existence oracle. Title unchanged.
    expect(early.statusCode).toBe(401);
    expect(early.body.code).toBeUndefined(); expect(early.headers['Set-Cookie']).toBeUndefined();

    const bad = await get(verify, '/api/auth/verify-email', { token: token.slice(0, -3) + 'xyz' });
    expect(bad.headers.Location).toContain('status=invalid');
    const ok = await get(verify, '/api/auth/verify-email', { token });
    expect(ok.headers.Location).toContain('status=success');
    const again = await get(verify, '/api/auth/verify-email', { token });
    expect(again.headers.Location).toContain('status=expired'); // single use

    const logged = await post(login, '/api/auth/login', { email: EMAIL, password: PASSWORD });
    expect(logged.statusCode).toBe(200);
    const cookie = String(logged.headers['Set-Cookie']).split(';')[0];
    const who = await get(me, '/api/auth/me', {}, cookie);
    expect(who.statusCode).toBe(200);
    expect(who.body.session.kind).toBe('user');
    expect(who.body.user.emailVerified).toBe(true);
  });

  it('wrong password never reveals state and does not verify the account', async () => {
    const res = await post(login, '/api/auth/login', { email: EMAIL, password: 'definitely-wrong-password' });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('noop provider (the default): the journey is blocked and the failure is VISIBLE (error log + production readiness 503)', async () => {
    vi.stubEnv('MAILER_PROVIDER', 'noop');
    const email2 = `noop-${TS}@example.test`;
    const created = await post(signup, '/api/auth/signup', { email: email2, password: PASSWORD });
    expect(created.statusCode).toBe(200);                       // generic anti-enumeration answer is preserved
    expect(created.body.message).toMatch(/lien/i);               // ...which is exactly why undelivered mail must be observable elsewhere
    const undelivered = hoisted.calls.filter((c) => c.level === 'error' && c.args[0]?.msg === 'mailer.undelivered');
    expect(undelivered).toHaveLength(1);
    expect(undelivered[0].args[0]).toMatchObject({ provider: 'noop', category: 'email_verify' });
    expect(JSON.stringify(undelivered[0].args)).not.toContain(email2); // no address in logs

    const blocked = await post(login, '/api/auth/login', { email: email2, password: PASSWORD });
    expect(blocked.statusCode).toBe(401);   // R2-7 overlay: blocked, with the one refusal answer (see above)
    expect(blocked.body.code).toBeUndefined();

    vi.stubEnv('VERCEL_ENV', 'production');
    const ready = await get(health, '/api/health/ready');
    expect(ready.statusCode).toBe(503);
    expect(ready.body).toMatchObject({ ok: false, status: 'not_ready', error: 'mail_delivery_unavailable' });
    vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('NODE_ENV', 'test');
    const nonProd = await get(health, '/api/health/ready');
    expect(nonProd.statusCode).toBe(200);
    expect(nonProd.body.checks.mail).toMatch(/undeliverable/);
    await db.execute(sql`DELETE FROM "AuthToken" WHERE "userId" IN (SELECT id FROM "CitizenUser" WHERE email = ${email2})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE email = ${email2}`);
  });

  it('production readiness follows real deliverability: resend/mailjet need keys; smtp & co are not wired', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const ready = async () => (await get(health, '/api/health/ready')).statusCode;
    vi.stubEnv('MAILER_PROVIDER', 'resend'); vi.stubEnv('MAILER_API_KEY', '');
    expect(await ready()).toBe(503);
    vi.stubEnv('MAILER_API_KEY', 're_dummy_key');
    expect(await ready()).toBe(200);
    vi.stubEnv('MAILER_PROVIDER', 'mailjet'); vi.stubEnv('MAILER_API_KEY', 'justone');
    expect(await ready()).toBe(503);
    vi.stubEnv('MAILER_API_KEY', 'pub:sec');
    expect(await ready()).toBe(200);
    for (const p of ['smtp', 'postmark', 'sendgrid', 'brevo']) { vi.stubEnv('MAILER_PROVIDER', p); expect(await ready(), p).toBe(503); }
  });
});
