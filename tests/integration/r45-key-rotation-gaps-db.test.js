/**
 * R45 (sec, AIPD A9) — two gaps of the data-key rotation found while preparing the historical-secret rotation, on REAL PostgreSQL with SYNTHETIC keys and data.
 *   1. The account-free booking contact (ProAppointment.guestEmail / guestPhone, drizzle/0043, v1-sealed) was not re-encrypted: after the old key was retired it
 *      became unreadable although rotationStatus said « safe to retire ». It is now covered when the database has those columns…
 *   2. …and left out on a 0042 database (Production): no query names a 0043 column, the run completes. An unreadable schema counts as a failure (fail closed).
 *   3. The mail suppression list is keyed by an HMAC of ADA_ENCRYPTION_KEY: after promoting a new key, a hard-bounced address was no longer suppressed (it
 *      would be mailed again). Lookups now try every key of the ring; a lift recorded under the new key still wins; once the old key leaves the ring the
 *      pre-rotation suppressions are forgotten (documented consequence in the rotation plan).
 * The suite moves its rows back to the environment key at the end. Skipped without DATABASE_URL. No address or value is logged.
 */
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const ID = (n) => `r45k-${n}-${TS}`;
const A = crypto.randomBytes(32).toString('hex');
const B = crypto.randomBytes(32).toString('hex');
const GUEST_EMAIL = `test.citizen+r45-${TS}@example.test`;
const GUEST_PHONE = '+33600000000';

