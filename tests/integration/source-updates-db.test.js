/**
 * Launch-readiness item 45 on REAL PostgreSQL — an import changing a record (api/_services/source-updates.js, used by the aides / démarches pipeline and the
 * FINESS / RNA directory job):
 *  - the exact prior row is versioned, `statut` and the verification columns are never taken from the import;
 *  - a VERIFIED record whose public content changed is held (« Contenu mis à jour par l’import … ») and is no longer shown as verified, journalised as an
 *    automatic step (role system, SYSTEM_IMPORT — never as an administrator);
 *  - the automatic veille's next VERIFY lifts that hold by itself (D-5 v2: no human review is needed);
 *  - an unverified record is simply updated (versioned, no hold).
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const V = `srcupd-${TS}-verified`;
const U = `srcupd-${TS}-unverified`;
const VEILLE = { id: 'ada-veille-automatique', role: 'system' };

describe.skipIf(!hasDatabase)('source updates (real DB)', () => {
  let db, applySourceUpdate, recordVerification, isEditHold, decide;
  const ins = (id, statut) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, telephone, accessibilite_pmr, services, publics_accueillis,
      categories_aidees, statut, source_url, "updatedAt", "createdAt")
    VALUES (${id}, ${`Accueil ${id}`}, ${id}, 'association', '1 rue de la Source', 'Strasbourg', '67000', '0388000001', false, ARRAY['accueil'], ARRAY['tout_public'], ARRAY['social'],
      ${statut}, 'https://www.service-public.fr/particuliers/vosdroits/F1280', NOW(), NOW())`);
  const row = async (id) => (await db.execute(sql`SELECT statut, telephone, verification_status, publication_hold, launch_eligible, territory_verified, verified_by, date_verification,
      data_origin, source_url, source_url_exact FROM "Structure" WHERE id = ${id}`)).rows[0];
  const verify = (id) => recordVerification({ entityType: 'structure', entityId: id, action: 'VERIFY', reviewer: VEILLE, territoryConfirmed: true,
    sourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F1280', evidenceNote: 'Fiche officielle consultée : adresse et téléphone identiques.' }, { db });

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ applySourceUpdate } = await import('../../api/_services/source-updates.js'));
    ({ recordVerification } = await import('../../api/_services/content-verification.js'));
    ({ isEditHold } = await import('../../api/_services/content-versions.js'));
    ({ decide } = await import('../../api/lib/publicVisibility.js'));
    await ins(V, 'actif'); await ins(U, 'brouillon');
    expect((await verify(V)).ok).toBe(true);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    for (const q of [sql`DELETE FROM "EntityVersion" WHERE entity_id IN (${V}, ${U})`, sql`DELETE FROM "Structure" WHERE id IN (${V}, ${U})`]) await db.execute(q).catch(() => {});
  });

  it('a verified record changed by an import: versioned, statut kept, held and no longer shown as verified', async () => {
    expect(decide(await row(V), 'structure', { mode: 'strict' }).visible).toBe(true);
    const versionsBefore = (await db.execute(sql`SELECT count(*)::int AS n FROM "EntityVersion" WHERE entity_id = ${V}`)).rows[0].n;
    const r = await applySourceUpdate({ kind: 'structure', id: V, source: 'FINESS',
      patch: { telephone: '0388999999', last_sync: new Date(), statut: 'brouillon', verification_status: 'VERIFIED', publication_hold: null } }, db);
    expect(r).toEqual({ ok: true, fields: ['telephone'], held: true });
    const after = await row(V);
    expect(after).toMatchObject({ statut: 'actif', telephone: '0388999999', verification_status: 'VERIFIED' });
    expect(after.publication_hold).toMatch(/^Contenu mis à jour par l’import \(telephone\) : à revérifier/);
    expect(isEditHold(after.publication_hold)).toBe(true);
    expect(decide(after, 'structure', { mode: 'strict' })).toMatchObject({ visible: false, reasons: expect.arrayContaining(['PUBLICATION_HOLD']) });
    const versions = (await db.execute(sql`SELECT reason, actor_email FROM "EntityVersion" WHERE entity_id = ${V} ORDER BY "createdAt" DESC`)).rows;
    expect(versions.length).toBeGreaterThan(versionsBefore);
    expect(versions.some((v) => v.reason === 'before import FINESS (telephone)' && v.actor_email === 'import:FINESS')).toBe(true);
    const [ledger] = (await db.execute(sql`SELECT outcome, "reviewerId", "reviewerRole" FROM "ContentVerification" WHERE "entityId" = ${V} ORDER BY "createdAt" DESC LIMIT 1`)).rows;
    expect(ledger).toEqual({ outcome: 'HOLD', reviewerId: 'import:FINESS', reviewerRole: 'system' });
    const [audit] = (await db.execute(sql`SELECT ip_hash FROM "AuditLog" WHERE entity_id = ${V} AND action = 'CONTENT_HOLD' ORDER BY timestamp DESC LIMIT 1`)).rows;
    expect(audit.ip_hash).toBe('SYSTEM_IMPORT');
  });

  it('the automatic veille lifts that hold by its next VERIFY — no human step', async () => {
    expect((await verify(V)).ok).toBe(true);
    const after = await row(V);
    expect(after.publication_hold).toBeNull();
    expect(decide(after, 'structure', { mode: 'strict' }).visible).toBe(true);
  });

  it('an unverified record is updated and versioned, without a hold; an unchanged public content holds nothing', async () => {
    expect(await applySourceUpdate({ kind: 'structure', id: U, source: 'RNA', patch: { telephone: '0388777777' } }, db)).toEqual({ ok: true, fields: ['telephone'], held: false });
    expect(await row(U)).toMatchObject({ statut: 'brouillon', telephone: '0388777777', publication_hold: null });
    expect(await applySourceUpdate({ kind: 'structure', id: V, source: 'FINESS', patch: { telephone: '0388999999', last_sync: new Date() } }, db)).toEqual({ ok: true, fields: [], held: false });
    expect((await row(V)).publication_hold).toBeNull();
  });
});
