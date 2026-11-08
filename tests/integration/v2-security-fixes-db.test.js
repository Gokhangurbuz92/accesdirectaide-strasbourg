/**
 * V2 security review (09/11/2026) — REAL PostgreSQL, real handlers, synthetic data, in-memory test mailer:
 *   D1  sign-up / forgot-password / resend answer before the address-dependent work; the work completes after (settleAfterResponse); a verified address
 *       gets no e-mail; the answers are identical whether or not an account exists;
 *   D2  a password reset cancels a pending e-mail change (its link no longer works); confirming an e-mail change kills the reset / verification links
 *       sent to the old address;
 *   D4  a concurrent duplicate sign-up is the ordinary answer (unique violation recognised through the driver's wrapper), not a 500;
 *   D6  in Production, a sign-up under terms that are not in force is refused (503 TERMS_NOT_IN_FORCE) and creates nothing; with the approved version it
 *       works; purge step 6c deletes never-activated accounts older than 7 days with their sign-up ledger rows, and keeps verified, recent, held ones.
 * Run: bash $S/r44int.sh <wt> ada_v2sec_test tests/integration/v2-security-fixes-db.test.js
 */
import { vi, afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { approvedTestPolicy, approvalEnv } from '../helpers/gdpr-purge-approval.js';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const PW = 'Synthetique-QA-2026x';
const PW2 = 'Nouveau-Synthetique-2026y';
const mail = (n) => `v2sec-${n}-${TS}@example.test`;
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; },
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, end() { return this; }, redirect(c, l) { this.statusCode = c; this.headers.location = l; return this; } });
const ENV_KEYS = ['VERCEL_ENV', 'VITE_LEGAL_DOCS_APPROVED_VERSION', 'ENUMERATION_FLOOR_MS', 'APP_BASE_URL'];

