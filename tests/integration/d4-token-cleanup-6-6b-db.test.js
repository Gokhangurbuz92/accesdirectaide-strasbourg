/**
 * D4 V2 (owner direction 08/11/2026) — purge steps 6 (`deletedTokensCount`, AuthToken) and 6b (`deletedEmailChangeCount`, EmailChangeRequest) on a REAL
 * PostgreSQL, synthetic data only, with a TEST copy of the policy approved for these two steps only (production code keeps the policy PROPOSED):
 *   - only genuinely expired rows are deleted (used or not); live verification, password-reset and e-mail-change links survive;
 *   - the live links still work after the run (e-mail verification, password reset);
 *   - the administrator (MFA secret, session marker) and every other table are untouched; no other step executes;
 *   - a second run deletes nothing (idempotent); each run writes one GDPR_PURGE_RUN evidence row with the counts only;
 *   - the production policy (not approved) changes nothing even with the same variables.
 * Run: bash $S/r44int.sh <wt> ada_d4tok_test tests/integration/d4-token-cleanup-6-6b-db.test.js
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { approvedTestPolicy, approvalEnv } from '../helpers/gdpr-purge-approval.js';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const MIN = 60_000;
const at = (ms) => new Date(Date.now() + ms);
const U = { id: `d4tok-u-${TS}`, email: `d4tok-${TS}@example.test` };
const ADMIN = { id: `d4tok-adm-${TS}`, email: `d4tok-adm-${TS}@example.test` };
const STEPS = ['deletedTokensCount', 'deletedEmailChangeCount'];
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; },
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; }, end() { return this; }, redirect(c, l) { this.statusCode = c; this.headers.location = l; return this; } });

describe.skipIf(!hasDatabase)('D4 V2 — expired-token cleanup steps 6 and 6b (real DB)', () => {
  let db, mod, ua, raw;
  const one = async (q) => (await db.execute(q)).rows[0];
  const ids = async (table) => (await db.execute(sql.raw(`SELECT id FROM "${table}" WHERE id LIKE 'd4tok-%-${TS}' ORDER BY id`))).rows.map((r) => r.id);
  const adminRow = () => one(sql`SELECT "mfaEnabled", "mfaSecret", "sessionsValidAfter", "failedLoginAttempts" FROM "AdminUser" WHERE id = ${ADMIN.id}`);
  const tableCounts = async () => Object.fromEntries(await Promise.all(['CitizenUser', 'AdminUser', 'ProUser', 'ConsentLog', 'AuditLog', 'DSRRequest', 'CitizenProfile', 'LegalHold']
    .map(async (t) => [t, (await one(sql.raw(`SELECT count(*)::int n FROM "${t}"${t === 'AuditLog' ? ` WHERE action <> 'GDPR_PURGE_RUN'` : ''}`))).n])));
  const run = (policy = approvedTestPolicy({ steps: STEPS })) => mod.runGdprPurge({ policy, env: approvalEnv(STEPS) });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    mod = await import('../../api/_handlers/cron/gdpr-purge.js');
    ua = await import('../../api/_utils/user-auth.js');
    raw = { verify: `d4tok-verify-${TS}`, reset: `d4tok-reset-${TS}` };
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action = 'GDPR_PURGE_RUN'`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "createdAt", "updatedAt") VALUES (${U.id}, ${U.email}, ${await ua.hashPassword('Synthetique-QA-2026x')}, NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, "failedLoginAttempts", "mfaEnabled", "mfaSecret", "mfaIv", "sessionsValidAfter", "updatedAt")
      VALUES (${ADMIN.id}, ${ADMIN.email}, 'x', 0, true, 'enc-secret', 'iv', NOW() - interval '1 hour', NOW())`);
    const tok = (id, type, hash, exp, used = null) => db.execute(sql`INSERT INTO "AuthToken" (id, "userId", type, "tokenHash", "expiresAt", "usedAt") VALUES (${id}, ${U.id}, ${type}, ${hash}, ${exp}, ${used})`);
    await tok(`d4tok-t-expired-verify-${TS}`, 'EMAIL_VERIFY', `h1-${TS}`, at(-60 * MIN));
    await tok(`d4tok-t-expired-used-reset-${TS}`, 'PASSWORD_RESET', `h2-${TS}`, at(-2 * 24 * 60 * MIN), at(-2 * 24 * 60 * MIN + MIN));
    await tok(`d4tok-t-expired-just-${TS}`, 'PASSWORD_RESET', `h3-${TS}`, at(-1000));
    await tok(`d4tok-t-live-verify-${TS}`, 'EMAIL_VERIFY', ua.hashAuthToken(raw.verify), at(10 * MIN));
    await tok(`d4tok-t-live-reset-${TS}`, 'PASSWORD_RESET', ua.hashAuthToken(raw.reset), at(10 * MIN));
    const ecr = (id, hash, exp) => db.execute(sql`INSERT INTO "EmailChangeRequest" (id, "userId", "newEmailEncrypted", "tokenHash", "expiresAt") VALUES (${id}, ${U.id}, 'enc', ${hash}, ${exp})`);
    await ecr(`d4tok-e-expired-${TS}`, `e1-${TS}`, at(-31 * MIN));
    await ecr(`d4tok-e-live-${TS}`, `e2-${TS}`, at(25 * MIN));
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action = 'GDPR_PURGE_RUN'`);
    await db.execute(sql`DELETE FROM "AuthToken" WHERE "userId" = ${U.id}`);
    await db.execute(sql`DELETE FROM "EmailChangeRequest" WHERE "userId" = ${U.id}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor_id = ${U.id}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U.id}`);
    await db.execute(sql`DELETE FROM "AdminUser" WHERE id = ${ADMIN.id}`);
  });

  it('the production policy (not approved) changes nothing, even with the execution variables set', async () => {
    const before = [await ids('AuthToken'), await ids('EmailChangeRequest')];
    const r = await mod.runGdprPurge({ env: approvalEnv(STEPS) });
    expect([r.body.skipped, r.body.reason, r.body.mode]).toEqual([true, 'POLICY_NOT_APPROVED', 'dry-run']);
    expect([await ids('AuthToken'), await ids('EmailChangeRequest')]).toEqual(before);
  });

  it('steps 6 and 6b delete only the expired rows; nothing else runs or changes; the run is logged with counts only', async () => {
    const counts = await tableCounts(); const admin = await adminRow();
    const r = await run();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.mode).toBe('execute');
    const executed = r.body.steps.filter((l) => l.decision === 'executed').map((l) => l.id).sort();
    expect(executed, 'no other step executes').toEqual([...STEPS].sort());
    expect(r.body.tokens_deleted).toBe(3); expect(r.body.email_change_requests_deleted).toBe(1);
    expect(await ids('AuthToken')).toEqual([`d4tok-t-live-reset-${TS}`, `d4tok-t-live-verify-${TS}`]);
    expect(await ids('EmailChangeRequest')).toEqual([`d4tok-e-live-${TS}`]);
    expect(await adminRow(), 'administrator MFA and session marker untouched').toEqual(admin);
    expect(await tableCounts(), 'no other table changes').toEqual(counts);
    const ev = await one(sql`SELECT details FROM "AuditLog" WHERE action = 'GDPR_PURGE_RUN' ORDER BY timestamp DESC LIMIT 1`);
    expect(ev.details.executed).toEqual({ deletedTokensCount: 3, deletedEmailChangeCount: 1 });
    expect(JSON.stringify(ev.details)).not.toMatch(/@|d4tok-t-|h1-/);   // counts and step ids only
  });

  it('a second run deletes nothing (idempotent) and writes its own evidence row', async () => {
    const r = await run();
    expect([r.body.tokens_deleted, r.body.email_change_requests_deleted]).toEqual([0, 0]);
    expect((await one(sql`SELECT count(*)::int n FROM "AuditLog" WHERE action = 'GDPR_PURGE_RUN'`)).n).toBe(2);
  });

  it('the live links still work after the cleanup: e-mail verification, then password reset', async () => {
    const verify = (await import('../../api/_handlers/auth/verify-email.js')).default;
    await verify({ method: 'GET', query: { token: raw.verify }, headers: { host: 'localhost' }, socket: {} }, mk());
    expect((await one(sql`SELECT "emailVerifiedAt" v FROM "CitizenUser" WHERE id = ${U.id}`)).v, 'verified').toBeTruthy();
    const reset = (await import('../../api/_handlers/auth/reset-password.js')).default;
    const before = (await one(sql`SELECT "passwordHash" h FROM "CitizenUser" WHERE id = ${U.id}`)).h;
    const res = mk();
    await reset({ method: 'POST', body: { token: raw.reset, password: 'Nouveau-Synthetique-2026y' }, headers: { host: 'localhost' }, socket: {} }, res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect((await one(sql`SELECT "passwordHash" h FROM "CitizenUser" WHERE id = ${U.id}`)).h).not.toBe(before);
  });
});
