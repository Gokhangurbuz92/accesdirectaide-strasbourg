/**
 * A-14 (art. 15) — the export carries the five account-keyed sections it used to omit, on REAL PostgreSQL, with only the person's own rows and no secret.
 * Two synthetic accounts hold a row in each table; A's export shows A's rows only; endpoint hash, encrypted subscription, token hash, the sealed address and
 * the controller's recovery notes / staff identities never appear.
 */
import nodeCrypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { id: `a14-a-${TS}`, email: `a14-a-${TS}@example.test` }, B = { id: `a14-b-${TS}`, email: `a14-b-${TS}@example.test` };
const STR = `a14-str-${TS}`, SVC = `a14-svc-${TS}`, PRO = `a14-pro-${TS}`;

describe.skipIf(!hasDatabase)('A-14 export: account-keyed sections (real DB)', () => {
  let db, svc, out;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    const { sealText } = await import('../../api/lib/data-keys.js');
    const privacy = await import('../../api/_services/privacy.js');
    svc = privacy.createPrivacyRightsService({ db, cryptoLib: nodeCrypto });
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
      VALUES (${STR}, 'A14 S', ${'a14-slug-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SVC}, ${STR}, 'S', 30, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "updatedAt") VALUES (${PRO}, ${`a14-pro-${TS}@example.test`}, 'x', 'AGENT', 'active', ${STR}, NOW())`);
    for (const u of [A, B]) {
      const k = u === A ? 'a' : 'b';
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
      await db.execute(sql`INSERT INTO "PushSubscription" (id, "userId", "endpointHash", "subscriptionEncrypted", "pushHost", status, "failureCount", "createdAt")
        VALUES (${`a14-push-${k}-${TS}`}, ${u.id}, ${`ENDPOINT-HASH-${k}-${TS}`}, ${`SUBSCRIPTION-SECRET-${k}`}, 'push.example.test', 'ACTIVE', 0, NOW())`);
      const ecr = `a14-ecr-${k}-${TS}`;
      await db.execute(sql`INSERT INTO "EmailChangeRequest" (id, "userId", "newEmailEncrypted", "tokenHash", "expiresAt") VALUES (${ecr}, ${u.id},
        ${sealText(`new-${k}-${TS}@example.test`, { purpose: 'email-change', context: `email-change:${ecr}` })}, ${`TOKEN-HASH-${k}-${TS}`}, NOW() + interval '1 hour')`);
      await db.execute(sql`INSERT INTO "OwnershipRecoveryCase" (id, "citizenUserId", "newEmailEncrypted", "evidenceNote", status, "proposedBy", "proposedAt")
        VALUES (${`a14-orc-${k}-${TS}`}, ${u.id}, 'SEALED-RECOVERY-ADDRESS', ${`EVIDENCE-NOTE-${k}`}, 'PROPOSED', ${`ADMIN-IDENTITY-${k}`}, NOW())`);
      await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "updatedAt") VALUES (${`a14-item-${k}-${TS}`}, ${u.id}, 'MANUAL', 'custom', 'Étape', NOW())`);
      await db.execute(sql`INSERT INTO "ParcoursReminder" ("itemId", threshold, channel, status) VALUES (${`a14-item-${k}-${TS}`}, 'J7', 'email', 'NOT_DELIVERED')`);
      const start = new Date(Date.now() + 86_400_000);
      await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "createdByProUserId", "citizenUserId", "createdAt", "updatedAt")
        VALUES (${`a14-apt-${k}-${TS}`}, ${STR}, ${SVC}, ${start}, ${new Date(start.getTime() + 1_800_000)}, 'confirmed', 'Personne Test', ${PRO}, ${u.id}, NOW(), NOW())`);
      for (const recipient of ['citizen', 'structure']) await db.execute(sql`INSERT INTO "AppointmentNotice" (id, "appointmentId", kind, recipient, channel, status)
        VALUES (${`a14-notice-${k}-${recipient}-${TS}`}, ${`a14-apt-${k}-${TS}`}, 'RESCHEDULED', ${recipient}, 'email', 'NOT_DELIVERED')`);
    }
    out = await svc.getExportData(A.id);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id IN (${`a14-apt-a-${TS}`}, ${`a14-apt-b-${TS}`})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A.id}, ${B.id})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${PRO}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${STR}`);
  });

  it('the export is complete and carries the five sections with the person’s own rows only', () => {
    expect(out.exportInfo.complete).toBe(true);
    expect(out.pushSubscriptions.map((r) => r.id)).toEqual([`a14-push-a-${TS}`]);
    expect(out.pushSubscriptions[0]).toMatchObject({ pushHost: 'push.example.test', status: 'ACTIVE', failureCount: 0 });
    expect(out.emailChangeRequests).toHaveLength(1);
    expect(out.emailChangeRequests[0]).toMatchObject({ id: `a14-ecr-a-${TS}`, requestedEmail: `new-a-${TS}@example.test`, usedAt: null });
    expect(out.ownershipRecoveryCases.map((r) => [r.id, r.status])).toEqual([[`a14-orc-a-${TS}`, 'PROPOSED']]);
    expect(out.parcoursReminders.map((r) => [r.itemId, r.threshold, r.channel, r.status])).toEqual([[`a14-item-a-${TS}`, 'J7', 'email', 'NOT_DELIVERED']]);
    expect(out.appointmentNotices.map((r) => r.id)).toEqual([`a14-notice-a-citizen-${TS}`]);   // the notice sent to the professional is not the person's
  });

  it('no secret, no token hash, no controller note or staff identity, and nothing of the other account', () => {
    const five = JSON.stringify({ p: out.pushSubscriptions, e: out.emailChangeRequests, o: out.ownershipRecoveryCases, r: out.parcoursReminders, n: out.appointmentNotices });
    for (const secret of ['ENDPOINT-HASH', 'SUBSCRIPTION-SECRET', 'TOKEN-HASH', 'SEALED-RECOVERY-ADDRESS', 'EVIDENCE-NOTE', 'ADMIN-IDENTITY', 'endpointHash', 'subscriptionEncrypted', 'tokenHash', 'newEmailEncrypted']) expect(five).not.toContain(secret);
    const all = JSON.stringify(out);
    for (const other of [B.id, `a14-push-b-${TS}`, `a14-ecr-b-${TS}`, `new-b-${TS}`, `a14-orc-b-${TS}`, `a14-item-b-${TS}`, `a14-notice-b-`]) expect(all, other).not.toContain(other);
  });

  it('an account without any such row gets five empty sections (not missing keys)', async () => {
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${`a14-c-${TS}`}, ${`a14-c-${TS}@example.test`}, 'x', NOW(), NOW())`);
    const empty = await svc.getExportData(`a14-c-${TS}`);
    for (const k of ['pushSubscriptions', 'emailChangeRequests', 'ownershipRecoveryCases', 'parcoursReminders', 'appointmentNotices']) expect(empty[k], k).toEqual([]);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${`a14-c-${TS}`}`);
  });
});
