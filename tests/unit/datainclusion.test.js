/**
 * data·inclusion (D05, api/_services/verification/datainclusion.js): the streaming reader of a top-level array, the SIRET key, each producer's authority and its
 * public words, the schema's labels (an unknown value is not shown), freshness and de-duplication of services, the public projection, and the optional API
 * adapter (nothing requested without a token; the contacts it returns are never kept).
 */
import { describe, expect, it } from 'vitest';
import { arrayElements } from '../../api/_services/verification/finess.js';
import { validSiret, producerOf, attribution, serviceOf, servicesFor, servicesValue, sameServices, publicServices, apiStructures, apiServices, FRESH_DAYS } from '../../api/_services/verification/datainclusion.js';

async function* pieces(text, size) { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }
const collect = async (it) => { const out = []; for await (const x of it) out.push(x); return out; };
const svc = (over = {}) => ({ id: 'dora--s1', structure_id: 'dora--p1', source: 'dora', nom: 'Atelier numérique', date_maj: Date.parse('2026-09-01'), thematiques: ['numerique--acceder-a-des-services-en-ligne'], publics: ['tous-publics'],
  frais: 'gratuit', modes_accueil: ['en-presentiel'], type: 'atelier', description: 'texte libre', contact_nom_prenom: 'Jean Dupont', courriel: 'jean.dupont@exemple.fr', telephone: '+33600000000', lien_source: 'https://dora.inclusion.gouv.fr/services/x', ...over });

describe('data·inclusion — reading and identity', () => {
  it('reads the objects of a top-level array as a stream, whatever the chunk boundaries (strings with brackets and escapes included)', async () => {
    const doc = JSON.stringify([{ id: 'a', nom: 'Le « [x] » {y}', n: [1, { z: '\\"]' }] }, { id: 'b' }, { id: 'c', nested: { deep: [[{}]] } }]);
    for (const size of [1, 3, 7, 64]) expect((await collect(arrayElements(pieces(doc, size), null))).map((x) => x.id), String(size)).toEqual(['a', 'b', 'c']);
    await expect(collect(arrayElements(pieces(doc.slice(0, -5), 4), null))).rejects.toMatchObject({ code: 'BAD_JSON' });
    // the keyed mode of the FINESS files is unchanged
    expect((await collect(arrayElements(pieces(JSON.stringify({ pmej: [{ id: 1 }], gco: [{ id: 2 }] }), 5), 'pmej'))).map((x) => x.id)).toEqual([1]);
  });

  it('keeps a SIRET only with a valid key (La Poste\'s rule included)', () => {
    expect(validSiret('775 641 830 00440')).toBe('77564183000440');
    expect(validSiret('77564183000441')).toBeNull();
    expect(validSiret('1234')).toBeNull();
    expect(validSiret('35600000000060')).toBe('35600000000060');
    expect(validSiret('35600000000048')).toBeNull();
  });
});

describe('data·inclusion — producers and their authority', () => {
  it('says who says it: a public operator about its own offer, a body about the service it runs, a place about itself on a platform; unknown = declarative', () => {
    expect(attribution(producerOf('france-travail'))).toBe('selon France Travail');
    expect(attribution(producerOf('action-logement'))).toBe('selon Action Logement, qui gère ce service');
    expect(attribution(producerOf('dora'))).toBe('déclaré par la structure sur DORA');
    expect(producerOf('nouvelle-source')).toMatchObject({ authority: 'PLATEFORME_DECLARATIVE', growth: false });
    expect(producerOf('monenfant').growth, 'childcare places are not directory records').toBe(false);
  });

  it('keeps the schema\'s labels only — never the producer\'s free text or a contact; an unknown value is counted, not shown', () => {
    const unknown = {};
    const s = serviceOf(svc({ thematiques: ['numerique--acceder-a-des-services-en-ligne', 'numerique--inexistant'], publics: ['tous-publics', 'martiens'] }), unknown);
    expect(s).toMatchObject({ nom: 'Atelier numérique', producer: 'dora', authority: 'PLATEFORME_DECLARATIVE', attribution: 'déclaré par la structure sur DORA', type: 'Atelier', frais: 'Gratuit', modes: ['En présentiel'],
      publics: ['Tous publics'], categories: ['Numérique'], updatedAt: '2026-09-01', link: 'https://dora.inclusion.gouv.fr/services/x' });
    expect(s.themes).toHaveLength(1);
    expect(unknown).toEqual({ 'thematique:numerique--inexistant': 1, 'public:martiens': 1 });
    const text = JSON.stringify(s);
    for (const banned of ['texte libre', 'Jean Dupont', 'jean.dupont', '+336']) expect(text).not.toContain(banned);
    expect(serviceOf(svc({ lien_source: 'http://dora.example/x' })).link, 'only https links').toBeNull();
  });
});

