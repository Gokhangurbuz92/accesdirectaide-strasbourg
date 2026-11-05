/**
 * R45 integration — the notifications use the VERIFIED service classification by default (api/_services/appointment-sensitivity.js wired into
 * api/lib/notification-privacy.js): verified ordinary → reduced; unreviewed, sensitive, unknown structure, thin record of an unknown appointment → minimal.
 * Real PostgreSQL, synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const SID = `r45w-s-${TS}`;

describe.skipIf(!hasDatabase)('R45 notification privacy uses the verified classification (real DB)', () => {
  let db, resolveNotificationPrivacy;
  const setValue = (svc, value) => db.execute(sql`UPDATE "Structure" SET settings_json = jsonb_set(coalesce(settings_json, '{}'::jsonb), '{serviceSensitivity}',
    jsonb_build_object('v', 1, 'services', coalesce(settings_json -> 'serviceSensitivity' -> 'services', '{}'::jsonb) || jsonb_build_object(${svc}::text, jsonb_build_object('value', ${value}::text, 'reviewedAt', '2026-11-05T10:00:00.000Z', 'reviewedBy', 'seed@example.test', 'reason', 'Classification fictive'))), true) WHERE id = ${SID}`);
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ resolveNotificationPrivacy } = await import('../../api/lib/notification-privacy.js'));
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${SID}, 'Structure fictive R45 W', ${`r45w-slug-${TS}`}, 'association', '1 rue Fictive', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    await setValue('svc-ord', 'ordinary');
    await setValue('svc-sens', 'sensitive');
  });
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${SID}`); });

  it('verified ordinary → reduced (no injected resolver)', async () => {
    expect(await resolveNotificationPrivacy({ structureId: SID, serviceId: 'svc-ord' })).toEqual({ sensitivity: 'ordinary', level: 'reduced' });
  });
  it('sensitive, unreviewed, unknown structure → minimal', async () => {
    expect((await resolveNotificationPrivacy({ structureId: SID, serviceId: 'svc-sens' })).level).toBe('minimal');
    expect(await resolveNotificationPrivacy({ structureId: SID, serviceId: 'svc-none' })).toEqual({ sensitivity: 'unknown', level: 'minimal' });
    expect((await resolveNotificationPrivacy({ structureId: 'nope', serviceId: 'svc-ord' })).level).toBe('minimal');
  });
  it('thin record of an unknown appointment, or no record → minimal', async () => {
    expect((await resolveNotificationPrivacy({ id: `missing-${TS}`, citizenUserId: 'x' })).level).toBe('minimal');
    expect((await resolveNotificationPrivacy(null)).level).toBe('minimal');
  });
  it('an injected resolver still wins', async () => {
    expect((await resolveNotificationPrivacy({ structureId: SID, serviceId: 'svc-ord' }, { resolveSensitivity: () => 'sensitive' })).level).toBe('minimal');
  });
});
