/**
 * R46 / P27 on REAL PostgreSQL (synthetic data only; skipped without DATABASE_URL): the funder's own headings are saved in the existing jsonb content
 * (no schema change), kept in each version, block « prêt pour validation » while a required one is empty, and appear in the working document.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const BY = `r46-funding-${Date.now().toString(36)}@example.test`;

describe.skipIf(!hasDatabase)('R46 P27 funder headings (real DB)', () => {
  let db, schema, funding;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    funding = await import('../../api/_services/funding-dossiers.js');
  });
  afterAll(async () => {
    const rows = await db.select({ id: schema.FundingDossier.id }).from(schema.FundingDossier).where(eq(schema.FundingDossier.createdBy, BY));
    for (const r of rows) {
      await db.delete(schema.FundingDossierVersion).where(eq(schema.FundingDossierVersion.dossierId, r.id));
      await db.delete(schema.FundingDossier).where(eq(schema.FundingDossier.id, r.id));
    }
  });

  it('saves, versions, blocks and exports the funder headings', async () => {
    const created = await funding.createDossier({ title: 'Dossier synthétique R46', funderName: 'Financeur fictif', deadline: '2099-06-30' }, BY);
    expect(created.ok).toBe(true);
    const d = created.dossier;
    const sections = Object.fromEntries(funding.SECTIONS.map(([k]) => [k, `Texte synthétique ${k}`]));
    const budget = [{ poste: 'Hébergement', nature: 'CHARGE', montant: '120', statut: 'MESURE', justification: 'factures synthétiques' }, { poste: 'Subvention demandée', nature: 'PRODUIT', montant: '120', statut: 'PROVISOIRE' }];
    const withEmpty = await funding.saveDossier(d.id, { version: d.version, content: { ...d.content, sections, budget, rubriques: [{ titre: 'Impact social attendu', texte: '', attendue: true }] }, note: 'rubrique ajoutée' }, BY);
    expect(withEmpty.ok).toBe(true);
    expect(withEmpty.dossier.warnings.filter((w) => w.blocking).map((w) => w.code)).toEqual(['FUNDER_SECTION_EMPTY']);
    expect((await funding.setStatus(d.id, { status: 'PRET_POUR_VALIDATION' }, BY)).code).toBe('NOT_READY');
    const filled = await funding.saveDossier(d.id, { version: withEmpty.dossier.version, content: { ...withEmpty.dossier.content, rubriques: [{ ...withEmpty.dossier.content.rubriques[0], texte: 'Indicateurs synthétiques' }] } }, BY);
    expect(filled.dossier.warnings.filter((w) => w.blocking)).toEqual([]);
    expect((await funding.setStatus(d.id, { status: 'PRET_POUR_VALIDATION' }, BY)).ok).toBe(true);
    const [stored] = await db.select().from(schema.FundingDossier).where(eq(schema.FundingDossier.id, d.id));
    expect(stored.content.rubriques).toEqual([expect.objectContaining({ titre: 'Impact social attendu', texte: 'Indicateurs synthétiques', attendue: true })]);
    const versions = (await db.execute(sql`SELECT version, content->'rubriques' AS r FROM "FundingDossierVersion" WHERE "dossierId" = ${d.id} ORDER BY version`)).rows;
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4]);
    expect(versions[1].r[0].texte).toBe('');
    expect(versions[2].r[0].texte).toBe('Indicateurs synthétiques');
    const md = (await funding.exportDossier(d.id)).markdown;
    expect(md).toContain('### Impact social attendu (attendue)\n\nIndicateurs synthétiques');
  });
});