describe.skipIf(!hasDatabase)('V2 security fixes D1, D2, D4, D6 (real DB)', () => {
  let db, signup, forgot, resend, reset, ua, after, mailer, ecs, purge, version, saved;
  const call = async (h, body) => { const r = mk(); await h({ method: 'POST', query: {}, socket: {}, headers: { host: 'localhost' }, body }, r); return r; };
  const userOf = async (email) => (await db.execute(sql`SELECT id, "emailVerifiedAt" FROM "CitizenUser" WHERE email = ${email}`)).rows[0];
  const mailsTo = (to) => mailer.__getTestOutbox().filter((m) => String(m.to).toLowerCase() === to);
  const tokenFrom = (text) => /token=([0-9a-f]{64})/.exec(String(text))?.[1];

  beforeAll(async () => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    ({ db } = await import('../../src/db/index.js'));
    ua = await import('../../api/_utils/user-auth.js');
    after = await import('../../api/_utils/after-response.js');
    mailer = await import('../../api/_utils/mailer.js');
    ecs = await import('../../api/_services/email-change.js');
    purge = await import('../../api/_handlers/cron/gdpr-purge.js');
    ({ LEGAL_DRAFTS_VERSION: version } = await import('../../src/config/legal-drafts.js'));
    signup = (await import('../../api/_handlers/auth/signup.js')).default;
    forgot = (await import('../../api/_handlers/auth/forgot-password.js')).default;
    resend = (await import('../../api/_handlers/auth/resend-verification.js')).default;
    reset = (await import('../../api/_handlers/auth/reset-password.js')).default;
  }, 60000);
  afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  afterAll(async () => {
    if (!db) return;
    await after.settleAfterResponse();
    const like = `v2sec-%-${TS}@example.test`;
    const ids = sql`(SELECT id FROM "CitizenUser" WHERE email LIKE ${like} OR id LIKE ${`v2sec-%-${TS}`})`;
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN ${ids} OR subject_id LIKE ${`v2sec-%-${TS}`}`).catch(() => {});
    await db.execute(sql`DELETE FROM "LegalHold" WHERE id LIKE ${`v2sec-%-${TS}`}`).catch(() => {});
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action = 'GDPR_PURGE_RUN' OR actor_id IN ${ids}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE email LIKE ${like} OR id LIKE ${`v2sec-%-${TS}`}`).catch(() => {});
  });

  it('D1: the answers come before the work, are identical for every address, and the work completes after the answer', async () => {
    const body = (email) => ({ email, password: PW, adultDeclaration: true, termsAccepted: true, next: '/compte' });
    const a = await call(signup, body(mail('d1')));
    expect(a.statusCode).toBe(200);
    await after.settleAfterResponse();
    const u = await userOf(mail('d1'));
    expect(u, 'created after the answer').toBeTruthy();
    expect(mailsTo(mail('d1'))).toHaveLength(1);
    await db.execute(sql`UPDATE "CitizenUser" SET "emailVerifiedAt" = NOW() WHERE id = ${u.id}`);
    const again = await call(signup, body(mail('d1')));
    const fresh = await call(signup, body(mail('d1-other')));
    expect(again.body, 'same answer for a verified and a new address').toEqual(fresh.body);
    await after.settleAfterResponse();
    expect(mailsTo(mail('d1')), 'a verified address receives nothing').toHaveLength(1);
    const f1 = await call(forgot, { email: mail('d1') });
    const f2 = await call(forgot, { email: mail('nobody') });
    expect(f1.body).toEqual(f2.body);
    await after.settleAfterResponse();
    expect(mailsTo(mail('d1')).at(-1).category).toBe('password_reset');
    expect(mailsTo(mail('nobody'))).toHaveLength(0);
    const r1 = await call(resend, { email: mail('d1-other') });
    const r2 = await call(resend, { email: mail('nobody') });
    expect(r1.body).toEqual(r2.body);
    await after.settleAfterResponse();
    expect(mailsTo(mail('d1-other')).map((m) => m.category)).toEqual(['email_verify', 'email_verify']);
  });

  it('D1: in Production the answer is never sent before the floor; outside it there is no floor', async () => {
    expect(after.responseFloorMs({ VERCEL_ENV: 'production' })).toBe(400);
    expect(after.responseFloorMs({ VERCEL_ENV: 'preview', ENUMERATION_FLOOR_MS: '250' })).toBe(250);
    expect(after.responseFloorMs({})).toBe(0);
    process.env.VERCEL_ENV = 'production'; process.env.ENUMERATION_FLOOR_MS = '300';
    process.env.VITE_LEGAL_DOCS_APPROVED_VERSION = `cgu-citoyen@${version},notice-confidentialite@${version}`;
    process.env.APP_BASE_URL = 'https://www.example.test';
    const t0 = Date.now(); await call(forgot, { email: mail('nobody2') });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(295);
    await after.settleAfterResponse();
  });

  it('D2: a password reset cancels a pending e-mail change; a confirmed change kills the links sent to the old address', async () => {
    await call(signup, { email: mail('d2'), password: PW, adultDeclaration: true, termsAccepted: true });
    await after.settleAfterResponse();
    const u = await userOf(mail('d2'));
    await db.execute(sql`UPDATE "CitizenUser" SET "emailVerifiedAt" = NOW(), "passwordHash" = ${await ua.hashPassword(PW)} WHERE id = ${u.id}`);
    // the attacker (knows the password) asks for a change to their address
    const sent = [];
    const req = await ecs.requestEmailChange(u.id, { newEmail: mail('d2-attacker'), password: PW }, { db, send: async (m) => { sent.push(m); return { outcome: 'TEST_RECORDED' }; } });
    expect(req.ok).toBe(true);
    const changeToken = tokenFrom(sent.find((m) => m.to === mail('d2-attacker')).text);
    // the person follows the notice: password reset
    await call(forgot, { email: mail('d2') });
    await after.settleAfterResponse();
    const resetToken = tokenFrom(mailsTo(mail('d2')).at(-1).text);
    const rs = await call(reset, { token: resetToken, password: PW2 });
    expect(rs.statusCode, JSON.stringify(rs.body)).toBe(200);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "EmailChangeRequest" WHERE "userId" = ${u.id}`)).rows[0].n).toBe(0);
    expect(await ecs.confirmEmailChange(changeToken, { db }), 'the attacker link is dead').toMatchObject({ ok: false, status: 'invalid' });
    expect((await userOf(mail('d2'))).id, 'address unchanged').toBe(u.id);
    // a legitimate change: a reset link sent to the old address before the change stops working
    await call(forgot, { email: mail('d2') });
    await after.settleAfterResponse();
    const oldReset = tokenFrom(mailsTo(mail('d2')).at(-1).text);
    const sent2 = [];
    await ecs.requestEmailChange(u.id, { newEmail: mail('d2-new'), password: PW2 }, { db, send: async (m) => { sent2.push(m); return { outcome: 'TEST_RECORDED' }; } });
    expect(await ecs.confirmEmailChange(tokenFrom(sent2.find((m) => m.to === mail('d2-new')).text), { db })).toMatchObject({ ok: true, status: 'changed' });
    const late = await call(reset, { token: oldReset, password: 'Encore-Synthetique-2026z' });
    expect(late.statusCode, 'the old-address reset link is dead').toBe(400);
  });

  it('D4: a concurrent duplicate sign-up gives the ordinary answer and one account', async () => {
    const body = { email: mail('d4'), password: PW, adultDeclaration: true, termsAccepted: true };
    const [a, b] = await Promise.all([call(signup, body), call(signup, body)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    await after.settleAfterResponse();
    expect((await db.execute(sql`SELECT count(*)::int n FROM "CitizenUser" WHERE email = ${mail('d4')}`)).rows[0].n).toBe(1);
    const { isUniqueViolation } = await import('../../api/_handlers/auth/signup.js');
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation({ message: 'Failed query: insert … duplicate' })).toBe(false);
  });

  it('D6: in Production a sign-up under terms not in force is refused and creates nothing; with the approved version it works', async () => {
    process.env.VERCEL_ENV = 'production'; process.env.ENUMERATION_FLOOR_MS = '0'; process.env.APP_BASE_URL = 'https://www.example.test';
    delete process.env.VITE_LEGAL_DOCS_APPROVED_VERSION;
    const body = { email: mail('d6'), password: PW, adultDeclaration: true, termsAccepted: true };
    const no = await call(signup, body);
    expect(no.statusCode).toBe(503); expect(no.body.code).toBe('TERMS_NOT_IN_FORCE');
    process.env.VITE_LEGAL_DOCS_APPROVED_VERSION = `cgu-citoyen@${version}`;   // the notice is not approved: still refused
    expect((await call(signup, body)).statusCode).toBe(503);
    await after.settleAfterResponse();
    expect(await userOf(mail('d6'))).toBeUndefined();
    process.env.VITE_LEGAL_DOCS_APPROVED_VERSION = `cgu-citoyen@${version},notice-confidentialite@${version}`;
    expect((await call(signup, body)).statusCode).toBe(200);
    await after.settleAfterResponse();
    expect(await userOf(mail('d6'))).toBeTruthy();
  });

  it('D6: purge step 6c deletes never-activated accounts older than 7 days with their ledger rows; keeps verified, recent and held ones', async () => {
    const mkUser = (n, ageDays, verified) => db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "createdAt", "updatedAt", "emailVerifiedAt")
      VALUES (${`v2sec-${n}-${TS}`}, ${mail(`p-${n}`)}, 'x', NOW() - make_interval(days => ${ageDays}), NOW(), ${verified ? sql`NOW()` : null})`);
    await mkUser('old', 8, false); await mkUser('recent', 2, false); await mkUser('verified', 30, true); await mkUser('held', 30, false);
    for (const n of ['old', 'held']) await db.execute(sql`INSERT INTO "ConsentLog" (id, subject_type, subject_id, purpose, decision, policy_version, policy_hash, collection_channel, guardian_involved, proof_level)
      VALUES (${`v2sec-c-${n}-${TS}`}, 'CITIZEN_USER', ${`v2sec-${n}-${TS}`}, 'TERMS_ACCEPTANCE_CGU_CITOYEN', true, 'v', 'h', 'signup', false, 'CONTRACT_ACCEPTANCE')`);
    await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status) VALUES (${`v2sec-hold-${TS}`}, 'CitizenUser', ${`v2sec-held-${TS}`}, 'TEST', 'qa', 'ACTIVE')`);
    const STEPS = ['unverifiedAccountsDeleted'];
    const dry = await purge.runGdprPurge({ policy: approvedTestPolicy({ steps: STEPS }) });
    expect(dry.body.mode).toBe('dry-run');
    const r = await purge.runGdprPurge({ policy: approvedTestPolicy({ steps: STEPS }), env: approvalEnv(STEPS) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.steps.filter((l) => l.decision === 'executed').map((l) => l.id)).toEqual(STEPS);
    const left = (await db.execute(sql`SELECT id FROM "CitizenUser" WHERE id LIKE ${`v2sec-%-${TS}`} ORDER BY id`)).rows.map((x) => x.id);
    expect(left).toEqual([`v2sec-held-${TS}`, `v2sec-recent-${TS}`, `v2sec-verified-${TS}`]);
    const ledger = (await db.execute(sql`SELECT subject_id FROM "ConsentLog" WHERE id LIKE ${`v2sec-c-%-${TS}`}`)).rows.map((x) => x.subject_id);
    expect(ledger).toEqual([`v2sec-held-${TS}`]);
    expect((await purge.runGdprPurge({ policy: approvedTestPolicy({ steps: STEPS }), env: approvalEnv(STEPS) })).body.unverified_accounts_deleted, 'idempotent').toBe(0);
  });
});
