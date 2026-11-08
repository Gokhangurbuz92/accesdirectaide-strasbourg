/**
 * Release B (D2 V2, owner direction 08/11/2026) — REAL PostgreSQL, real handlers:
 *   - sign-up without the acceptance of the terms is refused (400 TERMS_ACCEPTANCE_REQUIRED, after the adult declaration check) and creates nothing;
 *   - with it, the account is created and the ledger keeps a CONTRACT_ACCEPTANCE row naming « cgu-citoyen@<version> » next to the adult declaration;
 *   - with the Production-like gates (restricted beta), a phone field sent to the sign-up is ignored, PUT citizen/phone refuses a new number (403
 *     PHONE_COLLECTION_CLOSED) but removes a stored one, and auth/me says phoneCollection: false; the LAB (no beta) keeps the phone.
 * Synthetic data only, in-memory test mailer. Skipped without DATABASE_URL.
 */
import { vi, afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const PW = 'Synthetique-QA-2026x';
const mail = (n) => `relb-${n}-${TS}@example.test`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const GATES = ['ADA_PUBLIC_BETA_RESTRICTED', 'ADA_BETA_OPEN_SURFACES', 'ADA_CAPABILITY_ENFORCEMENT'];

describe.skipIf(!hasDatabase)('Release B — sign-up terms acceptance and closed phone collection (real DB)', () => {
  let db, signup, phoneH, me, userAuth, saved;
  const call = async (h, req) => { const r = mk(); await h({ query: {}, socket: {}, headers: { host: 'localhost', ...(req.headers || {}) }, ...req }, r); return r; };
  const doSignup = (body) => call(signup, { method: 'POST', url: '/api/auth/signup', body: { password: PW, next: '/compte', ...body } });
  const userOf = async (email) => (await db.execute(sql`SELECT id, phone FROM "CitizenUser" WHERE email = ${email}`)).rows[0];
  const prodLike = () => { process.env.ADA_PUBLIC_BETA_RESTRICTED = '1'; process.env.ADA_BETA_OPEN_SURFACES = 'admin,accounts'; process.env.ADA_CAPABILITY_ENFORCEMENT = '1'; };

  beforeAll(async () => {
    saved = Object.fromEntries(GATES.map((k) => [k, process.env[k]]));
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    ({ db } = await import('../../src/db/index.js'));
    userAuth = await import('../../api/_utils/user-auth.js');
    signup = (await import('../../api/_handlers/auth/signup.js')).default;
    phoneH = (await import('../../api/_handlers/citizen/phone.js')).default;
    me = (await import('../../api/_handlers/auth/me.js')).default;
  }, 60000);
  afterEach(() => { for (const k of GATES) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  afterAll(async () => {
    if (!db) return;
    const like = `relb-%-${TS}@example.test`;
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (SELECT id FROM "CitizenUser" WHERE email LIKE ${like})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuthToken" WHERE "userId" IN (SELECT id FROM "CitizenUser" WHERE email LIKE ${like})`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id IN (SELECT id FROM "CitizenUser" WHERE email LIKE ${like})`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE email LIKE ${like}`).catch(() => {});
  });

  it('refuses a sign-up without the acceptance of the terms (after the adult check) and creates nothing', async () => {
    for (const termsAccepted of [undefined, false, 'true', 1]) {
      const r = await doSignup({ email: mail('noterms'), adultDeclaration: true, ...(termsAccepted === undefined ? {} : { termsAccepted }) });
      expect(r.statusCode, String(termsAccepted)).toBe(400); expect(r.body.code).toBe('TERMS_ACCEPTANCE_REQUIRED');
    }
    const adultFirst = await doSignup({ email: mail('noterms'), termsAccepted: true });
    expect(adultFirst.body.code, 'the adult declaration is checked first').toBe('ADULT_DECLARATION_REQUIRED');
    expect(await userOf(mail('noterms'))).toBeUndefined();
  });

  it('records the acceptance of « cgu-citoyen@<version> » as a contract acceptance, next to the adult declaration', async () => {
    const { termsReference } = await import('../../api/_utils/terms-acceptance.js');
    const r = await doSignup({ email: mail('ok'), adultDeclaration: true, termsAccepted: true });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    const u = await userOf(mail('ok')); expect(u).toBeTruthy();
    const rows = (await db.execute(sql`SELECT purpose, decision, policy_version, proof_level, collection_channel FROM "ConsentLog" WHERE subject_id = ${u.id} ORDER BY purpose`)).rows;
    expect(rows).toEqual([
      expect.objectContaining({ purpose: 'AGE_DECLARATION_ADULT', decision: true }),
      { purpose: 'TERMS_ACCEPTANCE_CGU_CITOYEN', decision: true, policy_version: termsReference(), proof_level: 'CONTRACT_ACCEPTANCE', collection_channel: 'signup' },
    ]);
  });

  it('Production-like gates: the sign-up ignores a phone, PUT citizen/phone refuses a new number but removes a stored one, auth/me says phoneCollection false', async () => {
    prodLike();
    const r = await doSignup({ email: mail('phone'), adultDeclaration: true, termsAccepted: true, phone: '0612345678' });
    expect(r.statusCode).toBe(200);
    const u = await userOf(mail('phone')); expect(u.phone, 'the phone is never stored').toBeNull();
    await db.execute(sql`UPDATE "CitizenUser" SET "emailVerifiedAt" = NOW(), phone = '0611111111' WHERE id = ${u.id}`);
    const cookie = `ada_user_session=${encodeURIComponent(userAuth.signUserSessionToken({ userId: u.id, email: mail('phone') }))}`;
    const add = await call(phoneH, { method: 'PUT', url: '/api/citizen/phone', body: { phone: '0622222222' }, headers: { cookie } });
    expect(add.statusCode, JSON.stringify(add.body)).toBe(403);
    expect(JSON.stringify(add.body)).toContain('PHONE_COLLECTION_CLOSED');
    expect((await userOf(mail('phone'))).phone, 'unchanged').toBe('0611111111');
    const del = await call(phoneH, { method: 'PUT', url: '/api/citizen/phone', body: { phone: null }, headers: { cookie } });
    expect(del.statusCode, JSON.stringify(del.body)).toBe(200);
    expect((await userOf(mail('phone'))).phone, 'removal stays possible').toBeNull();
    const who = await call(me, { method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(who.statusCode, JSON.stringify(who.body)).toBe(200); expect(who.body.user.phoneCollection).toBe(false);
  });

  it('the LAB (no beta) keeps the phone (the full product runs there)', async () => {
    const r = await doSignup({ email: mail('lab'), adultDeclaration: true, termsAccepted: true, phone: '0612345678' });
    expect(r.statusCode).toBe(200);
    expect((await userOf(mail('lab'))).phone).toBe('0612345678');
  });
});
