/**
 * P22 — source-aware prerendering on REAL PostgreSQL: the RAW HTML (bytes as served, no browser, no DOM) of the record pages through the handler the hosting
 * rewrites them to (/api/public/page) — a published place: 200 with its canonical address, title, description and summary, index; a withdrawn one (it was
 * published): 410, noindex, nothing of the record (no name, no reason); a draft never published and an unknown address: 404, noindex; /annuaire/<slug>: 301
 * to /structures/<slug>; If-None-Match: 304; the veille withdraws the place → the next answer is 410 (state in the ETag, short shared cache). The sitemap lists
 * the canonical address of what is public only. Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const N = String(Date.now()).slice(-6);
const ID = { shown: `ph${N}-shown`, gone: `ph${N}-gone`, draft: `ph${N}-draft`, dispo: `ph${N}-dispo` };
const SLUG = { shown: `maison-des-solidarites-${N}`, gone: `association-fermee-${N}`, draft: `brouillon-${N}`, dispo: `dispositif-test-${N}` };

const res = () => { const r = { code: 0, headers: {}, body: '' }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = JSON.stringify(b); return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; }; r.writeHead = (c, h = {}) => { r.code = c; for (const [k, v] of Object.entries(h)) r.headers[k.toLowerCase()] = v; return r; }; r.end = (b) => { r.body = b === undefined ? '' : String(b); return r; }; return r; };

describe.skipIf(!hasDatabase)('P22 — record pages\' initial HTML (real DB, raw HTML)', () => {
  let db; let page; let sitemap; let resetTemplate;
  const get = async (path, headers = {}) => { const r = res(); await page({ method: 'GET', query: { path }, headers: { host: 'www.example.test', 'x-forwarded-proto': 'https', ...headers } }, r); return r; };
  const insert = (id, slug, nom, { statut = 'actif', hold = null, published = true, verified = true } = {}) => sql`INSERT INTO "Structure" (id, nom, slug, adresse, code_postal, ville, services, publics_accueillis, categories_aidees, statut,
    verification_status, verified_by, date_verification, territory_verified, launch_eligible, data_origin, source_url, publication_hold, published_at, description_courte, "updatedAt", "createdAt")
    VALUES (${id}, ${nom}, ${slug}, '1 rue de la Paix', '67000', 'Strasbourg', ARRAY[]::text[], ARRAY[]::text[], ARRAY['Accès aux droits'], ${statut}, ${verified ? 'VERIFIED' : 'UNVERIFIED'}, ${verified ? 'ada-veille-automatique' : null},
    ${verified ? new Date() : null}, ${verified}, ${verified}, 'official', 'https://annuaire-entreprises.data.gouv.fr/etablissement/1', ${hold}, ${published ? new Date() : null},
    ${`${nom} accueille les habitants pour leurs démarches <script>alert(1)</script> & droits.`}, NOW(), NOW())`;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: page } = await import('../../api/_handlers/public/page.js'));
    ({ default: sitemap } = await import('../../api/_handlers/sitemap.js'));
    ({ resetTemplate } = await import('../../api/_services/page-head.js'));
    resetTemplate();
    await db.execute(insert(ID.shown, SLUG.shown, `Maison des solidarités ${N}`));
    await db.execute(insert(ID.gone, SLUG.gone, `Association Secrète ${N}`, { hold: 'Veille automatique : établissement fermé selon le registre SIRENE (motif interne)' }));
    await db.execute(insert(ID.draft, SLUG.draft, `Brouillon Confidentiel ${N}`, { statut: 'brouillon', published: false, verified: false }));
    await db.execute(sql`INSERT INTO "Dispositif" (id, slug, titre, public, summary_falc, statut, verification_status, verified_by, date_verification, territory_verified, launch_eligible, data_origin, source_url, published_at, "updatedAt")
      VALUES (${ID.dispo}, ${SLUG.dispo}, ${`Contrat d’engagement jeune ${N}`}, ARRAY['Jeunes'], 'Un accompagnement pour les jeunes.', 'publie', 'VERIFIED', 'ada-veille-automatique', NOW(), true, true, 'official', 'https://www.service-public.gouv.fr/x', NOW(), NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${ID.shown}, ${ID.gone}, ${ID.draft})`).catch(() => {});
    await db.execute(sql`DELETE FROM "Dispositif" WHERE id = ${ID.dispo}`).catch(() => {});
  });

  it('a published place: 200, canonical address, title, description and summary in the raw HTML, indexable, short shared cache', async () => {
    const r = await get(`/structures/${SLUG.shown}`);
    expect(r.code).toBe(200);
    const html = r.body;
    expect(html).toContain(`<link rel="canonical" href="https://www.example.test/structures/${SLUG.shown}" data-rh="true" />`);
    expect(html).toContain(`<title>Maison des solidarités ${N} — AccesDirectAide</title>`);
    expect(html).toMatch(/<meta name="description" content="Maison des solidarités \d+ accueille les habitants pour leurs démarches &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; droits\." \/>/);
    expect(html).toContain('<meta name="robots" content="index, follow" />');
    expect(html).toContain(`<div id="root"><main data-prerender="Lieu d’accueil"><h1>Maison des solidarités ${N}</h1>`);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect((html.match(/rel="canonical"/g) || []).length, 'one canonical').toBe(1);
    expect(r.headers['cache-control']).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=60');
    expect(r.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);
    const again = await get(`/structures/${SLUG.shown}`, { 'if-none-match': r.headers.etag });
    expect(again.code).toBe(304); expect(again.body).toBe('');
  });

  it('a withdrawn place: 410, noindex, nothing of the record; a draft and an unknown address: 404, noindex, nothing of the record', async () => {
    const g = await get(`/structures/${SLUG.gone}`);
    expect(g.code).toBe(410);
    expect(g.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(g.body).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(g.body).toContain('<title>Page retirée — AccesDirectAide</title>');
    for (const leak of ['Secrète', 'SIRENE', 'motif interne', 'rel="canonical"']) expect(g.body, leak).not.toContain(leak);
    const d = await get(`/structures/${SLUG.draft}`);
    expect(d.code).toBe(404);
    expect(d.body).not.toContain('Confidentiel');
    expect(d.body).toContain('<title>Page introuvable — AccesDirectAide</title>');
    const u = await get('/structures/n-existe-pas-du-tout');
    expect(u.code).toBe(404);
    expect((await get('/aides/%E0%A4%A')).code, 'a malformed address').toBe(404);
  });

  it('/annuaire/<slug> answers 301 to the canonical /structures/<slug>; a dispositif has its own page', async () => {
    const r = await get(`/annuaire/${SLUG.shown}`);
    expect(r.code).toBe(301); expect(r.headers.location).toBe(`/structures/${SLUG.shown}`);
    const d = await get(`/dispositifs/${SLUG.dispo}`);
    expect(d.code).toBe(200);
    expect(d.body).toContain(`<title>Contrat d’engagement jeune ${N} — AccesDirectAide</title>`);
    expect(d.body).toContain('<meta name="description" content="Un accompagnement pour les jeunes." />');
  });

  it('the veille withdraws the place: the next answer is 410 (the record\'s state is in the ETag: no stale verified claim)', async () => {
    const before = await get(`/structures/${SLUG.shown}`);
    await db.execute(sql`UPDATE "Structure" SET publication_hold = 'Veille automatique : établissement fermé' WHERE id = ${ID.shown}`);
    const after = await get(`/structures/${SLUG.shown}`, { 'if-none-match': before.headers.etag });
    expect(after.code).toBe(410);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    await db.execute(sql`UPDATE "Structure" SET publication_hold = NULL WHERE id = ${ID.shown}`);
  });

  it('the sitemap lists the canonical address of what is public only', async () => {
    const r = res(); await sitemap({ method: 'GET', headers: { host: 'www.example.test', 'x-forwarded-proto': 'https' } }, r);
    expect(r.code).toBe(200);
    expect(r.body).toContain(`<loc>https://www.example.test/structures/${SLUG.shown}</loc>`);
    expect(r.body).toContain(`/dispositifs/${SLUG.dispo}</loc>`);
    expect(r.body).not.toContain(SLUG.gone); expect(r.body).not.toContain(SLUG.draft);
    expect(r.body).not.toContain('/annuaire/');
  });
});
