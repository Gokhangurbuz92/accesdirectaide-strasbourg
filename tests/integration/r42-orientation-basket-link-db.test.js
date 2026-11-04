/**
 * R42-POLISH (R41 review F7) on REAL PostgreSQL (synthetic data only; skipped without DATABASE_URL): linking an orientation basket to a case uses the
 * same access rule as the case itself (pro-cases listQueue / share-access activeGrantExists):
 *   - a referral grant whose referral is past its expiry (dueAt + 14 days, not yet swept by the cron) does not open the case;
 *   - a dossier whose owner restricted processing (RGPD art. 18, ACTIVE « RESTRICT » DSRRequest) is closed to every organization.
 * Before the fix, linkCase only checked « grant not revoked » + assignment, so both cases below were linkable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const id = (k) => `r42f7-${k}-${TS}`;

describe.skipIf(!hasDatabase)('R42 F7 — orientation basket ↔ case link honours referral expiry and art. 18 restriction (real DB)', () => {
  let db, schema, basket;
  const ctx = { structureId: id('s1'), userId: id('pro-a'), role: 'PRO' };
  let basketId;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    basket = await import('../../api/_services/orientation-basket.js');
    for (const s of ['s1', 's0']) await db.insert(schema.Structure).values({ id: id(s), nom: `Structure synthétique ${s}`, services: [], publics_accueillis: [], categories_aidees: [], statut: 'actif' });
    await db.insert(schema.ProUser).values({ id: id('pro-a'), email: `${id('pro-a')}@example.test`, password_hash: 'synthetic-not-a-hash', role: 'PRO', structureId: id('s1'), status: 'active' });
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES (${id('cit')}, ${`${id('cit')}@example.test`}, 'x', NOW())`);
    for (const k of ['ok', 'ref', 'restr']) {
      await db.insert(schema.SharedDiagnostic).values({ id: id(`d-${k}`), ownerCitizenId: id('cit'), expiresAt: new Date(Date.now() + 30 * 86400000), situation: { synthetic: true }, results: {}, viewCount: 0 });
      await db.execute(sql`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", "grantedVia") VALUES (${id(`g-${k}`)}, ${id(`d-${k}`)}, ${id('s1')}, ${id('pro-a')}, ${k === 'ref' ? 'referral' : 'invite'})`);
      await db.insert(schema.ProCase).values({ id: id(`c-${k}`), sharedDiagnosticId: id(`d-${k}`), structureId: id('s1'), status: 'IN_PROGRESS', assigneeProUserId: id('pro-a') });
    }
    // the referral that gave s1 its grant on d-ref: sent, due 20 days ago (expiry = due + 14 days), not yet swept by the timeout job
    await db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "citizenDecisionAt", "grantId", "dueAt", "updatedAt")
      VALUES (${id('ref')}, ${id('d-ref')}, ${id('s0')}, ${id('s1')}, 'SENT', 'HOUSING', NOW() - interval '25 days', ${id('g-ref')}, NOW() - interval '20 days', NOW())`);
    const created = await basket.createBasket(ctx, { label: 'Synthétique', needCodes: ['LOGEMENT'] });
    basketId = created.basket.id;
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" = ${id('cit')}`);
    await db.delete(schema.ProOrientationBasket).where(eq(schema.ProOrientationBasket.structureId, id('s1')));
    await db.execute(sql`DELETE FROM "Referral" WHERE id = ${id('ref')}`);
    await db.delete(schema.ProCase).where(eq(schema.ProCase.structureId, id('s1')));
    await db.execute(sql`DELETE FROM "SharedDossierGrant" WHERE "structureId" = ${id('s1')}`);
    await db.delete(schema.SharedDiagnostic).where(inArray(schema.SharedDiagnostic.id, ['ok', 'ref', 'restr'].map((k) => id(`d-${k}`))));
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${id('cit')}`);
    await db.delete(schema.ProUser).where(eq(schema.ProUser.structureId, id('s1')));
    await db.delete(schema.Structure).where(inArray(schema.Structure.id, [id('s1'), id('s0')]));
  });

  it('control: a case under a live grant is linkable', async () => {
    expect((await basket.linkCase(basketId, ctx, id('c-ok'))).ok).toBe(true);
  });

  it('a case whose referral grant has lapsed is not linkable (and the link is unchanged)', async () => {
    const out = await basket.linkCase(basketId, ctx, id('c-ref'));
    expect(out.code).toBe('CASE_NOT_AVAILABLE');
    expect((await db.execute(sql`SELECT "caseId" FROM "ProOrientationBasket" WHERE id = ${basketId}`)).rows[0].caseId).toBe(id('c-ok'));
  });

  it('the same referral case is linkable while the referral is still within its expiry window', async () => {
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '1 day' WHERE id = ${id('ref')}`);
    expect((await basket.linkCase(basketId, ctx, id('c-ref'))).ok).toBe(true);
    await db.execute(sql`UPDATE "Referral" SET "dueAt" = NOW() - interval '20 days' WHERE id = ${id('ref')}`);
  });

  it('a case on a dossier under an active art. 18 restriction is not linkable; it is again once the restriction ends', async () => {
    await db.execute(sql`INSERT INTO "DSRRequest" (id, "subjectType", "subjectId", "requestType", status, "executionMode") VALUES (${id('dsr')}, 'CITIZEN_USER', ${id('cit')}, 'RESTRICT', 'ACTIVE', 'SELF_SERVICE')`);
    expect((await basket.linkCase(basketId, ctx, id('c-restr'))).code).toBe('CASE_NOT_AVAILABLE');
    expect((await basket.linkCase(basketId, ctx, id('c-ok'))).code).toBe('CASE_NOT_AVAILABLE');   // same owner: every dossier of the person is closed
    await db.execute(sql`UPDATE "DSRRequest" SET status = 'COMPLETED', "completedAt" = NOW() WHERE id = ${id('dsr')}`);
    expect((await basket.linkCase(basketId, ctx, id('c-restr'))).ok).toBe(true);
  });

  it('unlinking (no case) is always allowed', async () => {
    expect((await basket.linkCase(basketId, ctx, null)).ok).toBe(true);
  });
});