describe.skipIf(!hasDatabase)('R45 key-rotation gaps (real DB, synthetic keys)', () => {
  let db, c, rot, mail, hasGuest = false; const ORIG = process.env.ADA_ENCRYPTION_KEY; const ORIG_PREV = process.env.ADA_ENCRYPTION_KEY_PREVIOUS;
  const ring = (primary, previous = []) => { process.env.ADA_ENCRYPTION_KEY = primary; process.env.ADA_ENCRYPTION_KEY_PREVIOUS = previous.filter(Boolean).join(','); };
  const dialect = new PgDialect();
  const text = (q) => dialect.sqlToQuery(q).sql;
  /** a database as migrated up to 0042: the information schema has no 0043 column (every other query goes to the real database) */
  const at0042 = (seen) => ({ execute: (q) => { const t = text(q); seen.push(t); return /information_schema\.columns/.test(t) ? Promise.resolve({ rows: [] }) : db.execute(q); } });
  const guestRow = async () => (await db.execute(sql`SELECT "guestEmail" e, "guestPhone" p FROM "ProAppointment" WHERE id = ${ID('apt')}`)).rows[0];

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    c = await import('../../api/lib/crypto.js');
    rot = await import('../../api/_services/key-rotation.js');
    mail = await import('../../api/_services/mail-events.js');
    hasGuest = (await (await import('../../api/_utils/schema-features.js')).appointmentGuestSchema(db)).guestBooking;
    ring(A, [ORIG]);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
      VALUES (${ID('str')}, 'Rotation R45', ${ID('str')}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${ID('svc')}, ${ID('str')}, 'A', 30, NOW())`);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", "beneficiaryName", "updatedAt") VALUES (${ID('apt')}, ${ID('str')}, ${ID('svc')}, NOW() + interval '3 days', NOW() + interval '3 days 30 minutes', ${c.encrypt('Personne fictive')}, NOW())`);
    if (hasGuest) await db.execute(sql`UPDATE "ProAppointment" SET "guestEmail" = ${c.encrypt(GUEST_EMAIL)}, "guestPhone" = ${c.encrypt(GUEST_PHONE)} WHERE id = ${ID('apt')}`);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    try { ring(ORIG, [B, A]); await rot.rewrapAll({ apply: true }); } finally {
      process.env.ADA_ENCRYPTION_KEY = ORIG; if (ORIG_PREV === undefined) delete process.env.ADA_ENCRYPTION_KEY_PREVIOUS; else process.env.ADA_ENCRYPTION_KEY_PREVIOUS = ORIG_PREV;
      for (const q of [sql`DELETE FROM "AuditLog" WHERE actor = ${`mail-events:r45-${TS}`} OR actor = ${`r45-admin-${TS}`}`, sql`DELETE FROM "ProAppointment" WHERE id = ${ID('apt')}`,
        sql`DELETE FROM "ProRdvService" WHERE id = ${ID('svc')}`, sql`DELETE FROM "Structure" WHERE id = ${ID('str')}`]) await db.execute(q).catch(() => {});
    }
  });

  it('1. guest contact (0043 database): counted on the old key, re-encrypted, then readable with the new key alone', async () => {
    expect(hasGuest, 'the helper applies every migration: this database has the 0043 columns').toBe(true);
    ring(B, [A, ORIG]);
    const st = await rot.rotationStatus();
    expect(st.byKind['ProAppointment.guestEmail']?.needing).toBe(1);
    expect(st.byKind['ProAppointment.guestPhone']?.needing).toBe(1);
    expect(st.safeToRetireOldKeys).toBe(false);
    const run = await rot.rewrapAll({ apply: true });
    expect(run.failed).toBe(0);
    expect((await rot.rotationStatus()).safeToRetireOldKeys).toBe(true);
    ring(B, [ORIG]);                                   // A retired
    const row = await guestRow();
    expect(c.decrypt(row.e)).toBe(GUEST_EMAIL);
    expect(c.decrypt(row.p)).toBe(GUEST_PHONE);
  });

  it('2. a 0042 database: no query names a 0043 column and the run completes; an unreadable schema is a failure, never « safe »', async () => {
    ring(A, [B, ORIG]);
    const seen = [];
    const st = await rot.rotationStatus({ db: at0042(seen) });
    expect(seen.some((t) => /guestEmail|guestPhone/.test(t))).toBe(false);
    expect(st.byKind['ProAppointment.guestEmail']).toBeUndefined();
    expect(st.byKind['ProAppointment.beneficiaryName']?.needing).toBe(1);   // the 0042 columns are still covered
    const broken = { execute: (q) => (/information_schema\.columns/.test(text(q)) ? Promise.reject(new Error('schema unreadable')) : db.execute(q)) };
    const bad = await rot.rotationStatus({ db: broken });
    expect(bad.failedToRead).toBeGreaterThanOrEqual(1);
    expect(bad.safeToRetireOldKeys).toBe(false);
    await rot.rewrapAll({ apply: true });             // back to A for the next test
  });

  it('3. mail suppression survives a key rotation while the old key is in the ring; a lift under the new key wins', async () => {
    const before = { ADA_ENCRYPTION_KEY: A };
    const during = { ADA_ENCRYPTION_KEY: B, ADA_ENCRYPTION_KEY_PREVIOUS: A };
    const after = { ADA_ENCRYPTION_KEY: B };
    expect(await mail.recordSuppression(GUEST_EMAIL, 'hard_bounce', `r45-${TS}`, { db, vars: before })).toBe(true);
    expect(await mail.suppressionReason(GUEST_EMAIL, { db, vars: before })).toBe('hard_bounce');
    expect(await mail.suppressionReason(GUEST_EMAIL, { db, vars: during }), 'dual-key window: still suppressed').toBe('hard_bounce');
    expect(mail.suppressionHashes(GUEST_EMAIL, during)).toHaveLength(2);
    expect(mail.suppressionHashes(GUEST_EMAIL, during)[0]).toBe(mail.suppressionHash(GUEST_EMAIL, during));   // writes stay on the primary
    expect(await mail.suppressionReason(GUEST_EMAIL, { db, vars: after }), 'old key retired: the pre-rotation suppression is forgotten').toBeNull();
    const lift = await mail.liftSuppression(GUEST_EMAIL, { reason: 'Boîte de nouveau fonctionnelle (exercice R45)', by: `r45-admin-${TS}` }, { db, vars: during });
    expect(lift).toMatchObject({ ok: true, lifted: true, previous: 'hard_bounce' });
    expect(await mail.suppressionReason(GUEST_EMAIL, { db, vars: during })).toBeNull();
    expect(mail.suppressionHashes('not-an-address', during)).toEqual([]);
    expect(mail.suppressionHashes(GUEST_EMAIL, {})).toEqual([]);
  });
});