describe('data·inclusion — the services of a record', () => {
  const places = [{ id: 'dora--p1', source: 'dora', link: null }, { id: 'france-travail--p2', source: 'france-travail', link: null }];
  const servicesOf = new Map([
    ['dora--p1', [serviceOf(svc()), serviceOf(svc({ id: 'dora--old', nom: 'Ancien service', date_maj: Date.parse('2023-01-01') })), serviceOf(svc({ id: 'dora--dup', nom: 'Accompagnement emploi', thematiques: ['trouver-un-emploi--repondre-a-des-offres-demploi'] }))]],
    ['france-travail--p2', [serviceOf(svc({ id: 'ft--1', source: 'france-travail', nom: 'Accompagnement Emploi', thematiques: ['trouver-un-emploi--repondre-a-des-offres-demploi'] }))]],
  ]);

  it('leaves out a service not updated for two years, lists the same service once with the producer of highest authority, public operators first', () => {
    const r = servicesFor(places, servicesOf, { asOf: '2026-10-20' });
    expect(FRESH_DAYS).toBe(730);
    expect(r.stale).toBe(1); expect(r.duplicates).toBe(1);
    expect(r.services.map((s) => [s.nom, s.producer])).toEqual([['Accompagnement Emploi', 'france-travail'], ['Atelier numérique', 'dora']]);
  });

  it('is the same value for the same content whatever the order of keys (no new version for nothing), and the public part has no bookkeeping', () => {
    const v = servicesValue({ version: '2026-10-20', placeList: places, servicesOf });
    const reordered = Object.fromEntries(Object.entries(v).reverse());   // as PostgreSQL's jsonb gives it back: same content, other order of keys
    reordered.services = v.services.map((s) => Object.fromEntries(Object.entries(s).reverse()));
    expect(sameServices(v, reordered)).toBe(true);
    expect(sameServices(v, { ...v, services: v.services.slice(1) })).toBe(false);
    expect(sameServices(v, { ...v, export: '2026-10-27' }), 'a later export with the same services is the same content').toBe(true);
    const pub = publicServices(v);
    expect(Object.keys(pub).sort()).toEqual(['dataset', 'export', 'licence', 'services']);
    expect(pub.services[0]).toMatchObject({ nom: 'Accompagnement Emploi', attribution: 'selon France Travail', producer: 'France Travail' });
    expect(publicServices({ ...v, services: [] })).toBeNull();
    expect(publicServices(null)).toBeNull();
  });
});

describe('data·inclusion — optional restricted API adapter', () => {
  it('requests nothing without a token', async () => {
    let called = 0; const fetchImpl = async () => { called += 1; return new Response('{}'); };
    expect(await apiStructures({ env: {}, fetchImpl })).toMatchObject({ ok: false, code: 'NO_TOKEN' });
    expect(called).toBe(0);
  });

  it('pages through the API with the bearer token, keeps the same fields as the export (no contacts), says when the token is refused', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push([String(url), init.headers.Authorization]);
      const u = new URL(String(url)); const page = Number(u.searchParams.get('page'));
      if (u.pathname === '/api/v1/structures') return new Response(JSON.stringify({ items: [{ id: `dora--p${page}`, source: 'dora', nom: 'Lieu', siret: '77564183000440', code_postal: '67000', code_insee: '67482', telephone: '+33388000000', courriel: 'a.b@exemple.fr' }], total: 2, page, size: 1, pages: 2 }), { status: 200 });
      return new Response(JSON.stringify({ items: [svc()], total: 1, page: 1, size: 1, pages: 1 }), { status: 200 });
    };
    const r = await apiStructures({ env: { DATA_INCLUSION_API_TOKEN: 'tok' }, fetchImpl, size: 1 });
    expect(r).toMatchObject({ ok: true, total: 2 });
    expect(r.items.map((x) => x.id)).toEqual(['dora--p1', 'dora--p2']);
    expect(JSON.stringify(r.items)).not.toMatch(/courriel|telephone|a\.b@exemple|\+3388/);
    expect(seen[0][0]).toContain('https://api.data.inclusion.gouv.fr/api/v1/structures?code_departement=67&page=1');
    expect(seen[0][1]).toBe('Bearer tok');
    const s = await apiServices({ env: { DATA_INCLUSION_API_TOKEN: 'tok' }, fetchImpl });
    expect(s.items[0]).toMatchObject({ structureId: 'dora--p1', service: expect.objectContaining({ attribution: 'déclaré par la structure sur DORA' }) });
    expect(await apiStructures({ env: { DATA_INCLUSION_API_TOKEN: 'bad' }, fetchImpl: async () => new Response('', { status: 401 }) })).toMatchObject({ ok: false, code: 'TOKEN_REFUSED' });
  });
});
