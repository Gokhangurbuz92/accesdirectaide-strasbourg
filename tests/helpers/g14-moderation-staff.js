/**
 * G14 — the expansion moderation functions refuse while no NAMED person holds the role (fail closed). Integration tests that exercise them seed SYNTHETIC
 * administrator accounts (example.test, MFA flag on, a fixture name) holding the roles, and remove them afterwards:
 *   `email`        MODERATOR + ENTRAIDE_SAFETY_OFFICER (the account the test signs its admin sessions with)
 *   `m2-<email>`   MODERATOR (X03 needs two moderators in rotation)
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

/** a short, valid statement of reasons for the moderation calls of a test (DSA art. 17: facts required) */
export const G14_FACTS = 'FIXTURE : faits de test pour l’exposé des motifs.';

/** @param {any} db @param {string} email */
export async function seedModerationStaff(db, email) {
  const rows = [[email, ['MODERATOR', 'ENTRAIDE_SAFETY_OFFICER']], [`m2-${email}`, ['MODERATOR']]];
  for (const [e, roles] of rows) {
    const id = `g14s-${crypto.randomUUID()}`;
    await db.execute(sql`INSERT INTO "AdminUser" (id, email, password, role, "createdAt", "updatedAt", "failedLoginAttempts", "mfaEnabled", "displayName")
      VALUES (${id}, ${e}, 'x', 'admin', NOW(), NOW(), 0, true, 'Fixture Modération') ON CONFLICT (email) DO UPDATE SET "mfaEnabled" = true, "displayName" = 'Fixture Modération', "disabledAt" = NULL`);
    const [a] = (await db.execute(sql`SELECT id FROM "AdminUser" WHERE email = ${e}`)).rows;
    for (const role of roles) await db.execute(sql`INSERT INTO "ModerationRole" (id, "adminUserId", role, "charterAcknowledgedAt", "assignedBy") VALUES (${crypto.randomUUID()}, ${a.id}, ${role}, NOW(), 'test-fixture')
      ON CONFLICT DO NOTHING`);
  }
}

/** @param {any} db @param {string} email */
export async function clearModerationStaff(db, email) {
  await db.execute(sql`DELETE FROM "ModerationDecision" WHERE "decidedBy" IN (${email}, ${`m2-${email}`})`).catch(() => {});
  await db.execute(sql`DELETE FROM "AdminUser" WHERE email IN (${email}, ${`m2-${email}`})`).catch(() => {});
}
