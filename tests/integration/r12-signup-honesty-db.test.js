/**
 * R12 (C01) — on real PostgreSQL: without a mail provider, sign-up and resend no longer say « a link was sent »; the answer depends on the service's
 * configuration only, so a new address and an existing verified one get exactly the same body (no account-existence oracle). With the test provider the
 * former wording comes back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const TS = Date.now();
const KNOWN = `r12-known-${TS}@example.test`; const FRESH = `r12-fresh-${TS}@example.test`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });

describe.skipIf(!hasDatabase)('R12 sign-up honesty (real DB)', () => {
  let db; let signup; let resend; const saved = {};
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    signup = (await import('../../api/_handlers/auth/signup.js')).default; resend = (await import('../../api/_handlers/auth/resend-verification.js')).default;
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${'r12k-' + TS}, ${KNOWN}, 'x', NOW(), NOW())`);
    saved.p = process.env.MAILER_PROVIDER;
  });
  afterAll(async () => {
    if (saved.p === undefined) delete process.env.MAILER_PROVIDER; else process.env.MAILER_PROVIDER = saved.p;
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuthToken" WHERE "userId" IN (SELECT id FROM "CitizenUser" WHERE email IN (${KNOWN}, ${FRESH}))`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE email IN (${KNOWN}, ${FRESH})`);
  });
  const call = async (h, email, i) => { const r = mk(); await h({ method: 'POST', url: '/api/auth/x', headers: { host: 'localhost', 'x-forwarded-for': `10.8.${i}.1` }, body: { email, password: 'Synthetic-QA-Pass-01', next: '/' } }, r); return r; };

  it('no provider: the same honest body for a new and an existing address; nothing claims a link was sent', async () => {
    delete process.env.MAILER_PROVIDER;
    const known = await call(signup, KNOWN, 1); const fresh = await call(signup, FRESH, 2);
    expect([known.statusCode, fresh.statusCode]).toEqual([200, 200]);
    expect(known.body).toEqual(fresh.body);
    expect(fresh.body.emailDelivery).toBe('UNAVAILABLE'); expect(fresh.body.message).not.toMatch(/un lien a été envoyé/);
    const r1 = await call(resend, KNOWN, 3); const r2 = await call(resend, FRESH, 4);
    expect(r1.body).toEqual(r2.body); expect(r1.body.emailDelivery).toBe('UNAVAILABLE');
  });
  it('no provider: the password-reset answers (citizen and professional) say no e-mail can be sent, the same for every address', async () => {
    delete process.env.MAILER_PROVIDER;
    const citizen = (await import('../../api/_handlers/auth/forgot-password.js')).default; const pro = (await import('../../api/_handlers/pro/auth/forgot-password.js')).default;
    const c1 = await call(citizen, KNOWN, 7); const c2 = await call(citizen, FRESH, 8);
    expect(c1.body).toEqual(c2.body); expect(c1.body.emailDelivery).toBe('UNAVAILABLE');
    const p1 = await call(pro, KNOWN, 9); const p2 = await call(pro, `nobody-${TS}@example.test`, 10);
    expect(p1.body).toEqual(p2.body); expect(p1.body.emailDelivery).toBe('UNAVAILABLE'); expect(p1.body.message).not.toMatch(/un lien a été envoyé/);
  });
  it('test provider: « si l’email est valide, un lien a été envoyé », still the same for both', async () => {
    process.env.MAILER_PROVIDER = 'test';
    const known = await call(signup, KNOWN, 5); const other = await call(signup, `r12-other-${TS}@example.test`, 6);
    expect(known.body).toEqual(other.body); expect(known.body.emailDelivery).toBe('SENT_IF_VALID');
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE email = ${`r12-other-${TS}@example.test`}`);
  });
});
