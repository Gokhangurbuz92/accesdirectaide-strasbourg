import { describe, expect, it } from 'vitest';
import { buildNewsFeed, enrichItem, loadRegistry, relatedTo } from '../../api/_services/news/feed.js';

const now = new Date('2026-11-11T12:00:00Z');
const day = (d, h = 9) => new Date(Date.UTC(2026, 10, d, h)).toISOString();
const SP = { id: 'sp', name: 'Service-Public', publisher: 'Service-Public.fr (DILA)', hosts: ['www.service-public.gouv.fr'], status: 'approved', scope: 'FRANCE',
  rights: { headline: true, excerpt: true, fullText: true, images: false }, evidenceUrl: 'https://www.service-public.gouv.fr/P10025', verifiedAt: '2026-10-31', licence: 'Licence Ouverte 2.0' };
const EU = { id: 'eu', name: 'Commission européenne', publisher: 'Commission européenne', hosts: ['ec.europa.eu'], status: 'approved', scope: 'EU',
  rights: { headline: true, excerpt: true, fullText: true, images: false }, evidenceUrl: 'https://commission.europa.eu/legal-notice_fr', verifiedAt: '2026-11-11', licence: 'CC BY 4.0' };
const PRESS = { id: 'press', name: 'Presse', publisher: 'Journal Exemple', hosts: ['www.journal.example'], status: 'approved', scope: 'WORLD',
  rights: { headline: false, excerpt: false, fullText: false, images: false }, evidenceUrl: 'https://www.journal.example/cgu', verifiedAt: '2026-11-11' };
const BLOCKED = { id: 'gre', name: 'Région', hosts: ['www.grandest.fr'], status: 'blocked' };
const registry = loadRegistry([SP, EU, PRESS, BLOCKED]);
const row = (o) => ({ statut: 'publie', type_actu: 'info', resume: 'Résumé de l’éditeur.', contenu: '<p>Texte</p>', image_url: null, est_important: false, ...o });

