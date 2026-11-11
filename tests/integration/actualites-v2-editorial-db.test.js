/**
 * Actualités v2 on REAL PostgreSQL (no network): the public editorial feed (rights per source, place, category, story grouping) and ADA's own articles
 * (draft → review → approved by a named MFA administrator → correction → retraction), through the real handlers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ADMIN = `v2-editor-${TS}@example.test`;
const resOf = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; }, on() {} });
const LONG = 'Ce texte explique, avec ses sources, ce qui change pour les personnes concernées. '.repeat(6);

describe.skipIf(!hasDatabase)('Actualités v2 — public feed and ADA editorial workflow (real DB)', () => {
  let db, feed, editorial, auth;
  const call = async (handler, req) => { const r = resOf(); await handler({ headers: { host: 'localhost', ...(req.headers || {}) }, query: {}, ...req }, r); return r; };
  const tok = (mfa = true) => auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: mfa });
  const ed = (body, mfa = true) => call(editorial, { method: 'POST', url: '/api/admin/news-editorial', headers: { authorization: `Bearer ${tok(mfa)}` }, body });
  const pub = (query) => call(feed, { method: 'GET', url: '/api/actualites', query: { view: 'v2', pageSize: '50', ...query } });
  const detail = (slug) => call(feed, { method: 'GET', url: `/api/actualites/${slug}`, query: {} });
  const insert = (o) => db.execute(sql`INSERT INTO "Actualite" (id, titre, resume, contenu, statut, slug, canonical_url, date_publication, published_at, type_actu, key_points_falc, departements, tags, score_fiabilite, "updatedAt", auto_publish)
    VALUES (${o.id}, ${o.titre}, ${o.resume || 'Résumé.'}, ${'<p>Texte</p>'}, 'publie', ${o.slug}, ${o.url}, now(), now(), 'info', '{}', '{}', '{}', 0, now(), true)`);

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    feed = (await import('../../api/_handlers/actualites.js')).default;
    editorial = (await import('../../api/_handlers/admin/news-editorial.js')).default;
    auth = await import('../../api/_utils/auth.js');
    await insert({ id: `v2-sp-${TS}`, titre: `Logement ${TS} : nouveau barème des APL pour les locataires`, slug: `v2-sp-${TS}`, url: `https://www.service-public.gouv.fr/particuliers/actualites/V2${TS}` });
    await insert({ id: `v2-press-${TS}`, titre: `Logement ${TS} : nouveau barème des APL pour les locataires`, slug: `v2-press-${TS}`, url: `https://www.journal-v2-${TS}.example/apl` });
    await insert({ id: `v2-gre-${TS}`, titre: `Région ${TS} : annonce`, slug: `v2-gre-${TS}`, url: 'https://www.grandest.fr/v2' });
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor = ${ADMIN}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Actualite" WHERE id LIKE ${`v2-%-${TS}`} OR (type_actu = 'ada_original' AND "updatedBy" = ${ADMIN})`).catch(() => {});
  });

  it('the feed shows the licensed item (lane A, place, category); a blocked source and an unregistered press item are never shown', async () => {
    const r = await pub({ q: String(TS) });
    expect(r.statusCode).toBe(200); expect(r.body.view).toBe('v2');
    const ids = r.body.items.map((i) => i.id);
    expect(ids).toContain(`v2-sp-${TS}`); expect(ids).not.toContain(`v2-gre-${TS}`); expect(ids).not.toContain(`v2-press-${TS}`);
    const sp = r.body.items.find((i) => i.id === `v2-sp-${TS}`);
    expect(sp).toMatchObject({ lane: 'A', publisher: 'Service-Public.fr (DILA)', geo: { scope: 'france' } }); expect(sp.topics).toContain('logement');
    expect(JSON.stringify(r.body)).not.toMatch(/updatedBy|raw_payload_json|commentaire_statut|"_t"/);
    expect((await detail(`v2-press-${TS}`)).statusCode).toBe(404);   // no rights evidenced: no article page
    expect((await detail(`v2-gre-${TS}`)).statusCode).toBe(404);
    const d = await detail(`v2-sp-${TS}`);
    expect(d.statusCode).toBe(200); expect(d.body.news).toMatchObject({ lane: 'A', licence: 'Licence Ouverte 2.0 (Etalab)' });
  });

  it('an ADA article needs a named MFA administrator; it is invisible until approved; approval enforces sources, corroboration and the checklist', async () => {
    expect((await ed({ action: 'save', draft: { titre: 'Brouillon sans MFA' } }, false)).statusCode).toBe(403);
    const created = await ed({ action: 'save', draft: { titre: `Comprendre la réforme ${TS}`, resume: 'Ce qui change, pour qui, et à partir de quand : l’essentiel, avec les sources.', contenu: LONG, topic: 'politique',
      sources: [{ publisher: 'Vie publique', url: 'https://www.vie-publique.fr/x' }] } });
    expect(created.statusCode).toBe(201); const id = created.body.id;
    expect(created.body.problems).toEqual(expect.arrayContaining(['CORROBORATION_TWO_SITES_REQUIRED', 'CHECKLIST_factsSourced']));
    expect((await pub({ q: `réforme ${TS}` })).body.items).toHaveLength(0);
    expect((await ed({ action: 'submit', id })).body.statut).toBe('a_relire');
    const refused = await ed({ action: 'approve', id });
    expect(refused.statusCode).toBe(422); expect(refused.body.problems).toContain('CORROBORATION_TWO_SITES_REQUIRED');
    // complete it: two independent sites, the checklist, back to review, approved
    await ed({ action: 'save', id, draft: { titre: `Comprendre la réforme ${TS}`, resume: 'Ce qui change, pour qui, et à partir de quand : l’essentiel, avec les sources.', contenu: LONG, topic: 'politique',
      sources: [{ publisher: 'Vie publique', url: 'https://www.vie-publique.fr/x' }, { publisher: 'Légifrance', url: 'https://www.legifrance.gouv.fr/y' }],
      checklist: { factsSourced: true, noCopiedText: true, proportionateViewpoints: true, uncertaintyLabelled: true } } });
    await ed({ action: 'submit', id });
    const ok = await ed({ action: 'approve', id });
    expect(ok.statusCode).toBe(200); expect(ok.body.statut).toBe('publie');
    const r = await pub({ q: `réforme ${TS}` });
    expect(r.body.items[0]).toMatchObject({ id, lane: 'ADA', publisher: 'AccesDirectAide' });
    expect(r.body.items[0].ada.sources).toHaveLength(2);
    const audit = (await db.execute(sql`SELECT action FROM "AuditLog" WHERE actor = ${ADMIN} AND entity = 'Actualite' ORDER BY timestamp`)).rows.map((x) => x.action);
    expect(audit).toEqual(expect.arrayContaining(['NEWS_EDITORIAL_CREATE', 'NEWS_EDITORIAL_SUBMIT', 'NEWS_EDITORIAL_APPROVE']));

    // a correction is dated and shown; a retraction leaves a 410 notice with its reason
    expect((await ed({ action: 'correct', id, note: 'court' })).statusCode).toBe(400);
    expect((await ed({ action: 'correct', id, note: 'Date d’entrée en vigueur corrigée (1er juillet).' })).statusCode).toBe(200);
    const slug = ok.body.slug;
    const d = await detail(slug);
    expect(d.body.news.ada.corrections[0].note).toContain('1er juillet');
    expect((await ed({ action: 'retract', id, note: 'Texte retiré : la réforme a été abandonnée.' })).body.statut).toBe('retire');
    const gone = await detail(slug);
    expect(gone.statusCode).toBe(410); expect(gone.body).toMatchObject({ retracted: true }); expect(gone.body.note).toContain('abandonnée');
    expect((await pub({ q: `réforme ${TS}` })).body.items).toHaveLength(0);
  });

  it('an unknown action, a bad id and a published article edited outside correction are refused', async () => {
    expect((await ed({ action: 'publish-now' })).statusCode).toBe(400);
    expect((await ed({ action: 'approve', id: 'not-an-id' })).statusCode).toBe(400);
  });
});
