/**
 * D4 V2 (owner directions 08/11/2026) — REAL PostgreSQL, synthetic data, TEST copy of the policy approved for the audit-log step only:
 *   - an ACTIVE e-mail suppression (HMAC row « mail.suppressed », no later lift) is NOT deleted at 12 months; it is counted by the review report;
 *   - a LIFTED suppression and its lift follow the ordinary 12 months; an ordinary old audit row too;
 *   - the inactive-account report counts from the last sign-in, or from the creation of an account never signed into (it used to skip those).
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { approvedTestPolicy, approvalEnv } from '../helpers/gdpr-purge-approval.js';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const DAY = 86_400_000;
const ago = (d) => new Date(Date.now() - d * DAY);
const A = (k) => `d4sup-${k}-${TS}`;

describe.skipIf(!hasDatabase)('D4 V2 — suppression review and inactive-account anchor (real DB)', () => {
  let db, mod;
  const one = async (q) => (await db.execute(q)).rows[0];
  const audit = (id, action, entityId, when) => db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, entity, entity_id, timestamp) VALUES (${id}, ${action}, 'test', 'MailSuppression', ${entityId}, ${when})`);
  const left = async () => (await db.execute(sql`SELECT id FROM "AuditLog" WHERE id LIKE ${'d4sup-%-' + TS} ORDER BY id`)).rows.map((r) => r.id);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    mod = await import('../../api/_handlers/cron/gdpr-purge.js');
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action = 'GDPR_PURGE_RUN'`);
    await audit(A('active-old'), 'mail.suppressed', `hmac-active-${TS}`, ago(400));
    await audit(A('lifted-old'), 'mail.suppressed', `hmac-lifted-${TS}`, ago(500));
    await audit(A('lift-old'), 'mail.suppression_lifted', `hmac-lifted-${TS}`, ago(450));
    await audit(A('active-recent'), 'mail.suppressed', `hmac-recent-${TS}`, ago(20));
    await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, timestamp) VALUES (${A('ordinary-old')}, 'auth.login', 'test', ${ago(400)})`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "createdAt", "updatedAt", "lastSeenAt") VALUES
      (${A('never')}, ${A('never') + '@example.test'}, 'x', ${ago(800)}, NOW(), NULL),
      (${A('old-login')}, ${A('old-login') + '@example.test'}, 'x', ${ago(900)}, NOW(), ${ago(760)}),
      (${A('active')}, ${A('active') + '@example.test'}, 'x', ${ago(900)}, NOW(), ${ago(3)}),
      (${A('new')}, ${A('new') + '@example.test'}, 'x', ${ago(30)}, NOW(), NULL)`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE id LIKE ${'d4sup-%-' + TS} OR action = 'GDPR_PURGE_RUN'`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id LIKE ${'d4sup-%-' + TS}`);
  });

  it('dry run: one active suppression older than 12 months to review; two inactive accounts (one never signed into)', async () => {
    const r = await mod.runGdprPurge({ policy: approvedTestPolicy({ steps: [] }), env: {} });
    const line = (id) => r.body.steps.find((l) => l.id === id);
    expect(line('mailSuppressionsReview')).toMatchObject({ decision: 'report_only', count: 1, days: 365 });
    expect(line('inactiveAccountsReport')).toMatchObject({ decision: 'report_only', count: 2, days: 730 });
  });

  it('executing the audit-log step keeps the active suppressions, deletes the lifted pair and the ordinary old row', async () => {
    const r = await mod.runGdprPurge({ policy: approvedTestPolicy({ steps: ['deletedAuditCount'] }), env: approvalEnv(['deletedAuditCount']) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.steps.filter((l) => l.decision === 'executed').map((l) => l.id)).toEqual(['deletedAuditCount']);
    expect(await left()).toEqual([A('active-old'), A('active-recent')]);
    expect((await one(sql`SELECT count(*)::int n FROM "CitizenUser" WHERE id LIKE ${'d4sup-%-' + TS}`)).n, 'a report never deletes an account').toBe(4);
  });
});