describe('Actualités v2 feed — rights decide what a visitor receives', () => {
  it('lane A: the licensed item with its licence and evidence; a feed image is NOT shown when images are not granted', () => {
    const c = enrichItem(row({ id: '1', titre: 'APL : nouveau barème', canonical_url: 'https://www.service-public.gouv.fr/particuliers/actualites/A1', image_url: 'https://www.service-public.gouv.fr/x.jpg', date_publication: day(10) }), registry, now);
    expect(c).toMatchObject({ lane: 'A', titre: 'APL : nouveau barème', licence: 'Licence Ouverte 2.0', rightsEvidenceUrl: SP.evidenceUrl, image: null });
    expect(c.geo.scope).toBe('france'); expect(c.topics).toContain('logement');
  });
  it('lane B: never the publisher’s title, words or image — publisher, date and link only', () => {
    const c = enrichItem(row({ id: '2', titre: 'Titre protégé', resume: 'Chapô protégé', canonical_url: 'https://www.journal.example/a', image_url: 'https://www.journal.example/p.jpg', date_publication: day(10) }), registry, now);
    expect(c).toMatchObject({ lane: 'B', titre: null, resume: null, image: null, externalOnly: true, publisher: 'Journal Exemple' });
    expect(JSON.stringify(c)).not.toMatch(/protégé/);
  });
  it('blocked or unknown source: not shown at all', () => {
    expect(enrichItem(row({ id: '3', titre: 'x', canonical_url: 'https://www.grandest.fr/a', date_publication: day(10) }), registry, now)).toBeNull();
    expect(enrichItem(row({ id: '4', titre: 'x', canonical_url: 'https://unknown.example/a', date_publication: day(10) }), registry, now)).toBeNull();
  });
  it('an image is shown only with its recorded rights (credit, licence, alt); an AI illustration is flagged', () => {
    const img = { url: 'https://upload.wikimedia.org/x.jpg', alt: 'Façade', credit: 'Photo X', licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', kind: 'commons' };
    const ada = (image) => enrichItem(row({ id: '5', type_actu: 'ada_original', titre: 'Explication', canonical_url: null, date_publication: day(10), raw_payload_json: { ada: { image, sources: [{ publisher: 'INSEE', url: 'https://www.insee.fr/x' }] } } }), registry, now);
    expect(ada(img).image).toMatchObject({ credit: 'Photo X', kind: 'commons', aiGenerated: false });
    expect(ada({ ...img, credit: '' }).image).toBeNull();
    expect(ada({ ...img, kind: 'ai', credit: 'Illustration générée par IA', licence: 'ADA' }).image.aiGenerated).toBe(true);
    expect(ada({ ...img, url: 'javascript:alert(1)' }).image).toBeNull();
  });
  it('ADA article: its sources (https only) and corrections; drafts never reach the feed builder (statut filter is upstream)', () => {
    const c = enrichItem(row({ id: '6', type_actu: 'ada_original', titre: 'Comprendre le RSA', date_publication: day(10),
      raw_payload_json: { ada: { sources: [{ publisher: 'Service-Public', url: 'https://www.service-public.gouv.fr/x' }, { publisher: 'Bad', url: 'javascript:x' }], corrections: [{ at: day(11), note: 'Montant corrigé' }], editorial: { approvedAt: day(10) } } } }), registry, now);
    expect(c.lane).toBe('ADA'); expect(c.ada.sources).toHaveLength(1); expect(c.ada.corrections[0].note).toBe('Montant corrigé'); expect(c.publisher).toBe('AccesDirectAide');
  });
});

describe('Actualités v2 feed — stories, filters, balance', () => {
  const rows = [
    row({ id: 'a', titre: 'RSA : revalorisation de 1,7 % au 1er avril', canonical_url: 'https://www.service-public.gouv.fr/particuliers/actualites/A2', date_publication: day(10, 10) }),
    row({ id: 'b', titre: 'Revalorisation du RSA de 1,7 % au 1er avril', canonical_url: 'https://www.journal.example/rsa', date_publication: day(10, 9) }),
    row({ id: 'c', titre: 'Ukraine : la Commission annonce une aide humanitaire', canonical_url: 'https://ec.europa.eu/commission/presscorner/1', date_publication: day(9) }),
    row({ id: 'd', titre: 'Strasbourg : nouveau point France services', canonical_url: 'https://www.service-public.gouv.fr/particuliers/actualites/A3', date_publication: day(8) }),
    row({ id: 'e', titre: 'Article d’un journal seul', canonical_url: 'https://www.journal.example/seul', date_publication: day(7) }),
  ];
  it('one card per story; the press report is listed under « Sources et couverture » without its title; a lone press link is no card', () => {
    const f = buildNewsFeed(rows, {}, registry, now);
    expect(f.items.map((i) => i.id)).not.toContain('b'); expect(f.items.map((i) => i.id)).not.toContain('e');
    const rsa = f.items.find((i) => i.id === 'a');
    expect(rsa.coverage).toEqual([{ publisher: 'Journal Exemple', url: 'https://www.journal.example/rsa', date: rows[1].date_publication, lane: 'B' }]);
    expect(JSON.stringify(f)).not.toContain('_t');
  });
  it('place filters: France includes Alsace; Monde is the EU/Ukraine item; Alsace is Strasbourg', () => {
    expect(buildNewsFeed(rows, { geo: 'monde' }, registry, now).items.map((i) => i.id)).toEqual(['c']);
    expect(buildNewsFeed(rows, { geo: 'alsace' }, registry, now).items.map((i) => i.id)).toEqual(['d']);
    expect(buildNewsFeed(rows, { geo: 'france' }, registry, now).items.map((i) => i.id).sort()).toEqual(['a', 'd']);
  });
  it('category, source, dates, search, counts', () => {
    const f = buildNewsFeed(rows, { topic: 'international' }, registry, now);
    expect(f.items.map((i) => i.id)).toEqual(['c']); expect(f.facets.topics.droits).toBeGreaterThan(0);
    expect(buildNewsFeed(rows, { source: 'commission' }, registry, now).items.map((i) => i.id)).toEqual(['c']);
    expect(buildNewsFeed(rows, { from: '2026-11-09', to: '2026-11-09' }, registry, now).items.map((i) => i.id)).toEqual(['c']);
    expect(buildNewsFeed(rows, { q: 'revalorisation rsa', sort: 'relevant' }, registry, now).items[0].id).toBe('a');
  });
  it('pagination is bounded (max 50)', () => {
    const f = buildNewsFeed(rows, { pageSize: 500, page: 1 }, registry, now);
    expect(f.pageSize).toBe(50);
  });
  it('related: shares a category or the place, never itself', () => {
    const f = buildNewsFeed(rows, { group: true }, registry, now).items;
    const a = f.find((i) => i.id === 'a');
    expect(relatedTo(a, f).map((i) => i.id)).not.toContain('a');
  });
});
