/**
 * SRCH-DISP-1 — the public search (/recherche, api/_handlers/search.js) never returned Dispositif records: « carte vitale » did not find the published
 * official fiche « Carte Vitale ». The dispositifs are now a group of their own (type 'dispositif', link /dispositifs/<slug>), searched with the word
 * search of the démarches and restricted by EXACTLY the public rule of the dispositifs list (visibleSql('dispositif'): published, verified,
 * launch-eligible, not on hold, real origin) — never wider.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';

const calls = [];
let responder = () => ({ rows: [] });
vi.mock('../../src/db/index.js', () => ({ db: { execute: vi.fn(async (q) => { calls.push(q); return responder(q, calls.length); }) } }));

const render = (q) => new PgDialect().sqlToQuery(q);
const { searchDispositifs } = await import('../../api/lib/search-query.js');
const { visibleSql } = await import('../../api/lib/publicVisibility.js');

describe('SRCH-DISP-1 — searchDispositifs', () => {
  beforeEach(() => { calls.length = 0; });

  it('applies the public rule of the dispositifs list, unchanged, and the word search of the query', async () => {
    const rows = [
      { id: 'd1', slug: 'carte-vitale', titre: 'Carte Vitale', summary_falc: 'La carte de l’Assurance maladie.', description_falc: 'Texte long.' },
    ];
    responder = (q) => {
      const { sql: text } = render(q);
      if (text.includes('information_schema')) return { rows: [{ ok: false }] };
      if (text.includes('AS best')) return { rows: [{ best: 2 }] };
      return { rows };
    };
    const { items } = await searchDispositifs({ q: 'carte vitale', page: 1, pageSize: 5 });
    expect(items).toEqual([{ id: 'd1', slug: 'carte-vitale', titre: 'Carte Vitale', description: 'La carte de l’Assurance maladie.' }]);

    const main = render(calls[calls.length - 1]);
    expect(main.sql).toMatch(/FROM "Dispositif"/);
    // the exact public condition of api/_handlers/dispositifs/index.js (visibleSql('dispositif')) is part of the query
    const visible = render(visibleSql('dispositif')).sql.replace(/\$\d+/g, '?');
    expect(main.sql.replace(/\$\d+/g, '?')).toContain(visible);
    // hidden records are excluded by that condition: on hold, not verified, not launch-eligible, synthetic/unclassified, not published
    expect(main.sql).toContain('"publication_hold" IS NULL');
    expect(main.sql).toContain('"verification_status" = \'VERIFIED\'');
    expect(main.sql).toContain('"launch_eligible" = true');
    expect(main.sql).toMatch(/"data_origin" NOT IN/);
    expect(main.params).toContain('publie');
    expect(main.params).toEqual(expect.arrayContaining(['%carte%', '%vitale%']));
    // the best-match level is computed over the visible records only
    const best = render(calls.find((q) => render(q).sql.includes('AS best')));
    expect(best.sql.replace(/\$\d+/g, '?')).toContain(visible);
    expect(main.params).toContain(5);   // small page
  });

  it('withholds a simplified text that asserts a right, falls back to the description, and shortens a long text', async () => {
    responder = (q) => {
      const { sql: text } = render(q);
      if (text.includes('information_schema')) return { rows: [{ ok: false }] };
      if (text.includes('AS best')) return { rows: [{ best: 1 }] };
      return { rows: [
        { id: 'a', slug: 'ald', titre: 'ALD', summary_falc: 'Vous avez droit à une prise en charge.', description_falc: 'Prise en charge à 100 %.' },
        { id: 'b', slug: 'sad', titre: 'SAD', summary_falc: 'null', description_falc: 'x'.repeat(400) },
      ] };
    };
    const { items } = await searchDispositifs({ q: 'prise en charge' });
    expect(items[0].description).toBe('Prise en charge à 100 %.');
    expect(items[1].description.length).toBeLessThanOrEqual(240);
    expect(items[1].description.endsWith('…')).toBe(true);
  });

  it('a query with no meaningful word reads nothing and returns nothing', async () => {
    const { items } = await searchDispositifs({ q: 'aide pour' });
    expect(items).toEqual([]);
    expect(calls.filter((q) => render(q).sql.includes('"Dispositif"') && !render(q).sql.includes('information_schema'))).toEqual([]);
  });

  it('the public list handler uses the same rule (no second, wider definition)', () => {
    const list = readFileSync('api/_handlers/dispositifs/index.js', 'utf8');
    expect(list).toMatch(/const where = \[visibleSql\('dispositif'\)\];/);
    const src = readFileSync('api/lib/search-query.js', 'utf8');
    expect(src).toMatch(/const conditions = \[visibleSql\('dispositif'\)\];/);
  });
});

describe('SRCH-DISP-1 — the search handler returns a dispositifs group', () => {
  it('lists the dispositifs with their type and their public page, and keys the cache on the new shape', async () => {
    vi.resetModules();
    const cacheParams = [];
    vi.doMock('../../src/db/index.js', () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }));
    vi.doMock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })), getClientIp: () => '127.0.0.1' }));
    vi.doMock('../../api/lib/EmbeddingProvider.js', () => ({ generateEmbedding: vi.fn(async () => null), getActiveEmbeddingModel: () => 'test' }));
    vi.doMock('../../api/lib/hybrid-search.js', () => ({ searchAidesHybrid: vi.fn(async () => ({ items: [], total: 0, weakResult: true })) }));
    vi.doMock('../../api/lib/search-cache.js', () => ({ cachedSearch: vi.fn(async (params, fn) => { cacheParams.push(params); return { data: await fn(), cached: false }; }) }));
    const searchDispositifsMock = vi.fn(async () => ({ items: [
      { id: 'd1', slug: 'carte-vitale', titre: 'Carte Vitale', description: 'La carte de l’Assurance maladie.' },
      { id: 'd2', slug: null, titre: 'Sans page', description: null },
    ] }));
    vi.doMock('../../api/lib/search-query.js', async (importOriginal) => ({
      ...(await importOriginal()),
      searchDemarches: vi.fn(async () => ({ items: [], total: 0 })),
      searchStructures: vi.fn(async () => ({ items: [], total: 0 })),
      searchDispositifs: searchDispositifsMock,
      bestMatchCondition: vi.fn(async () => ({ queryChunks: [] })),
    }));
    const { default: handler } = await import('../../api/_handlers/search.js');
    const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
    await handler({ method: 'POST', body: { query: 'carte vitale' }, headers: {}, socket: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(searchDispositifsMock).toHaveBeenCalledWith({ q: 'carte vitale', page: 1, pageSize: 5 });
    expect(res.body.dispositifs).toEqual([
      { id: 'd1', slug: 'carte-vitale', title: 'Carte Vitale', description: 'La carte de l’Assurance maladie.', url: '/dispositifs/carte-vitale', type: 'dispositif' },
    ]);
    expect(Object.keys(res.body)).toEqual(expect.arrayContaining(['items', 'demarches', 'dispositifs', 'structures', 'actualites', 'guides', 'glossaire']));
    expect(cacheParams[0].shape).toBe(2);   // a result cached before the group existed is never served

    // a query without a meaningful word does not search the dispositifs
    searchDispositifsMock.mockClear();
    await handler({ method: 'POST', body: { query: 'aide pour' }, headers: {}, socket: {} }, res);
    expect(searchDispositifsMock).not.toHaveBeenCalled();
    expect(res.body.dispositifs).toEqual([]);
  });
});
