/**
 * Automatic verification chain — hardening after the owner's definitive directive (D-5 v2 confirmed, 2026-10-25), on REAL PostgreSQL with doubles of the official
 * sources, of the local model and of the machine (no network):
 *  - one run at a time; a run whose process died is closed and continued; the owner's pause and stop; no run during a native QA campaign or under the disk
 *    floor; no model texts without free memory;
 *  - a night with many withdrawals is capped; a broken or older archive and an Annuaire outage change nothing; an employee's own e-mail never becomes public;
 *  - a refused verification leaves no half-published content; a bad automatic update is rolled back and the record checked again;
 *  - a site outside its field, an unknown site, a fiche of another territory are not sources; a page missing once is re-read before any withdrawal;
 *  - dispositifs grow and are checked like aides; the registry learns the online services Service-Public cites and visits its sites (moved elsewhere: paused);
 *  - the self-check withdraws what breaks the D-5 v2 contract (no ledger decision, a personal address); the owner's dashboard and a record's history.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = `h${Date.now().toString(36)}`;
const FA = `F7${Date.now().toString().slice(-6)}`; const FB = `F6${Date.now().toString().slice(-6)}`; const FM = `F5${Date.now().toString().slice(-6)}`; const FD = `F4${Date.now().toString().slice(-6)}`;
const ID = { a: `${TS}-a`, b: `${TS}-b`, synth: `${TS}-synth`, mayotte: `${TS}-may`, page: `${TS}-page`, dem: `${TS}-dem`, fake: `${TS}-fake`, bypass: `${TS}-bypass`, st1: `${TS}-st1`, st2: `${TS}-st2`, st3: `${TS}-st3`, priv: `${TS}-priv`, gone: `${TS}-gone`, caps: `${TS}-caps` };
const GONE_SIRET = `4${String(Date.now()).slice(-13)}`.slice(0, 14);
const ONLINE = `service-en-ligne-${TS}.fr`; const OLDSITE = `ancien-site-${TS}.fr`; const NEWSITE = `nouveau-site-${TS}.fr`; const PARIS = `apa-${TS}.paris.fr`; const SITE = `www.mairie-${TS}.fr`;

const fiche = (id, title, { date = '2026-07-01', amount = '30 000 €', coverage = 'France entière', path = '<Niveau ID="N19808">Logement</Niveau><Niveau ID="N20360">Aides personnelles au logement</Niveau>', online = '' } = {}) => `<?xml version="1.0" encoding="UTF-8"?><Publication xmlns:dc="http://purl.org/dc/elements/1.1/" ID="${id}" type="Fiche d'information conditionnée" dateDerniereModificationImportante="${date}T00:00:00" spUrl="https://www.service-public.gouv.fr/particuliers/vosdroits/${id}"><dc:title>${title}</dc:title><dc:description>Aide au loyer pour les personnes de moins de 30 ans.</dc:description><dc:subject>Logement</dc:subject><dc:coverage>${coverage}</dc:coverage><FilDAriane>${path}</FilDAriane><Introduction><Texte><Paragraphe>Vous pouvez recevoir l'${title.toLowerCase()} pour payer votre loyer.</Paragraphe></Texte></Introduction><Texte><Chapitre><Titre><Paragraphe>Conditions</Paragraphe></Titre><Paragraphe>Vous devez avoir moins de 30 ans et des revenus inférieurs à <Valeur>${amount}</Valeur> par an.</Paragraphe></Chapitre><Chapitre><Titre><Paragraphe>Démarche</Paragraphe></Titre><Paragraphe>Faites la demande en ligne.</Paragraphe>${online}</Chapitre></Texte></Publication>`;
const zip = (files, builtAt = '2026-10-24T16:16:33') => zipSync(Object.fromEntries([...Object.entries(files).map(([k, v]) => [k, strToU8(v)]), ['redirections.xml', strToU8(`<Redirections><dc:date xmlns:dc="x">${builtAt}</dc:date></Redirections>`)]]));
const office = { id: `${TS}-office`, nom: `Caf du Bas-Rhin - Accueil ${TS}`, pivot: '[{"type_service_local": "caf"}]', code_insee_commune: '67482', url_service_public: `https://lannuaire.service-public.gouv.fr/grand-est/bas-rhin/${TS}-office`,
  adresse: '[{"type_adresse": "Adresse", "numero_voie": "22 route de l\'Hôpital", "code_postal": "67100", "nom_commune": "Strasbourg", "latitude": "48.5", "longitude": "7.7"}]',
  telephone: '[{"valeur": "32 30", "description": "Du lundi au vendredi."}]', adresse_courriel: 'accueil@caf-test.fr', site_internet: `[{"valeur": "https://${SITE}"}]`, date_modification_datetime: '2026-10-01T08:00:00+00:00' };
const office2 = { ...office, id: `${TS}-office2`, nom: `CCAS de Testville ${TS}`, pivot: '[{"type_service_local": "ccas"}]', url_service_public: `https://lannuaire.service-public.gouv.fr/grand-est/bas-rhin/${TS}-office2`, adresse_courriel: 'paul.durand@testville.fr', site_internet: '[]' };
const PAGE = (title, amount) => `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>Cette aide de la Caf aide les personnes de moins de 30 ans à partir en vacances. Elle est versée quand les revenus sont inférieurs à ${amount} par an.</p><p>Faites la demande en ligne.</p></main></body></html>`;

/** the official sources of one run */
function sources({ archive, annuaire = 'ok', page = {}, sirene = {}, onSirene = null, review = {} } = {}) {
  return async (url) => {
    const u = new URL(url);
    if (u.hostname === 'lecomarquage.service-public.gouv.fr') return archive ? new Response(archive, { status: 200, headers: { 'content-type': 'application/zip' } }) : new Response('', { status: 503 });
    if (u.hostname === 'api-lannuaire.service-public.fr') return annuaire === 'ok' ? Response.json({ total_count: 2, results: [office, office2] }) : new Response('', { status: 503 });
    if (u.hostname === 'recherche-entreprises.api.gouv.fr') {
      if (onSirene) onSirene();
      const q = u.searchParams.get('q') || ''; const hit = sirene[q];
      return Response.json({ results: hit ? [hit] : [] });
    }
    if (review[url] || review[`${u.protocol}//${u.host}`]) { const r = review[url] || review[`${u.protocol}//${u.host}`]; return new Response(r.body || '<html></html>', { status: r.status, headers: r.location ? { location: r.location } : { 'content-type': 'text/html' } }); }
    if (page[url]) return new Response(page[url].body, { status: page[url].status || 200, headers: { 'content-type': 'text/html' } });
    return new Response('not found', { status: 404 });
  };
}
/** the local model: follows the amount of what it reads */
function model(calls = { n: 0 }) {
  return async ({ systemInstruction, prompt }) => {
    calls.n += 1;
    const amount = (prompt.match(/(\d{2} \d{3}) €/) || [])[1] || (prompt.match(/inférieur à (\d+)/) || [])[1] || '30 000';
    const euro = /\d{2} \d{3}/.test(amount) ? `${amount} €` : amount;
    if (/contrôleur qualité/.test(systemInstruction)) { const n = (prompt.match(/^\d+\. /gm) || []).length; return { model: 'double', content: { verdicts: Array.from({ length: n }, (_, i) => ({ n: i + 1, ok: true, raison: 'conforme' })) } }; }
    if (/FALC/.test(systemInstruction)) return { model: 'double', content: { resume: ['Cette aide vous aide à payer.', 'Vous devez avoir moins de 30 ans.', `Vos revenus sont sous ${euro}.`, 'Faites la demande sur internet.'], pour_qui: ['Vous avez moins de 30 ans.'], montant: null, etapes: ['Remplissez la demande sur internet.'] } };
    return { model: 'double', content: { resume: `Cette aide s'adresse aux personnes de moins de 30 ans dont les revenus sont inférieurs à ${euro}. La demande se fait en ligne.`, pour_qui: ['Avoir moins de 30 ans', `Avoir des revenus inférieurs à ${euro}`], montant: null, etapes: ['Faire la demande en ligne'], documents: [] } };
  };
}
const machine = (x = {}) => async () => ({ disk: { freeGb: 50 }, memory: { availablePct: 70, swapUsedGb: 1 }, load: { one: 1, cores: 8 }, qa: { running: false }, ...x });

