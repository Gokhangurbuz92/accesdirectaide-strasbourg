/**
 * FINESS+ in the automatic verification chain, on REAL PostgreSQL, with synthetic FINESS+ files (the official JSON shape, gzip) — no network:
 *  run 1  only the OPEN establishment of the département of a kind the directory takes becomes a record — published automatically with the register's facts,
 *         the publics of its active activities and texts that say what the register does not establish; a closed one, a pharmacy, an establishment of another
 *         département are not; an establishment already in the directory from the Annuaire (same SIRET) is not added again; a second establishment of the same
 *         place (same SIRET, another FINESS number) is its own record;
 *  run 2  the register closes the establishment: the record is withdrawn with the closing date; the other one is kept;
 *  run 3  the register cannot be read: nothing is withdrawn, retried later; a file older than the one already used is not used;
 *  run 4  a person's refusal after the activation is not published over.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const N = String(Date.now()).slice(-6);
const F = { ehpad: `67Q${N}`, ssiad: `67R${N}`, closed: `67S${N}`, pharma: `67T${N}`, other: `25U${N}`, annuaire: `67V${N}` };
const SIRET = { place: `9${N}0000001`.padEnd(14, '0').slice(0, 14), annuaire: `8${N}0000002`.padEnd(14, '0').slice(0, 14) };
const ANNUAIRE_ID = `fin${N}-annuaire`;

const ege = (num, { cat = '500', state = 'A', closedAt = null, siret = null, cp = '67000', insee = '67482', name = `EHPAD LES TILLEULS ${N}`, street = '3 RUE DES TILLEULS' } = {}) => ({
  informationsGeneralesEGE: { egeId: `e${num}`, dateFermeture: closedAt, dateOuverture: '2001-01-01', nomEgeCourt: name, nomEgeLong: name, numFinessEge: num, siret },
  categorieentiteGeographiqueExercice: cat, adresse: [{ usageAdresse: '03', cogCommune: insee, ligneAcheminement: 'STRASBOURG CEDEX', ligneQuatre: street, codePostal: cp, coordonneesGeographique: { directionLatitude: '48.58', directionLongitude: '7.75' } }],
  contact: [{ typeContact: { roleContact: '01' }, telecom: { telephone: '0388000000', telecopie: null, courriel: 'jean.dupont@exemple.fr' } }], engagement: [], evenement: [], roleEge: [], etatObjet: state, dateDerniereMaj: '2026-09-01 00:00:00' });
const pm = (eges) => ({ informationsGeneralesPMEJ: { pmSmsseId: `p${N}`, numFinessPm: `67P${N}`, denominationLonguePmSmsse: `ASSOCIATION DES TILLEULS ${N}`, siren: SIRET.place.slice(0, 9) }, adresse: [], contact: [], engagement: [], evenement: [], ege: eges, etatObjet: 'A', dateDerniereMaj: '2026-09-01 00:00:00' });
const activity = (public_, state = 'A') => ({ caracteristiquesGeneriques: { activiteAeId: `a${public_}`, etatObjet: state, dateDebutActiviteAutorisee: '2010-01-01', egeId: 'x', typeActiviteSMSSE: '1' },
  nature: { codeNature: 'AMSR', caracteristiquesSpecifiques: { aaSocialeReguleeId: '1', activiteAeId: 'a', typeActiviteAMSR: { activiteSocialeRegulee: '924', modeFonctionnement: '11', public: public_ } } } });

describe.skipIf(!hasDatabase)('FINESS+ in the automatic verification chain (real DB, synthetic register files)', () => {
  let db; let runVeille; let dir; const runs = [];
  const files = (structures, activites, date = '2026-10-25') => {
    const s = path.join(dir, `s-${date}-${runs.length}.json.gz`); const a = path.join(dir, `a-${date}-${runs.length}.json.gz`);
    fs.writeFileSync(s, zlib.gzipSync(JSON.stringify({ schemaVersion: 'v1', generatedAt: `${date}T03:00:00`, pmej: structures, gco: [], gcc: [] })));
    fs.writeFileSync(a, zlib.gzipSync(JSON.stringify({ schemaVersion: 'v1', generatedAt: `${date}T03:00:00`, pmej: activites })));
    return { structures: { file: s, title: `finess-structures-journalier-${date.replace(/-/g, '')}.json.gz`, date, sha1: 'test' }, activites: { file: a, title: 'a', date, sha1: 'test' } };
  };
  const offline = async () => { throw new TypeError('offline'); };
  const list = (xs) => sql`(${sql.join(xs.map((x) => sql`${x}`), sql`, `)})`;
  const mine = (kind, r) => kind !== 'structure' || Object.values(F).includes(r.numero_finess) || r.source_annuaire === ANNUAIRE_ID;
  const run = async (finessFiles, extra = {}) => { const r = await runVeille({ db, fetchImpl: offline, trigger: 'test', only: ['finess', 'structure'], finessFiles, texts: false, ignorePause: true, force: true, select: mine, limits: { newFiness: 50 }, ...extra }); runs.push(r.runId); if (process.env.VEILLE_DEBUG) console.log('RUN', JSON.stringify(r)); return r; };
  const rec = async (num) => (await db.execute(sql`SELECT id, nom, statut, verification_status, publication_hold, siret, numero_finess, telephone, email, adresse, ville, type_structure, categories_aidees, publics_accueillis, description_courte, summary_falc FROM "Structure" WHERE numero_finess = ${num}`)).rows[0];
  const events = async (id) => (await db.execute(sql`SELECT kind, outcome, summary FROM "VeilleEvent" WHERE entity_id = ${id} ORDER BY created_at`)).rows;

  beforeAll(async () => {
    process.env.ADA_VERIFICATION_MIN_GAP_MS = '0';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-finess-'));
    ({ db } = await import('../../src/db/index.js'));
    ({ runVeille } = await import('../../api/_services/verification/chain.js'));
    // the « older than the last file used » rule reads the last FINESS run: this suite starts from none (synthetic database)
    await db.execute(sql`DELETE FROM "CronRun" WHERE job = 'veille' AND jsonb_typeof(metrics->'finess') = 'object'`);
    // the same place already in the directory from the Annuaire (SIRET), verified
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, adresse, code_postal, ville, siret, source_annuaire, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${ANNUAIRE_ID}, ${`PMI Centre ${N}`}, ${ANNUAIRE_ID}, '5 rue de la PMI', '67000', 'Strasbourg', ${SIRET.annuaire}, ${ANNUAIRE_ID}, ARRAY[]::text[], ARRAY[]::text[], ARRAY['Santé et famille'], 'brouillon', 'UNVERIFIED', NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    const ids = (await db.execute(sql`SELECT id FROM "Structure" WHERE numero_finess IN ${list(Object.values(F))} OR id = ${ANNUAIRE_ID}`)).rows.map((r) => r.id);
    for (const t of ['ContentVerification', 'EntityVersion']) await db.execute(sql`DELETE FROM ${sql.raw(`"${t}"`)} WHERE ${sql.raw(t === 'EntityVersion' ? 'entity_id' : '"entityId"')} IN ${list(ids)}`).catch(() => {});
    await db.execute(sql`DELETE FROM "VeilleEvent" WHERE run_id IN ${list(runs.filter(Boolean))}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CronRun" WHERE id IN ${list(runs.filter(Boolean))}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN ${list(ids)}`).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const register = (over = {}) => [pm([
    ege(F.ehpad, { siret: SIRET.place, ...over.ehpad }),
    ege(F.ssiad, { cat: '354', siret: SIRET.place, name: `SSIAD LES TILLEULS ${N}` }),
    ege(F.closed, { state: 'I', closedAt: '2025-12-31', name: `EHPAD FERME ${N}`, street: '9 RUE FERMEE' }),
    ege(F.pharma, { cat: '620', name: `PHARMACIE ${N}`, street: '1 RUE DE LA PHARMACIE' }),
    ege(F.other, { cp: '25000', insee: '25056', name: `EHPAD DOUBS ${N}` }),
    ege(F.annuaire, { cat: '223', siret: SIRET.annuaire, name: `PMI CENTRE ${N}`, street: '5 RUE DE LA PMI' }),
  ])];
  const acts = [{ pmSmsseId: `p${N}`, numFiness: `67P${N}`, ege: [{ egeId: `e${F.ehpad}`, numFinessEge: F.ehpad, activitesExercees: [activity('711'), activity('436'), activity('840', 'I')] }] }];

  it('run 1: only the open establishments of the département in scope become records, published with the register\'s facts and honest texts', async () => {
    const r = await run(files(register(), acts));
    expect(r.ok).toBe(true);
    const e = await rec(F.ehpad);
    expect(e).toMatchObject({ statut: 'actif', verification_status: 'VERIFIED', publication_hold: null, siret: SIRET.place, telephone: '03 88 00 00 00', ville: 'Strasbourg', adresse: '3 rue des Tilleuls',
      type_structure: 'Établissement d’hébergement pour personnes âgées dépendantes (EHPAD)', categories_aidees: ['Personnes âgées'] });
    expect(e.nom).toBe(`EHPAD les Tilleuls ${N}`);
    expect(e.publics_accueillis.sort()).toEqual(['Personnes atteintes de la maladie d’Alzheimer ou d’une maladie apparentée', 'Personnes âgées']);   // the inactive activity's public is not shown
    expect(e.email, 'a person\'s own address is never a public contact').toBeNull();
    expect(e.description_courte).toContain('pas les services qu’il propose ni les conditions pour y être accueilli');
    expect(e.summary_falc).toContain('Appelez avant d’y aller.');
    const ledger = (await db.execute(sql`SELECT outcome, "reviewerId", "reviewerRole", "sourceUrl" FROM "ContentVerification" WHERE "entityId" = ${e.id}`)).rows;
    expect(ledger).toEqual([expect.objectContaining({ outcome: 'VERIFIED', reviewerId: 'ada-veille-automatique', reviewerRole: 'system' })]);
    const s = await rec(F.ssiad);
    expect(s).toMatchObject({ statut: 'actif', type_structure: 'Service de soins infirmiers à domicile (SSIAD)' });
    expect(s.siret, 'the place\'s SIRET is held by one record').toBeNull();
    for (const k of ['closed', 'pharma', 'other', 'annuaire']) expect(await rec(F[k]), k).toBeUndefined();
    expect(r.counts['finess:alreadyListed']).toBe(1);
  });

  it('run 2: the register closes the establishment — withdrawn with the closing date; the other record of the place stays', async () => {
    const r = await run(files(register({ ehpad: { state: 'I', closedAt: '2026-10-20' } }), acts, '2026-10-26'));
    expect(r.ok).toBe(true);
    const e = await rec(F.ehpad);
    expect(e.publication_hold).toContain('fermé selon le répertoire FINESS (fermeture le 20/10/2026)');
    expect((await events(e.id)).map((x) => x.outcome)).toContain('WITHDRAWN');
    expect((await rec(F.ssiad)).publication_hold).toBeNull();
  });

  it('run 3: an unreadable register withdraws nothing; a file older than the last one used is not used', async () => {
    const r = await run({ structures: { file: path.join(dir, 'absent.json.gz'), date: '2026-10-27', sha1: 'x' }, activites: null });
    expect(r.ok).toBe(true);
    const s = await rec(F.ssiad);
    expect(s.publication_hold).toBeNull();
    expect((await events(s.id)).at(-1)).toMatchObject({ outcome: 'RETRY', summary: expect.stringContaining('Répertoire FINESS indisponible') });
    const old = await run(files(register(), acts, '2026-10-01'));
    const why = (await db.execute(sql`SELECT summary FROM "VeilleEvent" WHERE run_id = ${old.runId} AND kind = 'REGISTRY'`)).rows.map((x) => x.summary).join(' ');
    expect(why).toContain('fichier plus ancien que celui déjà utilisé');
    expect((await rec(F.ehpad)).publication_hold, 'the old file does not reopen the closed establishment').toContain('fermé');
  });

  it('run 4: a person\'s refusal recorded after the activation is not published over', async () => {
    const s = await rec(F.ssiad);
    await db.execute(sql`UPDATE "Structure" SET publication_hold = 'Refus : informations à confirmer auprès de l’établissement', verification_status = 'REJECTED' WHERE id = ${s.id}`);
    await db.execute(sql`INSERT INTO "ContentVerification" (id, "entityType", "entityId", outcome, "reviewerId", "reviewerRole", "evidenceNote", "createdAt") VALUES (${`cv-${N}`}, 'structure', ${s.id}, 'REJECTED', 'owner@example.test', 'admin', 'Refusé par une personne', NOW())`);
    await run(files(register(), acts, '2026-10-28'));
    const after = await rec(F.ssiad);
    expect(after.verification_status).toBe('REJECTED');
    expect(after.statut === 'actif' && after.publication_hold === null).toBe(false);
  });
});
