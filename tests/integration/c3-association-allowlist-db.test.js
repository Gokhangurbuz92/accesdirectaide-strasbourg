/**
 * C3 — owner decision of 18/11/2026, on REAL PostgreSQL with a double of the DILA archive (no network): the nightly Level 1 path (ADA_VEILLE_NEW_OFFICIAL)
 * publishes the allow-listed « Associations » fiches through the D-5 v2 ledger (official source, VERIFIED decision with the fiche's evidence), before any other
 * candidate; the organisation-side fiches and the Alsace-Moselle fiches of the theme are never created; a fiche already linked to a human-refused or held record
 * is never created again and that record is not touched. Synthetic texts, real fiche numbers. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `c3${Date.now().toString(36)}`;
const SP = (id) => `https://www.service-public.gouv.fr/particuliers/vosdroits/${id}`;
const ASSOC = '<Niveau ID="N31331">Associations, fondations et fonds de dotation</Niveau><Niveau ID="N31332">Associations reconnues représentatives</Niveau>';
const LOGEMENT = '<Niveau ID="N19808">Logement</Niveau><Niveau ID="N20360">Aides personnelles au logement</Niveau>';
const para = (t) => `<Paragraphe>${t}</Paragraphe>`;
const LONG = [
  'Cette fiche officielle explique la situation et les règles qui s’appliquent, avec les personnes concernées et ce qu’elles peuvent faire.',
  'Elle précise les démarches à accomplir, les organismes à contacter et les documents qui peuvent être demandés selon la situation.',
  'Les informations sont publiées par la Direction de l’information légale et administrative et mises à jour lorsque la réglementation change.',
  'Pour toute question, la personne peut s’adresser à l’organisme compétent indiqué dans la fiche ou consulter les textes de référence.',
].map(para).join('');
const fiche = (id, title, path) => `<?xml version="1.0" encoding="UTF-8"?><Publication xmlns:dc="http://purl.org/dc/elements/1.1/" ID="${id}" type="Fiche d'information" dateDerniereModificationImportante="2026-07-01T00:00:00" spUrl="${SP(id)}"><dc:title>${title}</dc:title><dc:description>${title} : ce qu'il faut savoir.</dc:description><dc:subject>Associations</dc:subject><dc:coverage>France entière</dc:coverage><FilDAriane>${path}</FilDAriane><Introduction><Texte>${LONG}</Texte></Introduction><Texte><Chapitre><Titre><Paragraphe>Qui est concerné ?</Paragraphe></Titre>${LONG}</Chapitre></Texte></Publication>`;
// three allow-listed, one allow-listed but already refused by a person, one allow-listed but held, one organisation-side, one Alsace-Moselle, one ordinary
const FICHES = {
  F1218: fiche('F1218', `Association de locataires ${TS}`, ASSOC),
  F1390: fiche('F1390', `Association de parents d'élèves ${TS}`, ASSOC),
  F3175: fiche('F3175', `Cotisations à une association ${TS}`, ASSOC),
  F13091: fiche('F13091', `Association familiale ${TS}`, ASSOC),
  F1126: fiche('F1126', `Association de défense des consommateurs agréée ${TS}`, ASSOC),
  F34326: fiche('F34326', `Organisation d'une course à pied ${TS}`, ASSOC),
  F1119: fiche('F1119', `Déclaration initiale d'une association ${TS}`, ASSOC),
  F9900001: fiche('F9900001', `Aide personnalisée au logement test ${TS}`, LOGEMENT),
};
const zip = () => zipSync(Object.fromEntries([...Object.entries(FICHES).map(([k, v]) => [`${k}.xml`, strToU8(v)]), ['redirections.xml', strToU8('<Redirections><dc:date xmlns:dc="x">2026-11-17T17:02:10</dc:date></Redirections>')]]));
/** a quiet machine (the real probe would see this Mac's native QA and stop the night, as it must) */
const machine = async () => ({ disk: { freeGb: 50 }, memory: { availablePct: 70, swapUsedGb: 1 }, load: { one: 1, cores: 8 }, qa: { running: false } });
const sources = (archive) => async (url) => {
  const u = new URL(url);
  if (u.hostname === 'lecomarquage.service-public.gouv.fr') return new Response(archive, { status: 200, headers: { 'content-type': 'application/zip' } });
  if (u.hostname === 'api-lannuaire.service-public.fr') return Response.json({ total_count: 0, results: [] });
  return new Response('not found', { status: 404 });
};