describe.skipIf(!hasDatabase)('automatic verification chain — hardening (real DB)', () => {
  let db; let runVeille; let control; let rollbackTo; let veilleDigest; let recordHistory; let reviewSources;
  const runs = []; const mine = (kind, row) => Object.values(ID).includes(row.id) || String(row.source_annuaire || '').startsWith(TS) || String(row.titre || '').includes(TS);
  const run = async (fetchImpl, extra = {}) => { const r = await runVeille({ db, fetchImpl, generate: model(), trigger: 'test', root: process.cwd(), select: mine, limits: { newOffices: 0, newFiches: 0 }, ...extra }); if (r.runId) runs.push(r.runId); return r; };
  const row = async (t, id) => (await db.execute(sql`SELECT to_jsonb(x) AS j FROM ${sql.raw(`"${t}"`)} x WHERE id = ${id}`)).rows[0]?.j;
  const events = async (id) => (await db.execute(sql`SELECT kind, outcome, summary, details FROM "VeilleEvent" WHERE entity_id = ${id} ORDER BY created_at`)).rows;
  const ledger = async (id) => (await db.execute(sql`SELECT outcome, "reviewerId", "reviewerRole" FROM "ContentVerification" WHERE "entityId" = ${id} ORDER BY "createdAt", id`)).rows;
  const ins = (t, cols, vals) => db.execute(sql`INSERT INTO ${sql.raw(`"${t}"`)} (${sql.raw(cols.map((c) => `"${c}"`).join(', '))}) VALUES (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`);
  const extraRuns = [];
  const ARCH = () => zip({ [`${FA}.xml`]: fiche(FA, `Allocation test A ${TS}`), [`${FB}.xml`]: fiche(FB, `Allocation test B ${TS}`), [`${FM}.xml`]: fiche(FM, `Allocation outre-mer ${TS}`, { coverage: 'Mayotte' }) });

  beforeAll(async () => {
    process.env.ADA_VERIFICATION_MIN_GAP_MS = '0';
    ({ db } = await import('../../src/db/index.js'));
    ({ runVeille } = await import('../../api/_services/verification/chain.js'));
    control = await import('../../api/_services/verification/control.js');
    ({ rollbackTo } = await import('../../api/_services/content-versions.js'));
    ({ veilleDigest, recordHistory } = await import('../../api/_services/verification/digest.js'));
    ({ reviewSources } = await import('../../api/_services/verification/sources.js'));
    await control.setPause(db, { paused: false, by: 'test' });
    const aide = (id, titre, url, extra = {}) => ins('Aide', ['id', 'titre', 'slug', 'categorie', 'cest_quoi', 'statut', 'source_url', ...Object.keys(extra), 'updatedAt'], [id, titre, id, 'logement', 'Une aide pour le loyer des personnes de moins de 30 ans.', 'brouillon', url, ...Object.values(extra), new Date()]);
    await aide(ID.a, `Allocation test A ${TS}`, `https://www.service-public.gouv.fr/particuliers/vosdroits/${FA}`);
    await aide(ID.b, `Allocation test B ${TS}`, `https://www.service-public.gouv.fr/particuliers/vosdroits/${FB}`);
    await aide(ID.synth, `Allocation synthétique ${TS}`, `https://www.service-public.gouv.fr/particuliers/vosdroits/${FA}`, { data_origin: 'synthetic_fixture' });
    await aide(ID.mayotte, `Allocation outre-mer ${TS}`, `https://www.service-public.gouv.fr/particuliers/vosdroits/${FM}`);
    await aide(ID.page, `Aide aux vacances test ${TS}`, `https://www.caf.fr/vacances-${TS}`);
    await aide(ID.fake, `Aide imitée ${TS}`, 'https://www.service-public-gouv.info/aide');
    await ins('Demarche', ['id', 'titre', 'slug', 'categorie', 'description_courte', 'statut', 'source_url', 'updatedAt'], [ID.dem, `Saisir le Défenseur ${TS}`, ID.dem, 'justice', 'Saisir le Défenseur des droits.', 'brouillon', `https://www.defenseurdesdroits.fr/saisir-${TS}`, new Date()]);
    const st = (id, nom, extra = {}) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, adresse, code_postal, ville, email, source_annuaire, siret, services, publics_accueillis, categories_aidees, statut, "updatedAt")
      VALUES (${id}, ${nom}, ${id}, ${extra.adresse || '22 route de l\'Hôpital'}, ${extra.cp || '67100'}, 'Strasbourg', ${extra.email || null}, ${extra.annuaire || null}, ${extra.siret || null}, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 'brouillon', NOW())`);
    await st(ID.priv, `Caisse d'allocations familiales du Bas-Rhin ${TS}`, { email: 'camille.exemple@caf67.caf.fr', annuaire: office.id });
    for (const [i, id] of [ID.st1, ID.st2, ID.st3].entries()) await st(id, `Association Stop ${i} ${TS}`, { siret: `5${String(Date.now()).slice(-8)}${i}0000`.slice(0, 14), adresse: '12 rue du Test', cp: '67100' });
    await st(ID.gone, `Agence France Travail Strasbourg Disparue ${TS}`, { siret: GONE_SIRET, adresse: '8 rue Adolphe Seyboth', cp: '67000' });
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await control.setPause(db, { paused: false, by: 'test' }).catch(() => {});
    const ids = [...Object.values(ID)];
    const all = sql.join(ids.map((x) => sql`${x}`), sql`, `);
    for (const q of [
      sql`DELETE FROM "VeilleEvent" WHERE run_id IN (${sql.join([...runs, '-'].map((r) => sql`${r}`), sql`, `)}) OR entity_id IN (${all})`,
      sql`DELETE FROM "CronRun" WHERE id IN (${sql.join([...runs, ...extraRuns, '-'].map((r) => sql`${r}`), sql`, `)})`, sql`DELETE FROM "CronRun" WHERE job = 'veille-pause' AND trigger = 'test'`,
      sql`DELETE FROM "CronRun" WHERE job = 'veille' AND status = 'skipped' AND trigger = 'test'`,
      sql`DELETE FROM "SourceSnapshot" WHERE entity_id IN (${all}) OR final_url LIKE ${`%${TS}%`} OR final_url LIKE ${`%${FD}`}`,
      sql`DELETE FROM "SourceRegistryEntry" WHERE source_id IN (${`dila-online:${ONLINE}`}, ${`annuaire-site:${SITE.replace(/^www\./, '')}`}, ${`annuaire-site:${OLDSITE}`}, ${`qa-successor-${TS}`})`,
      sql`DELETE FROM "Aide" WHERE id IN (${all})`, sql`DELETE FROM "Demarche" WHERE id IN (${all})`, sql`DELETE FROM "Dispositif" WHERE titre LIKE ${`%${TS}%`}`,
      sql`DELETE FROM "Structure" WHERE id IN (${all}) OR source_annuaire LIKE ${`${TS}%`}`,
    ]) await db.execute(q).catch(() => {});
  });

  it('one run at a time: a second start while one runs is refused; a run whose process died is closed as interrupted and continued', async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const slow = async (url) => { if (new URL(url).hostname === 'api-lannuaire.service-public.fr') await gate; return sources({ archive: ARCH() })(url); };
    const first = runVeille({ db, fetchImpl: slow, generate: model(), trigger: 'test', select: mine, only: [] });
    for (let i = 0; i < 50 && !(await db.execute(sql`SELECT 1 FROM "CronRun" WHERE job = 'veille' AND status = 'running' AND trigger = 'test'`)).rows.length; i += 1) await new Promise((r) => setTimeout(r, 20));
    const second = await runVeille({ db, fetchImpl: sources({ archive: ARCH() }), generate: model(), trigger: 'test', select: mine, only: [] });
    expect(second).toMatchObject({ ok: false, skipped: 'ALREADY_RUNNING' });
    release(); const r1 = await first; runs.push(r1.runId);
    expect(r1.ok).toBe(true);
    const [dead] = (await db.execute(sql`INSERT INTO "CronRun" (id, job, status, trigger, "startedAt", "updatedAt") VALUES (gen_random_uuid()::text, 'veille', 'running', 'test',
      (now() AT TIME ZONE 'UTC') - interval '40 minutes', (now() AT TIME ZONE 'UTC') - interval '30 minutes') RETURNING id`)).rows;
    extraRuns.push(dead.id);
    const r2 = await run(sources({ archive: ARCH() }), { only: [] });
    expect(r2.ok).toBe(true);
    expect((await db.execute(sql`SELECT status FROM "CronRun" WHERE id = ${dead.id}`)).rows[0].status).toBe('interrupted');
  }, 60000);

  it('the owner’s pause: no run starts (written once), the run in progress stops; resumed, the veille runs again', async () => {
    await control.setPause(db, { paused: true, by: 'test', reason: 'essai' });
    const r1 = await run(sources({ archive: ARCH() }), { only: [] }); const r2 = await run(sources({ archive: ARCH() }), { only: [] });
    expect(r1).toMatchObject({ ok: false, skipped: 'PAUSED' }); expect(r2).toMatchObject({ ok: false, skipped: 'PAUSED' });
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "CronRun" WHERE job = 'veille' AND status = 'skipped' AND "skipReason" = 'PAUSED' AND "startedAt" > (now() AT TIME ZONE 'UTC') - interval '5 minutes'`)).rows[0].n).toBe(1);
    await control.setPause(db, { paused: false, by: 'test' });
    expect((await run(sources({ archive: ARCH() }), { only: [] })).ok).toBe(true);
  }, 60000);

  it('the owner’s stop during a run: the run stops at the next record and says why', async () => {
    const sirene = {};
    const r = await run(sources({ archive: ARCH(), sirene, onSirene: () => control.requestStop() }), { only: ['structure'], select: (k, x) => [ID.st1, ID.st2, ID.st3].includes(x.id), force: true });
    expect(r.status).toBe('stopped'); expect(r.stop.code).toBe('STOPPED');
    expect(r.counts['structure:later']).toBe(2);
  }, 60000);

  it('the machine: no run during a native QA campaign or under the disk floor; no model texts without free memory (the records wait, unpublished)', async () => {
    const qa = await run(sources({ archive: ARCH() }), { only: [], probe: machine({ qa: { running: true, detail: 'ADA_RC29_PKG12_QA_v2.command' } }) });
    expect(qa).toMatchObject({ ok: false, skipped: 'NATIVE_QA_RUNNING' });
    const disk = await run(sources({ archive: ARCH() }), { only: [], probe: machine({ disk: { freeGb: 6 } }) });
    expect(disk).toMatchObject({ ok: false, skipped: 'DISK_LOW' });
    const calls = { n: 0 };
    const r = await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.a, probe: machine({ memory: { availablePct: 10, swapUsedGb: 2 } }), generate: model(calls) });
    expect(r.ok).toBe(true); expect(calls.n).toBe(0);
    expect((await row('Aide', ID.a)).statut).toBe('brouillon');
    expect((await events(ID.a)).at(-1).summary).toMatch(/mémoire de la machine insuffisante/);
  }, 60000);

  it('publishes A and B; a night where both fiches vanish withdraws only up to the cap and says so; a broken or older archive changes nothing', async () => {
    const r = await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => [ID.a, ID.b].includes(x.id) });
    expect(r.ok).toBe(true);
    for (const id of [ID.a, ID.b]) expect(await row('Aide', id)).toMatchObject({ statut: 'publie', verification_status: 'VERIFIED', publication_hold: null });
    // a previous run read an archive of 3 000 fiches: tonight's of 3 is a broken download, not 2 990 removals
    const [prev] = (await db.execute(sql`INSERT INTO "CronRun" (id, job, status, trigger, "startedAt", "updatedAt", metrics) VALUES (gen_random_uuid()::text, 'veille', 'success', 'test',
      (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'), ${JSON.stringify({ archive: { fiches: 3000, builtAt: '2026-10-24T16:16:33' } })}::jsonb) RETURNING id`)).rows;
    extraRuns.push(prev.id);
    const broken = await run(sources({ archive: zip({ 'F1.xml': fiche('F1', 'Autre') }) }), { only: ['aide'], select: (k, x) => [ID.a, ID.b].includes(x.id), force: true });
    expect(broken.ok).toBe(true);
    for (const id of [ID.a, ID.b]) expect((await row('Aide', id)).publication_hold).toBeNull();
    expect((await events(ID.a)).at(-1).summary).not.toMatch(/retirée/i);
    await db.execute(sql`DELETE FROM "CronRun" WHERE id = ${prev.id}`);
    // an archive OLDER than the one already used (a stale copy) is not used either: B, missing from it, stays published
    const old = await run(sources({ archive: zip({ [`${FA}.xml`]: fiche(FA, `Allocation test A ${TS}`) }, '2026-01-01T00:00:00') }), { only: ['aide'], select: (k, x) => [ID.a, ID.b].includes(x.id), force: true });
    expect(old.ok).toBe(true);
    for (const id of [ID.a, ID.b]) expect((await row('Aide', id)).publication_hold).toBeNull();
    const [dila] = (await db.execute(sql`SELECT health FROM "SourceRegistryEntry" WHERE source_id = 'dila-service-public'`)).rows;
    expect(dila.health.error).toMatch(/plus ancienne/);
    // both fiches really gone: one withdrawn tonight, the other put off (cap 1)
    const gone = await run(sources({ archive: zip({ 'F1.xml': fiche('F1', 'Autre') }) }), { only: ['aide'], select: (k, x) => [ID.a, ID.b].includes(x.id), limits: { newOffices: 0, newFiches: 0, withdrawCap: 1 } });
    const holds = [await row('Aide', ID.a), await row('Aide', ID.b)].map((x) => x.publication_hold);
    expect(holds.filter(Boolean)).toHaveLength(1);
    expect(gone.alerts.map((a) => a.code)).toContain('WITHDRAWALS_CAPPED');
  }, 120000);

  it('a refused verification leaves no half-published content (a synthetic record can never be verified)', async () => {
    const before = await row('Aide', ID.synth);
    const r = await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.synth });
    expect(r.ok).toBe(true);
    const after = await row('Aide', ID.synth);
    expect(after.cest_quoi).toBe(before.cest_quoi); expect(after.falc_origin).toBeNull(); expect(after.auto_check).toBeNull(); expect(after.statut).toBe('brouillon');
    expect((await events(ID.synth)).at(-1)).toMatchObject({ outcome: 'UNRESOLVED' });
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "EntityVersion" WHERE entity_id = ${ID.synth} AND reason = 'veille automatique'`)).rows[0].n).toBe(0);
  }, 60000);

  it('a bad automatic update is rolled back by the owner, the record is held, then checked again and republished by the system', async () => {
    await db.execute(sql`UPDATE "Aide" SET publication_hold = NULL WHERE id = ${ID.b}`);   // B back in the published state (the cap test held one of them)
    await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.b, force: true });
    const changed = zip({ [`${FB}.xml`]: fiche(FB, `Allocation test B ${TS}`, { date: '2026-10-25', amount: '41 000 €' }) });
    await run(sources({ archive: changed }), { only: ['aide'], select: (k, x) => x.id === ID.b });
    const upd = (await events(ID.b)).filter((e) => e.outcome === 'UPDATED').at(-1);
    expect(upd.details.versionId).toBeTruthy();
    expect((await row('Aide', ID.b)).cest_quoi).toContain('41 000 €');
    const rb = await rollbackTo(upd.details.versionId, 'owner@test', db, 'mise à jour jugée mauvaise');
    expect(rb.ok).toBe(true); expect(rb.heldForReverification).toBe(true);
    const held = await row('Aide', ID.b);
    expect(held.cest_quoi).not.toContain('41 000 €'); expect(held.publication_hold).toMatch(/^Contenu modifié par l’administration/);
    await run(sources({ archive: changed }), { only: ['aide'], select: (k, x) => x.id === ID.b });
    const again = await row('Aide', ID.b);
    expect(again).toMatchObject({ statut: 'publie', verification_status: 'VERIFIED', publication_hold: null });
    expect((await ledger(ID.b)).map((l) => `${l.outcome}:${l.reviewerRole}`).slice(-2)).toEqual(['HOLD:admin', 'VERIFIED:system']);
  }, 120000);

  it('a person’s hold recorded after the activation stays (the veille neither lifts it nor publishes over it, and says why); before the activation it is superseded by the evidence', async () => {
    const { recordVerification } = await import('../../api/_services/content-verification.js');
    await db.execute(sql`UPDATE "Aide" SET publication_hold = NULL WHERE id = ${ID.b}`);
    await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.b, force: true });
    expect(await row('Aide', ID.b)).toMatchObject({ statut: 'publie', verification_status: 'VERIFIED', publication_hold: null });
    // the owner holds it from the admin panel: the next runs leave it held and say so in the journal (the dashboard's « not resolved » list)
    const held = await recordVerification({ entityType: 'aide', entityId: ID.b, action: 'HOLD', holdReason: 'Mise en attente par la direction', reviewer: { id: 'owner@test', role: 'admin' } }, { db });
    expect(held.ok).toBe(true);
    await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.b, force: true });
    expect((await row('Aide', ID.b)).publication_hold).toBe('Mise en attente par la direction');
    const last = (await events(ID.b)).at(-1);
    expect(last.outcome).toBe('UNRESOLVED');
    expect(last.summary).toMatch(/mise en attente par une personne le \d\d\/\d\d\/\d{4} \(« Mise en attente par la direction »\) : la veille respecte cette décision/);
    expect((await ledger(ID.b)).at(-1)).toMatchObject({ outcome: 'HOLD', reviewerRole: 'admin' });
    // a refusal stays too
    const refused = await recordVerification({ entityType: 'aide', entityId: ID.b, action: 'REJECT', evidenceNote: 'Fiche hors du périmètre retenu', reviewer: { id: 'owner@test', role: 'admin' } }, { db });
    expect(refused.ok).toBe(true);
    await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.b, force: true });
    expect(await row('Aide', ID.b)).toMatchObject({ verification_status: 'REJECTED', publication_hold: 'Mise en attente par la direction' });
    expect((await events(ID.b)).at(-1).summary).toMatch(/refusée par une personne le .*Fiche hors du périmètre retenu.* : la veille respecte cette décision/);
    // the same decisions made BEFORE the activation (the earlier per-record queue) are superseded: the evidence publishes the record again
    await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.b, force: true, activatedAt: new Date(Date.now() + 60000) });
    expect(await row('Aide', ID.b)).toMatchObject({ statut: 'publie', verification_status: 'VERIFIED', publication_hold: null });
    expect((await ledger(ID.b)).map((l) => `${l.outcome}:${l.reviewerRole}`).slice(-2).sort()).toEqual(['RELEASE_HOLD:system', 'VERIFIED:system']);   // one transaction: same millisecond possible
  }, 120000);

  it('SIRENE’s capitals never replace the record’s own wording of the same street and number; another street is written in readable case; the easy-to-read text has no capitals', async () => {
    const SIR = `6${String(Date.now()).slice(-13)}`.slice(0, 14);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, adresse, code_postal, ville, siret, services, publics_accueillis, categories_aidees, statut, "updatedAt")
      VALUES (${ID.caps}, ${`Association Lumière ${TS}`}, ${ID.caps}, '33 Rue Kageneck 67000 Strasbourg', '67000', 'Strasbourg', ${SIR}, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 'brouillon', NOW())`);
    const hit = (address, cp) => ({ [SIR]: { nom_complet: `ASSOCIATION LUMIERE ${TS}`, etat_administratif: 'A', complements: { est_association: true }, nature_juridique: '9220', date_mise_a_jour: '2026-09-01',
      matching_etablissements: [{ siret: SIR, etat_administratif: 'A', adresse: `${address} ${cp} STRASBOURG`, code_postal: cp, commune: '67482', libelle_commune: 'STRASBOURG', latitude: '48.58', longitude: '7.74' }] } });
    await run(sources({ archive: ARCH(), sirene: hit('BAT A 33 RUE KAGENECK', '67100') }), { only: ['structure'], select: (k, x) => x.id === ID.caps, force: true });
    const s = await row('Structure', ID.caps);
    expect(s).toMatchObject({ statut: 'actif', verification_status: 'VERIFIED', adresse: '33 Rue Kageneck', code_postal: '67100', ville: 'Strasbourg' });
    expect(s.summary_falc).toContain('L’adresse est : 33 Rue Kageneck, 67100 Strasbourg.');
    // the establishment moved to another street: SIRENE's address, in readable case
    await run(sources({ archive: ARCH(), sirene: hit('5 QUAI DES BATELIERS', '67000') }), { only: ['structure'], select: (k, x) => x.id === ID.caps, force: true });
    const m = await row('Structure', ID.caps);
    expect(m).toMatchObject({ adresse: '5 quai des Bateliers', code_postal: '67000' });
    expect(`${m.summary_falc} ${m.description_courte}`).not.toMatch(/QUAI|BATELIERS|STRASBOURG/);
  }, 60000);

  it('not sources: a site outside its field (Défenseur des droits for a démarche), an unknown look-alike site, a fiche of another territory', async () => {
    const r = await run(sources({ archive: ARCH(), page: { [`https://www.defenseurdesdroits.fr/saisir-${TS}`]: { body: PAGE('Saisir le Défenseur', '700') } } }),
      { only: ['aide', 'demarche'], select: (k, x) => [ID.dem, ID.fake, ID.mayotte].includes(x.id) });
    expect(r.ok).toBe(true);
    expect((await events(ID.dem)).at(-1).summary).toMatch(/pas pour une démarche/);
    expect((await events(ID.fake)).at(-1).summary).toMatch(/n'est pas celle d'un site officiel reconnu/);
    expect((await events(ID.mayotte)).at(-1).summary).toMatch(/ne s’applique pas au Bas-Rhin/);
    for (const [t, id] of [['Demarche', ID.dem], ['Aide', ID.fake], ['Aide', ID.mayotte]]) expect((await row(t, id)).verification_status).not.toBe('VERIFIED');
  }, 60000);

  it('a page missing once is re-read the next day before any withdrawal', async () => {
    const url = `https://www.caf.fr/vacances-${TS}`;
    const r1 = await run(sources({ archive: ARCH(), page: { [url]: { body: PAGE(`Aide aux vacances test ${TS}`, '30 000 €') } } }), { only: ['aide'], select: (k, x) => x.id === ID.page });
    expect(r1.ok).toBe(true); expect(await row('Aide', ID.page)).toMatchObject({ statut: 'publie', verification_status: 'VERIFIED' });
    await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.page, force: true });
    const once = await row('Aide', ID.page);
    expect(once.publication_hold).toBeNull(); expect(once.auto_check.missing.status).toBe(404);
    await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.page, force: true, now: new Date(Date.now() + 21 * 3600000) });
    expect((await row('Aide', ID.page)).publication_hold).toMatch(/^Veille automatique : source officielle retirée/);
  }, 60000);

  it('an employee’s own e-mail never becomes public (the office’s generic one replaces it); a new office brings no personal address; an Annuaire outage changes nothing', async () => {
    const r = await run(sources({ archive: ARCH() }), { only: ['structure', 'offices'], select: (k, x) => x.id === ID.priv || String(x.source_annuaire || '') === office2.id, limits: { newOffices: 5, newFiches: 0 } });
    expect(r.ok).toBe(true);
    const s = await row('Structure', ID.priv);
    expect(s).toMatchObject({ statut: 'actif', verification_status: 'VERIFIED', email: 'accueil@caf-test.fr' });
    expect((await db.execute(sql`SELECT snapshot_json->>'email' AS e FROM "EntityVersion" WHERE entity_id = ${ID.priv} AND reason = 'veille automatique'`)).rows.map((x) => x.e)).toContain('camille.exemple@caf67.caf.fr');
    expect((await events(ID.priv)).at(-1).summary).toMatch(/adresse électronique personnelle d’un agent retirée/);
    const [created] = (await db.execute(sql`SELECT email, statut FROM "Structure" WHERE source_annuaire = ${office2.id}`)).rows;
    expect(created).toEqual({ email: null, statut: 'actif' });
    const down = await run(sources({ archive: ARCH(), annuaire: 'down' }), { only: ['structure'], select: (k, x) => x.id === ID.priv, force: true });
    expect(down.ok).toBe(true);
    expect(await row('Structure', ID.priv)).toMatchObject({ statut: 'actif', verification_status: 'VERIFIED', publication_hold: null });
    expect((await events(ID.priv)).at(-1)).toMatchObject({ outcome: 'RETRY' });
    const [feed] = (await db.execute(sql`SELECT health FROM "SourceRegistryEntry" WHERE source_id = 'annuaire-administration'`)).rows;
    expect(feed.health.ok).toBe(false);
  }, 60000);

  it('a public reception office the Annuaire no longer lists is not published on its SIRET alone (France Travail Seyboth: SIRENE still « open »)', async () => {
    const sirene = { [GONE_SIRET]: { nom_complet: 'FRANCE TRAVAIL', etat_administratif: 'A', complements: {}, nature_juridique: '7389', matching_etablissements: [{ siret: GONE_SIRET, etat_administratif: 'A',
      adresse: '8 RUE ADOLPHE SEYBOTH 67000 STRASBOURG', code_postal: '67000', commune: '67482', libelle_commune: 'STRASBOURG' }] } };
    const r = await run(sources({ archive: ARCH(), sirene }), { only: ['structure'], select: (k, x) => x.id === ID.gone, force: true });
    expect(r.ok).toBe(true);
    expect(await row('Structure', ID.gone)).toMatchObject({ statut: 'brouillon' });
    expect((await row('Structure', ID.gone)).verification_status).not.toBe('VERIFIED');
    expect((await events(ID.gone)).at(-1).summary).toMatch(/absent de l'Annuaire de l'administration/);
  }, 60000);

  it('dispositifs grow from Service-Public and are checked like aides', async () => {
    const cej = fiche(FD, `Contrat d'engagement jeune ${TS}`, { path: '<Niveau ID="N19806">Travail - Formation</Niveau><Niveau ID="N1">Insertion professionnelle</Niveau>' });
    const r = await run(sources({ archive: zip({ [`${FD}.xml`]: cej }) }), { only: ['fiches'], limits: { newOffices: 0, newFiches: 1 } });
    expect(r.ok).toBe(true);
    const [d] = (await db.execute(sql`SELECT to_jsonb(x) AS j FROM "Dispositif" x WHERE titre = ${`Contrat d'engagement jeune ${TS}`}`)).rows.map((x) => x.j);
    expect(d).toMatchObject({ statut: 'publie', verification_status: 'VERIFIED', verified_by: 'ada-veille-automatique', falc_origin: 'AI_LOCAL', data_origin: 'official' });
    expect(d.description_falc).toMatch(/Pour qui :/); expect(d.liens[0]).toEqual({ nom: 'Fiche officielle', url: `https://www.service-public.gouv.fr/particuliers/vosdroits/${FD}` });
    const again = await run(sources({ archive: zip({ [`${FD}.xml`]: cej }) }), { only: ['dispositif'], select: (k, x) => x.id === d.id, force: true });
    expect(again.counts['dispositif:checked']).toBe(1); expect(again.counts['dispositif:unchanged']).toBe(1);
    await db.execute(sql`DELETE FROM "VeilleEvent" WHERE entity_id = ${d.id}`).catch(() => {});
  }, 60000);

  it('the registry: the online services Service-Public cites become sources for démarches (another territory’s are left out); the feeds’ health; a site moved elsewhere is paused', async () => {
    const online = `<ServiceEnLigne ID="R1" URL="https://${ONLINE}/demande" type="Téléservice"><Titre>Demande en ligne</Titre><Source ID="R2">Caisse nationale de test</Source></ServiceEnLigne><ServiceEnLigne ID="R3" URL="https://${PARIS}/" type="Téléservice"><Titre>Demande à Paris</Titre><Source ID="R4">Ville de Paris</Source></ServiceEnLigne>`;
    const r = await run(sources({ archive: zip({ [`${FA}.xml`]: fiche(FA, `Allocation test A ${TS}`, { online }) }) }), { only: [], forceRegistry: true });
    expect(r.ok).toBe(true);
    const reg = (await db.execute(sql`SELECT source_id, status, capabilities, level, connector_class FROM "SourceRegistryEntry" WHERE source_id IN (${`dila-online:${ONLINE}`}, ${`dila-online:${PARIS}`}, ${`annuaire-site:${SITE.replace(/^www\./, '')}`})`)).rows;
    expect(reg.find((x) => x.source_id === `dila-online:${ONLINE}`)).toMatchObject({ status: 'ACTIVE', capabilities: ['demarches'], level: 'ORGANISME', connector_class: 'dila-attested' });
    expect(reg.find((x) => x.source_id === `dila-online:${PARIS}`)).toBeUndefined();
    const [refresh] = (await db.execute(sql`SELECT metrics FROM "CronRun" WHERE job = 'veille-registre' ORDER BY "startedAt" DESC LIMIT 1`)).rows;
    expect(refresh.metrics.online.rejected.map((x) => x.host)).toContain(PARIS);
    const [dila] = (await db.execute(sql`SELECT health, content_version FROM "SourceRegistryEntry" WHERE source_id = 'dila-service-public'`)).rows;
    expect(dila.health.ok).toBe(true); expect(dila.content_version).toBeTruthy();
    // the monthly visit: the online service answers; the commune site redirects to an address nobody attests → paused
    const net = { fetchImpl: sources({ review: { [`https://${ONLINE}`]: { status: 200 }, [`https://${SITE.replace(/^www\./, '')}`]: { status: 302, location: 'https://pages-perso.example.net/mairie' } } }), env: process.env,
      trustedDomains: [ONLINE, SITE.replace(/^www\./, '')] };
    const v = await reviewSources({ db, net, select: (id) => [`dila-online:${ONLINE}`, `annuaire-site:${SITE.replace(/^www\./, '')}`].includes(id) });
    expect(v.visited).toBe(2);
    const after = (await db.execute(sql`SELECT source_id, status, redirects, health FROM "SourceRegistryEntry" WHERE source_id IN (${`dila-online:${ONLINE}`}, ${`annuaire-site:${SITE.replace(/^www\./, '')}`})`)).rows;
    expect(after.find((x) => x.source_id === `dila-online:${ONLINE}`)).toMatchObject({ status: 'ACTIVE' });
    const moved = after.find((x) => x.source_id.startsWith('annuaire-site:'));
    expect(moved.status).toBe('PAUSED'); expect(moved.redirects[0].to).toBe('https://pages-perso.example.net/mairie');
    // replaced by another trusted site (bas-rhin.fr → alsace.eu): retired with its successor, and the weekly refresh does not bring it back
    await ins('SourceRegistryEntry', ['id', 'source_id', 'name', 'type', 'trusted_domains', 'status', 'connector_class', 'updated_at'], [`${TS}-succ`, `qa-successor-${TS}`, 'QA successeur', 'HTML_SCRAPER', `{${NEWSITE}}`, 'ACTIVE', 'seed', new Date()]);
    await ins('SourceRegistryEntry', ['id', 'source_id', 'name', 'type', 'endpoint', 'trusted_domains', 'status', 'connector_class', 'level', 'updated_at'], [`${TS}-old`, `annuaire-site:${OLDSITE}`, 'QA ancien site', 'HTML_SCRAPER', `https://${OLDSITE}`, `{${OLDSITE}}`, 'ACTIVE', 'annuaire-attested', 'COMMUNAL', new Date()]);
    const net2 = { fetchImpl: sources({ review: { [`https://${OLDSITE}`]: { status: 301, location: `https://${NEWSITE}/` }, [`https://${NEWSITE}`]: { status: 200 } } }), env: process.env, trustedDomains: [OLDSITE, NEWSITE] };
    await reviewSources({ db, net: net2, select: (id) => id === `annuaire-site:${OLDSITE}` });
    const [retired] = (await db.execute(sql`SELECT status, successor_source_id FROM "SourceRegistryEntry" WHERE source_id = ${`annuaire-site:${OLDSITE}`}`)).rows;
    expect(retired).toEqual({ status: 'DISABLED', successor_source_id: `qa-successor-${TS}` });
    const { refreshRegistry } = await import('../../api/_services/verification/sources.js');
    await refreshRegistry({ db, rows: [{ id: `${TS}-oldoffice`, nom: 'Mairie QA', pivot: '[{"type_service_local": "mairie"}]', site_internet: `[{"valeur": "https://${OLDSITE}"}]`, url_service_public: 'https://lannuaire.service-public.gouv.fr/qa' }] });
    expect((await db.execute(sql`SELECT status FROM "SourceRegistryEntry" WHERE source_id = ${`annuaire-site:${OLDSITE}`}`)).rows[0].status).toBe('DISABLED');
  }, 60000);

  it('the self-check withdraws what breaks the contract: published without a ledger decision, a personal address shown', async () => {
    await ins('Aide', ['id', 'titre', 'slug', 'categorie', 'statut', 'verification_status', 'verified_by', 'territory_verified', 'launch_eligible', 'data_origin', 'source_url', 'date_verification', 'updatedAt'],
      [ID.bypass, `Aide publiée sans décision ${TS}`, ID.bypass, 'logement', 'publie', 'VERIFIED', 'quelqu’un', true, true, 'official', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1', new Date(), new Date()]);
    await db.execute(sql`UPDATE "Structure" SET email = 'camille.exemple@caf67.caf.fr' WHERE id = ${ID.priv}`);
    const r = await run(sources({ archive: ARCH() }), { only: ['audit'], select: (k, x) => [ID.bypass, ID.priv].includes(x.id) });
    expect(r.audit.byCode).toMatchObject({ LEDGER: 1, PRIVACY: 1 });
    expect((await row('Aide', ID.bypass)).publication_hold).toMatch(/contrôle de cohérence/);
    expect((await row('Structure', ID.priv)).publication_hold).toMatch(/contrôle de cohérence/);
    // the next structure check removes the address and puts the record back
    await run(sources({ archive: ARCH() }), { only: ['structure'], select: (k, x) => x.id === ID.priv, force: true });
    expect(await row('Structure', ID.priv)).toMatchObject({ publication_hold: null, email: 'accueil@caf-test.fr', statut: 'actif' });
  }, 60000);

  it('the owner’s dashboard: state, alerts, counts by kind, freshness, sources; a record’s history from its sources to its versions', async () => {
    const d = await veilleDigest({ db, days: 1 });
    expect(d.status.paused.paused).toBe(false);
    expect(d.period.checked).toBeGreaterThan(0);
    expect(d.totals.map((t) => t.kind)).toEqual(['aide', 'demarche', 'dispositif', 'structure']);
    expect(d.freshness.find((f) => f.kind === 'aide').public).toBeGreaterThan(0);
    expect(d.sources.feeds.map((f) => f.sourceId)).toEqual(expect.arrayContaining(['dila-service-public', 'annuaire-administration']));
    const h = await recordHistory({ db, type: 'aide', id: ID.b });
    expect(h.record.title).toBe(`Allocation test B ${TS}`);
    expect(h.ledger.length).toBeGreaterThan(0); expect(h.snapshots.length).toBeGreaterThan(0); expect(h.versions.length).toBeGreaterThan(0); expect(h.events.length).toBeGreaterThan(0);
  }, 60000);
  it('R14: a refusal stays after an automatic withdrawal; an archived or unpublished record is never put back online by the veille', async () => {
    const { recordVerification } = await import('../../api/_services/content-verification.js');
    const { SYSTEM_REVIEWER } = await import('../../api/_services/verification/chain.js');
    await db.execute(sql`UPDATE "Aide" SET publication_hold = NULL, statut = 'publie' WHERE id IN (${ID.a}, ${ID.b})`);
    await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => [ID.a, ID.b].includes(x.id), force: true });
    for (const id of [ID.a, ID.b]) expect(await row('Aide', id)).toMatchObject({ statut: 'publie', verification_status: 'VERIFIED', publication_hold: null });
    // the owner refuses B; then a night withdraws it automatically (a system HOLD row after the refusal — the order that used to make the refusal lapse)
    expect((await recordVerification({ entityType: 'aide', entityId: ID.b, action: 'REJECT', evidenceNote: 'Refus explicite du propriétaire', reviewer: { id: 'owner@test', role: 'admin' } }, { db })).ok).toBe(true);
    await run(sources({ archive: zip({ 'F1.xml': fiche('F1', 'Autre') }) }), { only: ['aide'], select: (k, x) => x.id === ID.b, force: true });
    await recordVerification({ entityType: 'aide', entityId: ID.b, action: 'HOLD', holdReason: 'Retrait automatique : source introuvable (simulé)', reviewer: SYSTEM_REVIEWER }, { db });
    // the source comes back: the refusal still decides (no automatic release or verification after it)
    const before = (await ledger(ID.b)).length;
    await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.b, force: true });
    expect((await row('Aide', ID.b)).verification_status).toBe('REJECTED');
    expect((await ledger(ID.b)).slice(before).map((l) => `${l.outcome}:${l.reviewerRole}`)).toEqual([]);
    expect((await events(ID.b)).at(-1).summary).toMatch(/refusée par une personne le .*Refus explicite du propriétaire/);
    // A archived by the owner: never republished; A set back to draft by the owner after its publication: stays a draft
    await db.execute(sql`UPDATE "Aide" SET statut = 'archive' WHERE id = ${ID.a}`);
    await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.a, force: true });
    expect((await row('Aide', ID.a)).statut).toBe('archive');
    expect((await events(ID.a)).at(-1).summary).toMatch(/archivée par une personne : la veille respecte cette décision/);
    await db.execute(sql`UPDATE "Aide" SET statut = 'brouillon', published_at = COALESCE(published_at, NOW()) WHERE id = ${ID.a}`);
    await run(sources({ archive: ARCH() }), { only: ['aide'], select: (k, x) => x.id === ID.a, force: true });
    expect((await row('Aide', ID.a)).statut).toBe('brouillon');
    expect((await events(ID.a)).at(-1).summary).toMatch(/retirée de la publication par une personne/);
  }, 180000);
});
