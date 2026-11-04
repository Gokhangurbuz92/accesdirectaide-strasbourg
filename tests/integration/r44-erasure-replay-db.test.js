/**
 * R44 / E15 on a REAL PostgreSQL — after a restore, the erasures completed since the backup are replayed through the application's DSR engine
 * (scripts/db-erasure-replay.mjs + api/_services/privacy.js). Simulation on one database: a person erased in the live database is present again "in the
 * restored copy" (re-seeded here); the ledger names them; the replay erases them again, records the erasure request, and a second replay finds nobody.
 * A person under an active legal hold in the restored copy is not erased (counted). Synthetic data, raw SQL (0042 columns).
 */
import { vi } from 'vitest';
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const id = (s) => `r44r-${s}-${TS}`;

describe.skipIf(!hasDatabase)('R44 E15 erasure replay after restore (real DB)', () => {
  let db, pool, replay, privacy;
  const one = async (q) => (await db.execute(q)).rows[0];
  const DOMAINS = ['CitizenSession', 'EligibilitySimulation', 'CitizenAppointment', 'CitizenMessaging', 'OperationalConsent', 'CitizenProfile'];
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    replay = await import('../../scripts/db-erasure-replay.mjs');
    const { createPrivacyRightsService } = await import('../../api/_services/privacy.js');
    privacy = createPrivacyRightsService({ db, cryptoLib: crypto });
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
      VALUES (${id('str')}, 'R44 R', ${'slug-' + id('str')}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${id('svc')}, ${id('str')}, 'S', 30, NOW())`);
    // "the restored copy": two people erased in the live database after the backup are back, with an appointment each; one is under a legal hold here
    for (const who of ['back', 'held']) {
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES (${id(who)}, ${id(who) + '@example.test'}, 'x', NOW())`);
      await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", notes, "citizenUserId", "createdAt", "updatedAt")
        VALUES (${id('apt-' + who)}, ${id('str')}, ${id('svc')}, NOW(), NOW() + interval '30 minutes', 'confirmed', 'Jean Dupont', 'message', ${id(who)}, NOW(), NOW())`);
    }
    await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status, "createdAt") VALUES (${id('lh')}, 'CitizenUser', ${id('held')}, 'R44 TEST', 'test', 'ACTIVE', NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${id('str')}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id LIKE ${'r44r-%-' + TS}`);
    await db.execute(sql`DELETE FROM "LegalHold" WHERE id = ${id('lh')}`);
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE id LIKE ${'r44r-%-' + TS}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE action = 'DSR_DELETE_COMPLETED' AND details::text LIKE ${'%r44r-%'}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${id('svc')}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${id('str')}`);
    await pool?.end();
  });

  it('readErasures exports completed DELETE requests only (ids, dates, domains — no name, no e-mail)', async () => {
    await db.execute(sql`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode", "affectedDomains", "createdAt", "completedAt") VALUES
      (${id('dsr-done')}, 'CITIZEN_USER', ${id('elsewhere')}, 'DELETE', 'COMPLETED', 'HUMAN_REVIEW_REQUIRED', ${JSON.stringify(DOMAINS)}::jsonb, NOW(), NOW()),
      (${id('dsr-open')}, 'CITIZEN_USER', ${id('elsewhere2')}, 'DELETE', 'IN_REVIEW', 'HUMAN_REVIEW_REQUIRED', '[]'::jsonb, NOW(), NULL)`);
    const mine = (await replay.readErasures(pool)).filter((e) => e.requestId.startsWith('r44r-'));
    expect(mine).toEqual([{ requestId: id('dsr-done'), subjectId: id('elsewhere'), completedAt: expect.any(String), domains: DOMAINS }]);
    expect(JSON.stringify(mine)).not.toMatch(/@|Jean/);
  });

  it('dry run inspection, then replay: the person back in the restored copy is erased again, the held one is kept, a second replay finds nobody', async () => {
    const ledger = replay.ledgerOf([
      { requestId: id('dsr-back'), subjectId: id('back'), completedAt: new Date().toISOString(), domains: DOMAINS },
      { requestId: id('dsr-held'), subjectId: id('held'), completedAt: new Date().toISOString(), domains: DOMAINS },
      { requestId: id('dsr-never'), subjectId: id('never-here'), completedAt: new Date().toISOString(), domains: DOMAINS },
    ]);
    const inspected = await replay.inspectTarget(pool, replay.entriesSince(ledger));
    expect(inspected.map((e) => e.present)).toEqual([true, true, false]);
    const recordRequest = (e) => pool.query(replay.recordRequestSql, [e.requestId, e.subjectId, JSON.stringify(e.domains), e.completedAt]);
    const out = await replay.replayErasures({ entries: inspected, privacy, recordRequest });
    expect(out).toEqual({ replayed: 1, absent: 1, blockedLegalHold: 1, noDomains: 0, failed: 0 });
    expect(Number((await one(sql`SELECT count(*)::int AS n FROM "CitizenUser" WHERE id = ${id('back')}`)).n)).toBe(0);
    expect(await one(sql`SELECT "beneficiaryName", notes, "citizenUserId" FROM "ProAppointment" WHERE id = ${id('apt-back')}`)).toEqual({ beneficiaryName: '[anonymisé]', notes: null, citizenUserId: null });
    expect(await one(sql`SELECT status, "reasonCode" FROM "DSRRequest" WHERE id = ${id('dsr-back')}`)).toEqual({ status: 'COMPLETED', reasonCode: 'REPLAYED_AFTER_RESTORE' });
    expect(Number((await one(sql`SELECT count(*)::int AS n FROM "CitizenUser" WHERE id = ${id('held')}`)).n)).toBe(1);   // legal hold in the restored copy
    const again = await replay.replayErasures({ entries: await replay.inspectTarget(pool, replay.entriesSince(ledger)), privacy, recordRequest });
    expect(again).toMatchObject({ replayed: 0, absent: 2, blockedLegalHold: 1, failed: 0 });
  });
});