describe.skipIf(!hasDatabase)('C3 — the nightly path publishes exactly the allow-listed Associations fiches (real DB)', () => {
  let db; let runVeille; let control; const runs = [];
  const REFUSED = `${TS}-refused`; const HELD = `${TS}-held`;
  const created = async (id) => (await db.execute(sql`SELECT 'dispositif' AS k, id, statut, verification_status, auto_check FROM "Dispositif" WHERE source_url = ${SP(id)}
    UNION ALL SELECT 'demarche', id, statut, verification_status, auto_check FROM "Demarche" WHERE source_url = ${SP(id)}
    UNION ALL SELECT 'aide', id, statut, verification_status, auto_check FROM "Aide" WHERE source_url = ${SP(id)}`)).rows;
  // no local model (texts: false): the Level 1 path, as in Production
  const night = async (limit) => { const r = await runVeille({ db, fetchImpl: sources(zip()), generate: null, trigger: 'test', root: process.cwd(), only: ['fiches'], newOfficial: true, texts: false, probe: machine, limits: { newOffices: 0, newFiches: 0, newOfficial: limit } }); if (r.runId) runs.push(r.runId); return r; };

  beforeAll(async () => {
    process.env.ADA_VERIFICATION_MIN_GAP_MS = '0';
    ({ db } = await import('../../src/db/index.js'));
    ({ runVeille } = await import('../../api/_services/verification/chain.js'));
    control = await import('../../api/_services/verification/control.js');
    await control.setPause(db, { paused: false, by: 'test' });
    // a person refused the record of F13091 earlier, and held the record of F1126: neither may come back by the night
    await db.execute(sql`INSERT INTO "Dispositif" (id, titre, slug, public, statut, verification_status, source_url, "updatedAt") VALUES (${REFUSED}, ${`Association familiale (refusée) ${TS}`}, ${REFUSED}, ARRAY[]::text[], 'brouillon', 'REJECTED', ${SP('F13091')}, NOW())`);
    await db.execute(sql`INSERT INTO "Demarche" (id, titre, slug, statut, verification_status, publication_hold, source_url, "updatedAt") VALUES (${HELD}, ${`Consommateurs (retenue) ${TS}`}, ${HELD}, 'brouillon', 'UNVERIFIED', ${'Retenue par une personne : à revoir.'}, ${SP('F1126')}, NOW())`);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    const ids = Object.keys(FICHES).map((id) => SP(id));
    const urls = sql.join(ids.map((u) => sql`${u}`), sql`, `);
    for (const q of [
      sql`DELETE FROM "VeilleEvent" WHERE run_id IN (${sql.join([...runs, '-'].map((r) => sql`${r}`), sql`, `)})`,
      sql`DELETE FROM "CronRun" WHERE id IN (${sql.join([...runs, '-'].map((r) => sql`${r}`), sql`, `)})`,
      sql`DELETE FROM "SourceSnapshot" WHERE final_url IN (${urls})`,
      sql`DELETE FROM "Dispositif" WHERE source_url IN (${urls})`, sql`DELETE FROM "Demarche" WHERE source_url IN (${urls})`, sql`DELETE FROM "Aide" WHERE source_url IN (${urls})`,
    ]) await db.execute(q).catch(() => {});
  });

  it('night 1 (cap 2): the allow-listed fiches come first, ahead of an ordinary fiche with a subdomain; each is published with its D-5 v2 evidence', async () => {
    const r = await night(2);
    expect(r.ok).toBe(true);
    const made = [...(await created('F1218')), ...(await created('F1390')), ...(await created('F3175'))];
    expect(made).toHaveLength(2);   // the cap holds; the third allow-listed fiche waits for the next night
    expect(await created('F9900001')).toHaveLength(0);   // the owner's list is not crowded out by the cap
    for (const m of made) {
      expect(m).toMatchObject({ statut: 'publie', verification_status: 'VERIFIED' });
      expect(m.auto_check).toMatchObject({ origin: 'DILA', sourceId: expect.stringMatching(/^F(1218|1390|3175)$/), classification: { allowList: 'C3', audience: 'particuliers' }, texts: { mode: 'OFFICIAL_SOURCE', falc: 'PENDING' } });
      const [v] = (await db.execute(sql`SELECT outcome, "sourceUrl", "evidenceNote", "territoryConfirmed" FROM "ContentVerification" WHERE "entityId" = ${m.id} ORDER BY "createdAt" DESC LIMIT 1`)).rows;
      expect(v).toMatchObject({ outcome: 'VERIFIED', sourceUrl: SP(m.auto_check.sourceId), territoryConfirmed: true });
      expect(v.evidenceNote).toMatch(new RegExp(`fiche ${m.auto_check.sourceId} `));
      expect(v.evidenceNote).toMatch(/Licence Ouverte 2\.0/);
      expect(v.evidenceNote).toMatch(/décision du propriétaire C3 du 18\/11\/2026/);
    }
    expect(r.counts?.['fiches:pending:THEME_UNMAPPED'] ?? r.metrics?.counts?.['fiches:pending:THEME_UNMAPPED']).toBe(2);   // F34326 and F1119, counted, never placed
  }, 60000);

  it('night 2: the rest of the list, then ordinary candidates; the 24 / 9 never; human decisions untouched', async () => {
    await night(10);
    for (const id of ['F1218', 'F1390', 'F3175']) expect(await created(id), id).toHaveLength(1);
    expect(await created('F9900001')).toHaveLength(1);
    expect(await created('F34326')).toHaveLength(0);   // organisation-side: excluded
    expect(await created('F1119')).toHaveLength(0);    // Alsace-Moselle: held for a named D11 reviewer
    const refused = await created('F13091'); expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ id: REFUSED, statut: 'brouillon', verification_status: 'REJECTED' });
    const held = await created('F1126'); expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ id: HELD, statut: 'brouillon', verification_status: 'UNVERIFIED' });
    expect((await db.execute(sql`SELECT publication_hold FROM "Demarche" WHERE id = ${HELD}`)).rows[0].publication_hold).toBe('Retenue par une personne : à revoir.');
  }, 60000);
});
