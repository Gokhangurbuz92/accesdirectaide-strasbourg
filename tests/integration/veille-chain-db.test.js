/**
 * Automatic verification chain (owner decision 2026-10-25) on REAL PostgreSQL, with doubles of the official sources (Service-Public archive, Annuaire de
 * l'administration, SIRENE) and of the local model — no network:
 *  run 1  an aide without source finds its Service-Public fiche by itself, gets a normal summary and a FALC version, and is published by the system with the
 *         evidence (ledger row by « ada-veille-automatique », role system); the pasted « Champs actuels pertinents » hold is lifted; a privacy hold is not;
 *         a démarche about that aide takes the same fiche; an association confirmed open by SIRENE is published with the registry's address; two records of
 *         one establishment (same name, same street) are merged (one put aside), a third of the same name in another street is NOT (a name is not an
 *         identity); a public office of the Annuaire is added and published; its site enters the registry of sources;
 *  run 2  a week later: the fiche changed (new amount, new date of important change): the texts are rewritten from it; SIRENE says an establishment closed:
 *         withdrawn;
 *  run 2b the same night, the fiche changed again: the aide is checked at once although verified minutes ago (event-driven refresh) and, without the local
 *         model, withdrawn until its texts are rewritten;
 *  run 3  the fiche was removed from Service-Public: the aide is withdrawn with the reason; SIRENE unreachable: nothing withdrawn, retried later.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `v${Date.now().toString(36)}`;
const ID = { aide: `${TS}-aide`, aideHeld: `${TS}-aide-priv`, dem: `${TS}-dem`, asso: `${TS}-asso`, closing: `${TS}-close`, dupA: `${TS}-dup-a`, dupB: `${TS}-dup-b`, dupC: `${TS}-dup-c` };
const SIRET = { asso: '9' + TS.replace(/\D/g, '').padEnd(13, '1').slice(0, 13), closing: '8' + TS.replace(/\D/g, '').padEnd(13, '2').slice(0, 13), dup: '7' + TS.replace(/\D/g, '').padEnd(13, '3').slice(0, 13) };
const FID = `F9${Date.now().toString().slice(-6)}`;
const TITLE = `Allocation de logement ${TS}`;
const FID2 = `F8${Date.now().toString().slice(-6)}`;

const fiche = (id, title, { date, amount }) => `<?xml version="1.0" encoding="UTF-8"?><Publication xmlns:dc="http://purl.org/dc/elements/1.1/" ID="${id}" type="Fiche d'information conditionnée" dateDerniereModificationImportante="${date}T00:00:00" spUrl="https://www.service-public.gouv.fr/particuliers/vosdroits/${id}"><dc:title>${title}</dc:title><dc:description>Aide au loyer pour les personnes de moins de 30 ans.</dc:description><dc:subject>Logement</dc:subject><dc:coverage>France entière</dc:coverage><FilDAriane><Niveau ID="N19808">Logement</Niveau><Niveau ID="N20360">Aides personnelles au logement</Niveau></FilDAriane><Introduction><Texte><Paragraphe>Vous pouvez recevoir l'${title.toLowerCase()} pour payer votre loyer.</Paragraphe></Texte></Introduction><Texte><Chapitre><Titre><Paragraphe>Conditions</Paragraphe></Titre><Paragraphe>Vous devez avoir moins de 30 ans et des revenus inférieurs à <Valeur>${amount}</Valeur> par an.</Paragraphe></Chapitre><Chapitre><Titre><Paragraphe>Démarche</Paragraphe></Titre><Paragraphe>Faites la demande en ligne.</Paragraphe></Chapitre></Texte></Publication>`;
const zip = (files) => zipSync(Object.fromEntries([...Object.entries(files).map(([k, v]) => [k, strToU8(v)]), ['redirections.xml', strToU8('<Redirections><dc:date xmlns:dc="x">2026-10-24T16:16:33</dc:date></Redirections>')]]));

const etab = (siret, { open = true, name, cp = '67100', address = `12 rue du Test ${cp} Strasbourg` } = {}) => ({ nom_complet: name, etat_administratif: 'A', complements: { est_association: true }, nature_juridique: '9220', date_mise_a_jour: '2026-09-01',
  matching_etablissements: [{ siret, etat_administratif: open ? 'A' : 'F', date_fermeture: open ? null : '2026-10-01', adresse: address, code_postal: cp, commune: '67482', libelle_commune: 'STRASBOURG', latitude: '48.57', longitude: '7.75' }] });
const office = { id: `${TS}-office`, nom: `Caf du Bas-Rhin - Accueil ${TS}`, pivot: '[{"type_service_local": "caf"}]', code_insee_commune: '67482', url_service_public: `https://lannuaire.service-public.gouv.fr/grand-est/bas-rhin/${TS}-office`,
  adresse: '[{"type_adresse": "Adresse", "numero_voie": "22 route de l\'Hôpital", "code_postal": "67100", "nom_commune": "Strasbourg", "latitude": "48.5", "longitude": "7.7"}]',
  telephone: '[{"valeur": "32 30", "description": "Du lundi au vendredi."}]', plage_ouverture: '[{"nom_jour_debut": "Lundi", "nom_jour_fin": "Vendredi", "valeur_heure_debut_1": "08:30:00", "valeur_heure_fin_1": "12:00:00", "commentaire": ""}]',
  site_internet: `[{"valeur": "https://www.accueil-${TS}.fr"}]`, date_modification_datetime: '2026-10-01T08:00:00+00:00' };

/** the official sources of one run */
function sources({ archive, sirene = {}, sireneDown = false }) {
  return async (url) => {
    const u = new URL(url);
    if (u.hostname === 'lecomarquage.service-public.gouv.fr') return archive ? new Response(archive, { status: 200, headers: { 'content-type': 'application/zip' } }) : new Response('', { status: 503 });
    if (u.hostname === 'api-lannuaire.service-public.fr') return Response.json({ total_count: 1, results: [office] });
    if (u.hostname === 'recherche-entreprises.api.gouv.fr') {
      if (sireneDown) throw new TypeError('fetch failed');
      const q = u.searchParams.get('q') || '';
      const hit = Object.entries(sirene).find(([key]) => q === key || q.toLowerCase().includes(key.toLowerCase()));
      return Response.json({ results: hit ? [hit[1]] : [] });
    }
    return new Response('not found', { status: 404 });
  };
}
/** the local model: reads the amount of the fiche it is given, so its texts follow the source */
function model() {
  return async ({ systemInstruction, prompt }) => {
    const amount = (prompt.match(/(\d{2} \d{3}) €/) || [])[1] || '30 000';
    if (/contrôleur qualité/.test(systemInstruction)) { const n = (prompt.match(/^\d+\. /gm) || []).length; return { model: 'double', content: { verdicts: Array.from({ length: n }, (_, i) => ({ n: i + 1, ok: true, raison: 'conforme' })) } }; }
    if (/FALC/.test(systemInstruction)) return { model: 'double', content: { resume: ['Cette aide vous aide à payer votre loyer.', 'Vous devez avoir moins de 30 ans.', `Vous devez gagner moins de ${amount} € par an.`, 'Faites la demande sur internet.'], pour_qui: ['Vous avez moins de 30 ans.'], montant: null, etapes: ['Remplissez la demande sur internet.'] } };
    return { model: 'double', content: { resume: `Cette allocation aide à payer le loyer. Elle s'adresse aux personnes de moins de 30 ans dont les revenus sont inférieurs à ${amount} € par an. La demande se fait en ligne.`, pour_qui: ['Avoir moins de 30 ans', `Avoir des revenus inférieurs à ${amount} € par an`], montant: null, etapes: ['Faire la demande en ligne'], documents: [] } };
  };
}

