/**
 * data·inclusion (D05) in the automatic verification chain, on REAL PostgreSQL, with a synthetic export (the official JSON shape: two top-level arrays) and a
 * synthetic SIRENE — no network:
 *  run 1  a published record (its SIRET) gets the services two producers list for it, each attributed to its producer with its authority (« selon France
 *         Travail », « déclaré par la structure sur DORA »), a service not updated for two years left out, no telephone / e-mail / description of the producers;
 *         the place of another postal code with the same SIRET is another site (not attached); a new place becomes a record only when SIRENE confirms it (open,
 *         same postal code, not a person) — published with registry texts that say other platforms describe its services; a childcare place (monenfant) is
 *         not a new record; the same export again changes nothing (no new version);
 *  run 2  the next export no longer lists one service, nor the new place: the service goes; the place stays (one export missing);
 *  run 3  still missing from a second export: the record that exists because of data·inclusion is withdrawn;
 *  run 4  an export older than the last one used is not used.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const N = String(Date.now()).slice(-6);
/** a SIRET with a valid Luhn key from 13 digits */
const siret = (prefix) => { const b = `${prefix}${N}`.padEnd(13, '0').slice(0, 13); for (let k = 0; k < 10; k += 1) { const d = `${b}${k}`; let s = 0; for (let i = 0; i < 14; i += 1) { let n = Number(d[13 - i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } s += n; } if (s % 10 === 0) return d; } return null; };
const S = { known: siret('91'), fresh: siret('92'), person: siret('93'), closed: siret('94'), childcare: siret('95') };
const KNOWN_ID = `di${N}-known`;

const place = (source, id, { siret: s = null, cp = '67000', insee = '67482', nom = `Lieu ${id} ${N}`, adresse = `${N.slice(-2)} rue des Lilas` } = {}) => ({ source, id: `${source}--${id}${N}`, siret: s, nom, commune: 'Strasbourg', code_postal: cp, code_insee: insee,
  adresse, longitude: 7.75, latitude: 48.58, telephone: '+33388000000', courriel: 'jean.dupont@exemple.fr', site_web: null, description: 'Texte libre du producteur', date_maj: Date.parse('2026-10-01'), lien_source: `https://${source}.example.fr/${id}`, reseaux_porteurs: [] });
const service = (pl, id, { nom = `Service ${id}`, date = '2026-09-15', themes = ['numerique--maitriser-les-fondamentaux-du-numerique'], type = 'accompagnement' } = {}) => ({ source: pl.source, structure_id: pl.id, id: `${pl.id}-${id}`,
  nom, description: 'Description libre', date_maj: Date.parse(date), thematiques: themes, publics: ['tous-publics'], frais: 'gratuit', modes_accueil: ['en-presentiel'], type, contact_nom_prenom: 'Jean Dupont', courriel: 'jean.dupont@exemple.fr',
  telephone: '+33600000000', lien_source: `https://${pl.source}.example.fr/s/${id}`, score_qualite: 0.9, zone_eligibilite: ['67'] });

describe.skipIf(!hasDatabase)('data·inclusion in the automatic verification chain (real DB, synthetic export)', () => {
  let db; let runVeille; let stripReviewFields; let dir; const runs = [];
  const P = {
    dora: place('dora', 'a', { siret: S.known }), ft: place('france-travail', 'b', { siret: S.known }), other: place('dora', 'c', { siret: S.known, cp: '67500', insee: '67180' }),
    fresh: place('dora', 'd', { siret: S.fresh, nom: `ASSOCIATION NUMERIQUE POUR TOUS ${N}`, adresse: '4 rue du Clavier' }), person: place('mediation-numerique', 'e', { siret: S.person, nom: `Conseiller numérique ${N}`, adresse: '6 rue Haute' }),
    closed: place('dora', 'f', { siret: S.closed, nom: `Association fermée ${N}`, adresse: '8 rue Basse' }), childcare: place('monenfant', 'g', { siret: S.childcare, nom: `Crèche ${N}`, adresse: '9 rue des Enfants' }),
    outside: place('dora', 'h', { siret: siret('96'), cp: '75001', insee: '75101' }),
  };
  const SV = {
    doraFresh: service(P.dora, '1', { nom: 'Atelier numérique' }), doraStale: service(P.dora, '2', { nom: 'Ancien atelier', date: '2020-01-01' }),
    ft: service(P.ft, '3', { nom: 'Accompagnement à la recherche d’emploi', themes: ['trouver-un-emploi--repondre-a-des-offres-demploi'] }), other: service(P.other, '4', { nom: 'Service d’un autre site' }),
    fresh: service(P.fresh, '5', { nom: 'Aide aux démarches en ligne', themes: ['numerique--acceder-a-des-services-en-ligne'] }),
    person: service(P.person, '6'), closed: service(P.closed, '7'), childcare: service(P.childcare, '8', { themes: ['famille--garde-denfants-inconnu'] }),
  };
  const exportFiles = (date, places, services) => {
    const s = path.join(dir, `structures-${date}-${runs.length}.json`); const v = path.join(dir, `services-${date}-${runs.length}.json`);
    fs.writeFileSync(s, JSON.stringify(places)); fs.writeFileSync(v, JSON.stringify(services));
    return { date, structures: { file: s, title: `structures-inclusion-${date}.json`, sha1: 'test' }, services: { file: v, title: `services-inclusion-${date}.json`, sha1: 'test' } };
  };
  const unit = (s, { open = true, legal = '9220', cp = '67000', name = 'ASSOCIATION' } = {}) => ({ siren: s.slice(0, 9), nom_complet: name, nature_juridique: legal, etat_administratif: 'A', complements: { est_association: legal === '9220' }, date_mise_a_jour: '2026-09-01',
    matching_etablissements: [{ siret: s, etat_administratif: open ? 'A' : 'F', date_fermeture: open ? null : '2026-06-30', adresse: `4 RUE DU CLAVIER ${cp} STRASBOURG`, code_postal: cp, commune: '67482', libelle_commune: 'STRASBOURG', latitude: '48.58', longitude: '7.75' }] });
  const SIRENE = { [S.known]: unit(S.known, { name: `ASSOCIATION CONNUE ${N}` }), [S.fresh]: unit(S.fresh, { name: `ASSOCIATION NUMERIQUE POUR TOUS ${N}` }), [S.person]: unit(S.person, { legal: '1000', name: 'JEAN DUPONT' }), [S.closed]: unit(S.closed, { open: false }) };
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'recherche-entreprises.api.gouv.fr') { const q = u.searchParams.get('q'); const r = SIRENE[q]; return new Response(JSON.stringify({ results: r ? [r] : [], total_results: r ? 1 : 0 }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    return new Response('not found', { status: 404 });
  };
  const list = (xs) => sql`(${sql.join(xs.map((x) => sql`${x}`), sql`, `)})`;
  const mySirets = new Set(Object.values(S));
  const mine = (kind, r) => kind !== 'structure' || r.id === KNOWN_ID || mySirets.has(r.siret);
  const run = async (files, extra = {}) => { const r = await runVeille({ db, fetchImpl, trigger: 'test', only: ['structure', 'datainclusion'], dataInclusionFiles: files, texts: false, ignorePause: true, force: true, select: mine, ...extra }); runs.push(r.runId); if (process.env.VEILLE_DEBUG) console.log('RUN', JSON.stringify(r)); return r; };
  const bySiret = async (s) => (await db.execute(sql`SELECT * FROM "Structure" WHERE siret = ${s}`)).rows[0];
  const versions = async (id) => Number((await db.execute(sql`SELECT count(*)::int AS n FROM "EntityVersion" WHERE entity_id = ${id}`)).rows[0].n);
  const day1 = () => exportFiles('2026-10-20', Object.values(P), Object.values(SV));

  beforeAll(async () => {
    process.env.ADA_VERIFICATION_MIN_GAP_MS = '0';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ada-di-'));
    ({ db } = await import('../../src/db/index.js'));
    ({ runVeille } = await import('../../api/_services/verification/chain.js'));
    ({ stripReviewFields } = await import('../../api/lib/publicVisibility.js'));
    // the « older than the last export used » rule reads the last data·inclusion run: this suite starts from none (synthetic database)
    await db.execute(sql`DELETE FROM "CronRun" WHERE job = 'veille' AND jsonb_typeof(metrics->'datainclusion') = 'object'`);
    // a record already in the directory and published (its SIRET), with no services listed yet
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, adresse, code_postal, ville, siret, services, publics_accueillis, categories_aidees, statut, verification_status, verified_by, date_verification, territory_verified, launch_eligible,
      data_origin, source_url, "updatedAt", "createdAt")
      VALUES (${KNOWN_ID}, ${`Association connue ${N}`}, ${KNOWN_ID}, '4 rue du Clavier', '67000', 'Strasbourg', ${S.known}, ARRAY[]::text[], ARRAY[]::text[], ARRAY['Accès aux droits'], 'actif', 'VERIFIED', 'ada-veille-automatique', NOW(), true, true,
      'official', ${`https://annuaire-entreprises.data.gouv.fr/etablissement/${S.known}`}, NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    const ids = (await db.execute(sql`SELECT id FROM "Structure" WHERE siret IN ${list(Object.values(S))} OR id = ${KNOWN_ID}`)).rows.map((r) => r.id);
    for (const t of ['ContentVerification', 'EntityVersion']) await db.execute(sql`DELETE FROM ${sql.raw(`"${t}"`)} WHERE ${sql.raw(t === 'EntityVersion' ? 'entity_id' : '"entityId"')} IN ${list(ids)}`).catch(() => {});
    await db.execute(sql`DELETE FROM "VeilleEvent" WHERE run_id IN ${list(runs.filter(Boolean))}`).catch(() => {});
    await db.execute(sql`DELETE FROM "CronRun" WHERE id IN ${list(runs.filter(Boolean))}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN ${list(ids)}`).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('run 1: attributed services on the known record; a new place only when SIRENE confirms it; the same export twice changes nothing', async () => {
    const r = await run(day1());
    expect(r.ok).toBe(true);
    const k = await bySiret(S.known);
    expect(k).toMatchObject({ statut: 'actif', verification_status: 'VERIFIED', publication_hold: null });
    const v = k.services_externes;
    expect(v).toMatchObject({ origin: 'DATA_INCLUSION', export: '2026-10-20', licence: 'Licence Ouverte 2.0', staleServices: 1, createdFromDataInclusion: false });
    expect(v.places.map((p) => p.producer).sort(), 'the site of another postal code is not this place').toEqual(['dora', 'france-travail']);
    expect(v.services.map((s) => [s.nom, s.attribution])).toEqual([['Accompagnement à la recherche d’emploi', 'selon France Travail'], ['Atelier numérique', 'déclaré par la structure sur DORA']]);
    expect(v.services[0]).toMatchObject({ authority: 'OPERATEUR_PUBLIC', type: 'Accompagnement', frais: 'Gratuit', modes: ['En présentiel'], publics: ['Tous publics'], categories: ['Emploi'], updatedAt: '2026-09-15' });
    expect(v.categories).toEqual(['Emploi', 'Numérique']);
    const text = JSON.stringify(v);
    for (const banned of ['jean.dupont', 'Jean Dupont', '+336', '+3388', 'Description libre', 'Texte libre']) expect(text, banned).not.toContain(banned);
    expect(k.telephone, 'no producer telephone').toBeNull();
    // public payload: the services with their attribution, nothing of the run's bookkeeping
    const pub = stripReviewFields(k).services_externes;
    expect(pub.services).toHaveLength(2);
    expect(Object.keys(pub).sort()).toEqual(['dataset', 'export', 'licence', 'services']);
    expect(JSON.stringify(pub)).not.toContain('places');
    const ledger = (await db.execute(sql`SELECT "sourceUrl", "evidenceNote" FROM "ContentVerification" WHERE "entityId" = ${KNOWN_ID} ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
    expect(ledger.sourceUrl, 'the verification stays the registry\'s').toContain('annuaire-entreprises.data.gouv.fr');
    expect(ledger.evidenceNote).toContain('non vérifiés par l’État');

    const f = await bySiret(S.fresh);
    expect(f).toMatchObject({ statut: 'actif', verification_status: 'VERIFIED', publication_hold: null, categories_aidees: ['Numérique'] });
    expect(f.telephone).toBeNull(); expect(f.email).toBeNull();
    expect(f.description_courte).toContain('Le répertoire officiel SIRENE confirme que cet établissement est ouvert');
    expect(f.description_courte).toContain('Des plateformes publiques décrivent certains de ses services');
    expect(f.summary_falc).toContain('D’autres sites disent ce que ce lieu propose.');
    expect(f.services_externes).toMatchObject({ createdFromDataInclusion: true, services: [expect.objectContaining({ nom: 'Aide aux démarches en ligne', attribution: 'déclaré par la structure sur DORA' })] });
    for (const s of [S.person, S.closed, S.childcare]) expect(await bySiret(s), s).toBeUndefined();
    const sum = (await db.execute(sql`SELECT metrics->'datainclusion' AS d FROM "CronRun" WHERE id = ${r.runId}`)).rows[0].d;
    expect(sum).toMatchObject({ version: '2026-10-20', otherSite: 1, created: 1, notGrowth: 1 });
    expect(sum.skipped).toMatchObject({ 'entrepreneur individuel (une personne)': 1, 'établissement fermé selon SIRENE': 1 });

    const before = await versions(KNOWN_ID);
    const again = await run(day1());
    expect(again.ok).toBe(true);
    expect(await versions(KNOWN_ID), 'same export: no new version').toBe(before);
    const sum2 = (await db.execute(sql`SELECT metrics->'datainclusion' AS d FROM "CronRun" WHERE id = ${again.runId}`)).rows[0].d;
    expect(sum2).toMatchObject({ created: 0, changed: 0 });
    expect(sum2.examinedBefore, 'the places examined for this export are not asked to SIRENE again').toBeGreaterThanOrEqual(3);
  });

  it('run 2: a service no longer listed goes; a place missing from one export stays', async () => {
    const r = await run(exportFiles('2026-10-27', [P.dora, P.ft, P.other], [SV.doraFresh, SV.doraStale, SV.other]));
    expect(r.ok).toBe(true);
    const k = await bySiret(S.known);
    expect(k.services_externes.services.map((s) => s.nom)).toEqual(['Atelier numérique']);
    expect(k.services_externes.export).toBe('2026-10-27');
    const f = await bySiret(S.fresh);
    expect(f).toMatchObject({ statut: 'actif', publication_hold: null });
    expect(f.services_externes).toMatchObject({ absentFrom: ['2026-10-27'], services: [] });
  });

  it('run 3: missing from a second export — the record that exists because of data·inclusion is withdrawn', async () => {
    const r = await run(exportFiles('2026-11-03', [P.dora, P.ft], [SV.doraFresh]));
    expect(r.ok).toBe(true);
    const f = await bySiret(S.fresh);
    expect(f.publication_hold).toContain('plus aucun producteur de data·inclusion ne liste ce lieu');
    expect((await bySiret(S.known)).publication_hold, 'a record known from a registry is not withdrawn for that').toBeNull();
  });

  it('run 4: an export older than the last one used is not used', async () => {
    const r = await run(exportFiles('2026-10-01', Object.values(P), Object.values(SV)));
    const why = (await db.execute(sql`SELECT summary FROM "VeilleEvent" WHERE run_id = ${r.runId} AND kind = 'REGISTRY'`)).rows.map((x) => x.summary).join(' ');
    expect(why).toContain('export plus ancien que celui déjà utilisé');
    // unchanged services keep the export they were written from (no new version for a date alone); the older export did not overwrite them
    expect((await bySiret(S.known)).services_externes.export).toBe('2026-10-27');
  });
});
