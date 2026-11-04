/**
 * R43-MAIL on REAL PostgreSQL (schema of migration 0042, no new table or column): a Mailjet « sent » event moves the citizen notice row written by
 * noticeCitizen() from PROVIDER_ACCEPTED to DELIVERED, a hard bounce to NOT_DELIVERED and records a suppression in AuditLog keyed by an HMAC (never the
 * address), which suppressionReason() finds for that address only. Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const S = `r43-s-${TS}`; const SV = `r43-sv-${TS}`; const A = `r43-a-${TS}`; const U = `r43-u-${TS}`;
const EMAIL = `r43-${TS}@example.test`;

describe.skipIf(!hasDatabase)('R43 Mailjet events against the 0042 schema (real DB)', () => {
  let db; let notices; let events; let hash;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    notices = await import('../../api/_services/appointment-notices.js');
    events = await import('../../api/_services/mail-events.js');
    await db.execute(sql`INSERT INTO "Structure" (id, nom, services, publics_accueillis, categories_aidees, "updatedAt") VALUES (${S}, 'Structure R43', '{}', '{}', '{}', NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SV}, ${S}, 'Accueil', 30, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${U}, ${EMAIL}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", "beneficiaryName", "citizenUserId", "updatedAt")
      VALUES (${A}, ${S}, ${SV}, NOW() + interval '2 days', NOW() + interval '2 days 30 minutes', 'Synthétique', ${U}, NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    if (hash) await db.execute(sql`DELETE FROM "AuditLog" WHERE action = 'mail.suppressed' AND entity_id = ${hash}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${S}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U}`).catch(() => {});
  });

  it('notice row keyed by its CustomID; sent → DELIVERED; hard bounce → NOT_DELIVERED + suppression (no address stored)', async () => {
    let key = null;
    const sendMail = async (m) => { key = m.idempotencyKey; return { outcome: 'PROVIDER_ACCEPTED', accepted: true, delivered: true, provider: 'mailjet' }; };
    expect(await notices.noticeCitizen({ id: A, citizenUserId: U }, 'CANCELLED_BY_STRUCTURE', { subject: 's', text: 't' }, { db, sendMail, canNotify: async () => true })).toBe('PROVIDER_ACCEPTED');
    const noticeId = String(key).split('/')[1];
    const status = async () => (await db.execute(sql`SELECT status FROM "AppointmentNotice" WHERE id = ${noticeId}`)).rows[0]?.status;
    expect(await status()).toBe('PROVIDER_ACCEPTED');

    expect(await events.applyMailjetEvents([{ event: 'sent', CustomID: key, email: EMAIL, MessageID: 1 }], { db })).toMatchObject({ delivered: 1 });
    expect(await status()).toBe('DELIVERED');
    // a repeated « sent » changes nothing
    expect(await events.applyMailjetEvents([{ event: 'sent', CustomID: key, email: EMAIL }], { db })).toMatchObject({ delivered: 0, ignored: 1 });

    expect(await events.applyMailjetEvents([{ event: 'bounce', hard_bounce: true, error_related_to: 'recipient', error: 'user unknown', CustomID: key, email: EMAIL }], { db }))
      .toMatchObject({ notDelivered: 1, suppressed: 1 });
    expect(await status()).toBe('NOT_DELIVERED');

    hash = events.suppressionHash(EMAIL);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const rows = (await db.execute(sql`SELECT entity, entity_id, details, actor FROM "AuditLog" WHERE action = 'mail.suppressed' AND entity_id = ${hash}`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: 'MailSuppression', details: { reason: 'hard_bounce', provider: 'mailjet' }, actor: 'mail-events:mailjet' });
    expect(JSON.stringify(rows)).not.toContain(EMAIL);
    expect(await events.suppressionReason(EMAIL.toUpperCase(), { db })).toBe('hard_bounce');
    expect(await events.suppressionReason(`other-${EMAIL}`, { db })).toBeNull();
  });
});
