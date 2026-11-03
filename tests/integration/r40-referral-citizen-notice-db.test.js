/**
 * R40 — the person's referral e-mails on REAL PostgreSQL: every notice leaves one AuditLog row (REFERRAL_CITIZEN_NOTICE: referral id, kind, outcome — no
 * address, no text) whose outcome tells the cases apart: PROVIDER_ACCEPTED (a real provider took it, not proof of arrival), TEST_RECORDED (LAB outbox),
 * NOT_DELIVERED (noop mailer or refused — never counted as sent), NO_CONSENT (service e-mails switched off), NO_RECIPIENT (no verified owner), FAILED (error).
 * Before R40 nothing was recorded. Synthetic data only; the mailer is a stub returning the real sendMail() result shapes. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const CIT = `r40-cit-${TS}`; const DOS = `r40-dos-${TS}`; const ORPHAN = `r40-dos-orphan-${TS}`;

describe.skipIf(!hasDatabase)('R40 referral notices to the person (real DB)', () => {
  let db; let referrals; let svc;
  const sent = [];
  const mailer = (result) => async (m) => { sent.push(m); if (result instanceof Error) throw result; return result; };
  const outcomeOf = async (id) => (await db.execute(sql`SELECT details->>'outcome' AS o, details->>'kind' AS k, details::text AS d FROM "AuditLog" WHERE action = 'REFERRAL_CITIZEN_NOTICE' AND entity_id = ${id}`)).rows;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    referrals = await import('../../api/_services/referrals.js');
    svc = await import('../../api/_services/citizen-account.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${CIT}, ${`${CIT}@example.test`}, 'x', NOW(), NOW())`);
    for (const [id, owner] of [[DOS, CIT], [ORPHAN, null]]) {
      await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "rightsSecretHash", "shareTokenHash", "subjectType", "ownerCitizenId")
        VALUES (${id}, NOW() + interval '30 days', '{}'::jsonb, '{}'::jsonb, 0, ${`h-${id}`}, ${`t-${id}`}, 'GUEST_SHARE', ${owner})`);
    }
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action = 'REFERRAL_CITIZEN_NOTICE' AND entity_id LIKE ${`r40-ref-${TS}-%`}`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id IN (${DOS}, ${ORPHAN})`);
    await db.execute(sql`DELETE FROM "NotificationPreference" WHERE "userId" = ${CIT}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${CIT}`);
  });

  it('each outcome is recorded as it is; a noop « accepted » is NOT_DELIVERED, the LAB outbox TEST_RECORDED, never DELIVERED', async () => {
    const cases = [
      ['accepted', DOS, { accepted: true, delivered: true, provider: 'resend', outcome: 'PROVIDER_ACCEPTED' }, 'PROVIDER_ACCEPTED'],
      ['outbox', DOS, { accepted: true, delivered: true, provider: 'test', outcome: 'TEST_RECORDED' }, 'TEST_RECORDED'],
      ['noop', DOS, { accepted: true, delivered: false, provider: 'noop', outcome: 'NOT_SENT' }, 'NOT_DELIVERED'],
      ['refused', DOS, { accepted: true, delivered: false, provider: 'resend', outcome: 'NOT_DELIVERED' }, 'NOT_DELIVERED'],
      ['error', DOS, new Error('provider down'), 'FAILED'],
      ['orphan', ORPHAN, { accepted: true, delivered: true, provider: 'resend', outcome: 'PROVIDER_ACCEPTED' }, 'NO_RECIPIENT'],
    ];
    for (const [name, dossier, result, expected] of cases) {
      const id = `r40-ref-${TS}-${name}`;
      expect(await referrals.tellCitizen(db, { id, sharedDiagnosticId: dossier }, mailer(result), 'Sujet', 'Texte', 'ACCEPTED'), name).toBe(expected);
      const rows = await outcomeOf(id);
      expect(rows, name).toHaveLength(1);
      expect(rows[0]).toMatchObject({ o: expected, k: 'ACCEPTED' });
      expect(rows[0].d, 'no address or text in the ledger').not.toMatch(/example\.test|Texte|Sujet/);
    }
    expect(sent.filter((m) => m.category === 'referral')).toHaveLength(5);   // the orphan dossier is not mailed at all
  });

  it('service e-mails switched off: NO_CONSENT, nothing sent', async () => {
    expect(await svc.setPreference(CIT, { channel: 'email', category: 'service', enabled: false })).toMatchObject({ ok: true });
    const before = sent.length; const id = `r40-ref-${TS}-off`;
    expect(await referrals.tellCitizen(db, { id, sharedDiagnosticId: DOS }, mailer({ outcome: 'PROVIDER_ACCEPTED' }), 'Sujet', 'Texte', 'DECLINED')).toBe('NO_CONSENT');
    expect(sent.length).toBe(before);
    expect((await outcomeOf(id))[0]).toMatchObject({ o: 'NO_CONSENT', k: 'DECLINED' });
  });
});