describe.skipIf(!hasDatabase)('automatic verification chain (real DB, doubles of the sources)', () => {
  let db; let runVeille; const runs = [];
  const mine = (kind, row) => Object.values(ID).includes(row.id);
  const run = async (fetchImpl, extra = {}) => { const r = await runVeille({ db, fetchImpl, generate: model(), trigger: 'test', root: process.cwd(), select: mine, limits: { newOffices: 5, newFiches: 0 }, ...extra }); runs.push(r.runId); if (process.env.VEILLE_DEBUG) console.log('RUN', JSON.stringify(r), JSON.stringify((await db.execute(sql`SELECT kind, outcome, summary FROM "VeilleEvent" WHERE run_id = ${r.runId} AND outcome = 'RETRY'`)).rows)); return r; };
  const row = async (t, id) => (await db.execute(sql`SELECT to_jsonb(x) AS j FROM ${sql.raw(`"${t}"`)} x WHERE id = ${id}`)).rows[0]?.j;
  const ledger = async (id) => (await db.execute(sql`SELECT outcome, "reviewerId", "reviewerRole", "evidenceNote" FROM "ContentVerification" WHERE "entityId" = ${id} ORDER BY "createdAt", id`)).rows;
  const events = async (id) => (await db.execute(sql`SELECT kind, outcome, summary FROM "VeilleEvent" WHERE entity_id = ${id} ORDER BY created_at`)).rows;

  beforeAll(async () => {
    process.env.ADA_VERIFICATION_MIN_GAP_MS = '0';
    ({ db } = await import('../../src/db/index.js'));
    ({ runVeille } = await import('../../api/_services/verification/chain.js'));
    const ins = (t, cols, vals) => db.execute(sql`INSERT INTO ${sql.raw(`"${t}"`)} (${sql.raw(cols.map((c) => `"${c}"`).join(', '))}) VALUES (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`);
    await ins('Aide', ['id', 'titre', 'slug', 'categorie', 'cest_quoi', 'pour_qui', 'statut', 'publication_hold', 'updatedAt'], [ID.aide, TITLE, ID.aide, 'logement', 'Une aide pour le loyer des personnes de moins de 30 ans.', 'Pour les locataires de moins de 30 ans.', 'brouillon', 'Champs actuels pertinents : pour_qui : à vérifier', new Date()]);
    await ins('Aide', ['id', 'titre', 'slug', 'categorie', 'cest_quoi', 'statut', 'publication_hold', 'updatedAt'], [ID.aideHeld, `${TITLE} bis`, ID.aideHeld, 'logement', 'Une aide pour le loyer.', 'brouillon', 'PRIVACY_REVIEW: un numéro personnel', new Date()]);
    await ins('Demarche', ['id', 'titre', 'slug', 'categorie', 'description_courte', 'statut', 'updatedAt'], [ID.dem, `Demande de ${TITLE}`, ID.dem, 'logement', 'Demander l’aide au loyer des personnes de moins de 30 ans.', 'brouillon', new Date()]);
    const st = (id, nom, siret, adresse = '1 rue Fausse') => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, adresse, code_postal, ville, siret, services, publics_accueillis, categories_aidees, statut, "createdAt", "updatedAt")
      VALUES (${id}, ${nom}, ${id}, ${adresse}, '67000', 'Strasbourg', ${siret}, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 'brouillon', NOW() - (${id === ID.dupA ? 2 : 1} || ' minutes')::interval, NOW())`);
    await st(ID.asso, `Association Entraide ${TS}`, SIRET.asso); await st(ID.closing, `Association Fermeture ${TS}`, SIRET.closing);
    await st(ID.dupA, `Association Doublon ${TS}`, SIRET.dup); await st(ID.dupB, `Association Doublon ${TS} - Strasbourg`, null, '12 rue du Test');
    await st(ID.dupC, `Association Doublon ${TS} - Neudorf`, null, '5 rue Autre');
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    const structs = [ID.asso, ID.closing, ID.dupA, ID.dupB, ID.dupC];
    for (const q of [
      sql`DELETE FROM "StructureDuplicateDecision" WHERE "structureA" IN (${sql.join(structs.map((s) => sql`${s}`), sql`, `)}) OR "structureB" IN (${sql.join(structs.map((s) => sql`${s}`), sql`, `)})`,
      sql`DELETE FROM "SourceSnapshot" WHERE entity_id LIKE ${`${TS}%`}`, sql`DELETE FROM "VeilleEvent" WHERE run_id IN (${sql.join(runs.filter(Boolean).map((r) => sql`${r}`), sql`, `)})`,
      sql`DELETE FROM "CronRun" WHERE id IN (${sql.join(runs.filter(Boolean).map((r) => sql`${r}`), sql`, `)})`, sql`DELETE FROM "SourceRegistryEntry" WHERE source_id = ${`annuaire-site:accueil-${TS}.fr`}`,
      sql`DELETE FROM "Aide" WHERE id IN (${ID.aide}, ${ID.aideHeld}) OR "externalId" = ${`dila:${FID2}`}`, sql`DELETE FROM "Demarche" WHERE id = ${ID.dem}`,
      sql`DELETE FROM "SourceSnapshot" WHERE final_url LIKE ${`%${FID2}`}`, sql`DELETE FROM "VeilleEvent" WHERE entity_id = ${FID2}`,
      sql`DELETE FROM "Structure" WHERE id IN (${sql.join(structs.map((s) => sql`${s}`), sql`, `)}) OR source_annuaire = ${office.id}`,
    ]) await db.execute(q).catch(() => {});
  });

  it('run 1: finds, writes, checks and publishes by itself, with the evidence', async () => {
    const archive = zip({ [`${FID}.xml`]: fiche(FID, TITLE, { date: '2026-07-01', amount: '30 000 €' }) });
    const sirene = { [SIRET.asso]: etab(SIRET.asso, { name: `ASSOCIATION ENTRAIDE ${TS}` }), [SIRET.closing]: etab(SIRET.closing, { name: `ASSOCIATION FERMETURE ${TS}` }),
      [SIRET.dup]: etab(SIRET.dup, { name: `ASSOCIATION DOUBLON ${TS}` }), [`Association Doublon ${TS}`]: etab(SIRET.dup, { name: `ASSOCIATION DOUBLON ${TS}`, cp: '67000' }) };
    const r = await run(sources({ archive, sirene }), { forceRegistry: true, only: ['aide', 'demarche', 'structure', 'offices'] });
    expect(r.ok).toBe(true);

    const a = await row('Aide', ID.aide);
    expect(a).toMatchObject({ statut: 'publie', verification_status: 'VERIFIED', verified_by: 'ada-veille-automatique', territory_verified: true, launch_eligible: true, publication_hold: null,
      source_url: `https://www.service-public.gouv.fr/particuliers/vosdroits/${FID}`, falc_origin: 'AI_LOCAL' });
    expect(a.cest_quoi).toMatch(/^Cette allocation aide à payer le loyer/);
    expect(a.summary_falc.split('\n')).toHaveLength(4);
    expect(a.etapes_falc).toEqual(['Remplissez la demande sur internet.']);
    expect(a.auto_check).toMatchObject({ origin: 'DILA', sourceId: FID, importantChangeAt: '2026-07-01' });
    const l = await ledger(ID.aide);
    expect(l.map((x) => x.outcome).sort()).toEqual(['RELEASE_HOLD', 'VERIFIED']);   // one transaction: same time
    expect(l.every((x) => x.reviewerId === 'ada-veille-automatique' && x.reviewerRole === 'system')).toBe(true);
    expect(l.find((x) => x.outcome === 'VERIFIED').evidenceNote).toMatch(new RegExp(`fiche ${FID} .*flux officiel Service-Public`));
    expect((await events(ID.aide)).map((e) => e.outcome)).toContain('PUBLISHED');

    const held = await row('Aide', ID.aideHeld);
    expect(held.publication_hold).toBe('PRIVACY_REVIEW: un numéro personnel');
    expect(held.verification_status).not.toBe('VERIFIED');

    const d = await row('Demarche', ID.dem);
    expect(d).toMatchObject({ statut: 'publie', verification_status: 'VERIFIED', source_url: a.source_url });
    expect(d.conditions_falc).toBe('Vous avez moins de 30 ans.');

    const s = await row('Structure', ID.asso);
    expect(s).toMatchObject({ statut: 'actif', verification_status: 'VERIFIED', code_postal: '67100', adresse: '12 rue du Test' });
    expect(s.source_url).toBe(`https://annuaire-entreprises.data.gouv.fr/etablissement/${SIRET.asso}`);

    const [dupA, dupB, dupC] = [await row('Structure', ID.dupA), await row('Structure', ID.dupB), await row('Structure', ID.dupC)];
    expect([dupA.publication_hold, dupB.publication_hold].filter((h) => String(h || '').startsWith('Doublon (registre des doublons)'))).toHaveLength(1);
    // same name, another street: not identified by the name alone, so neither verified nor merged (France Travail « Seyboth » is not « Pont Matthis »)
    expect(dupC.publication_hold).toBeNull(); expect(dupC.verification_status).not.toBe('VERIFIED'); expect(dupC.siret).toBeNull();

    const created = (await db.execute(sql`SELECT statut, verification_status, verified_by, telephone, horaires FROM "Structure" WHERE source_annuaire = ${office.id}`)).rows;
    expect(created).toEqual([expect.objectContaining({ statut: 'actif', verification_status: 'VERIFIED', verified_by: 'ada-veille-automatique', telephone: '32 30' })]);
    const reg = (await db.execute(sql`SELECT status, level FROM "SourceRegistryEntry" WHERE source_id = ${`annuaire-site:accueil-${TS}.fr`}`)).rows;
    expect(reg).toEqual([{ status: 'ACTIVE', level: 'ORGANISME' }]);
  }, 120000);

  it('run 2: a changed fiche rewrites the texts; a closed establishment is withdrawn', async () => {
    const archive = zip({ [`${FID}.xml`]: fiche(FID, TITLE, { date: '2026-10-20', amount: '35 000 €' }) });
    const sirene = { [SIRET.asso]: etab(SIRET.asso, { name: `ASSOCIATION ENTRAIDE ${TS}` }), [SIRET.closing]: etab(SIRET.closing, { name: `ASSOCIATION FERMETURE ${TS}`, open: false }),
      [SIRET.dup]: etab(SIRET.dup, { name: `ASSOCIATION DOUBLON ${TS}` }) };
    const r = await run(sources({ archive, sirene }), { only: ['aide', 'structure'], force: true });   // a week later: the SIRENE identities are due again
    expect(r.ok).toBe(true);
    const a = await row('Aide', ID.aide);
    expect(a.cest_quoi).toContain('35 000 €');
    expect(a.statut).toBe('publie'); expect(a.publication_hold).toBeNull();
    expect((await events(ID.aide)).map((e) => e.outcome)).toContain('UPDATED');
    const c = await row('Structure', ID.closing);
    expect(c.publication_hold).toMatch(/^Veille automatique : Établissement fermé selon le registre SIRENE/);
  }, 120000);

  it('run 2b (R12): the fiche changed again on a night without the local model: the aide stays online with a verbatim excerpt of the NEW source; the texts written from the older version are removed, never shown as current', async () => {
    const archive = zip({ [`${FID}.xml`]: fiche(FID, TITLE, { date: '2026-10-22', amount: '36 000 €' }) });
    const r = await run(sources({ archive }), { only: ['aide'], texts: false });
    expect(r.ok).toBe(true);
    const a = await row('Aide', ID.aide);
    expect(a.publication_hold).toBeNull(); expect(a.statut).toBe('publie');
    expect(a.cest_quoi).toMatch(/^Extrait de la fiche officielle « .+ » \(Service-Public\.gouv\.fr\) : « /);
    expect(a.cest_quoi).not.toContain('35 000 €');
    expect(a.summary_falc).toBeNull(); expect(a.falc_origin).toBeNull();
    expect(r.alerts.map((x) => x.code)).toContain('TEXTS_WAITING_MODEL');
    const at = a.auto_check.texts.at;
    await run(sources({ archive }), { only: ['aide'], texts: false, force: true });
    expect((await row('Aide', ID.aide)).auto_check.texts, 'the same source: the excerpt is not written again').toMatchObject({ mode: 'OFFICIAL_EXCERPT', at });
  }, 120000);

  it('run 2c: with ADA_VEILLE_TEXT_FALLBACK=withdraw, a source change without the model withdraws the record until its texts are rewritten', async () => {
    const archive = zip({ [`${FID}.xml`]: fiche(FID, TITLE, { date: '2026-10-23', amount: '37 000 €' }) });
    await db.execute(sql`UPDATE "Aide" SET falc_origin = 'AI_LOCAL', auto_check = jsonb_set(auto_check, '{texts}', '{"at": "2026-10-22T03:00:00Z", "sourceMark": "dila:old"}'::jsonb) WHERE id = ${ID.aide}`);
    const r = await run(sources({ archive }), { only: ['aide'], texts: false, env: { ...process.env, ADA_VEILLE_TEXT_FALLBACK: 'withdraw' } });
    expect(r.ok).toBe(true);
    const a = await row('Aide', ID.aide);
    expect(a.publication_hold).toBe('Veille automatique : la fiche officielle a changé : textes à réécrire');
    expect((await events(ID.aide)).map((e) => e.outcome)).toContain('RETRY');
  }, 120000);

  it('run 3: a removed fiche withdraws the aide; an unreachable registry withdraws nothing', async () => {
    const archive = zip({ 'F1.xml': fiche('F1', 'Une autre fiche', { date: '2026-10-20', amount: '1 000 €' }) });
    const before = await row('Structure', ID.asso);
    const r = await run(sources({ archive, sireneDown: true }), { only: ['aide', 'structure'], force: true });
    expect(r.ok).toBe(true);
    const a = await row('Aide', ID.aide);
    expect(a.publication_hold).toMatch(/^Veille automatique : source officielle retirée/);
    expect((await events(ID.aide)).map((e) => e.outcome)).toContain('WITHDRAWN');
    const s = await row('Structure', ID.asso);
    expect(s.publication_hold).toBeNull(); expect(s.verification_status).toBe('VERIFIED'); expect(s.statut).toBe(before.statut);
    expect((await events(ID.asso)).map((e) => e.outcome)).toContain('RETRY');
  }, 120000);

  it('growth: a social fiche of Service-Public not yet in the catalogue becomes a published aide, its texts written and checked, with the evidence', async () => {
    const archive = zip({ [`${FID2}.xml`]: fiche(FID2, `Aide au loyer ${TS}`, { date: '2026-10-21', amount: '30 000 €' }), 'F1.xml': fiche('F1', 'Une autre fiche', { date: '2026-10-20', amount: '1 000 €' }) });
    const r = await run(sources({ archive }), { only: ['fiches'], limits: { newOffices: 0, newFiches: 1 } });
    expect(r.ok).toBe(true);
    const [a] = (await db.execute(sql`SELECT to_jsonb(x) AS j FROM "Aide" x WHERE "externalId" = ${`dila:${FID2}`}`)).rows.map((x) => x.j);
    expect(a).toMatchObject({ titre: `Aide au loyer ${TS}`, statut: 'publie', verification_status: 'VERIFIED', verified_by: 'ada-veille-automatique', categorie: 'logement', falc_origin: 'AI_LOCAL',
      source_url: `https://www.service-public.gouv.fr/particuliers/vosdroits/${FID2}`, data_origin: 'official' });
    expect(a.cest_quoi).toMatch(/^Cette allocation aide à payer le loyer/); expect(Array.isArray(a.documents_necessaires)).toBe(true);
    expect((await ledger(a.id)).map((x) => [x.outcome, x.reviewerRole])).toEqual([['VERIFIED', 'system']]);
    expect((await events(a.id)).map((e) => e.outcome)).toEqual(['CREATED']);
    await db.execute(sql`DELETE FROM "VeilleEvent" WHERE entity_id = ${a.id}`).catch(() => {}); await db.execute(sql`DELETE FROM "SourceSnapshot" WHERE entity_id = ${a.id}`).catch(() => {});
  }, 120000);
});
