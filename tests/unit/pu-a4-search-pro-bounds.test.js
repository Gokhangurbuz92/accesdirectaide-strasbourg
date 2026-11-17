/**
 * A-4 (P05, P08) — POST /api/search-pro was an unthrottled, unvalidated public POST behind an unlinked page. It is now rate-limited per address and its
 * body is bounded (a malformed body is a 400 before any query); its page /trouver-aide redirects to the canonical « par besoin » entry, the page file is
 * gone and the route left the restricted-beta allowlist.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ execute: vi.fn(async () => ({ rows: [] })) }));
vi.mock('../../src/db/index.js', () => ({ db }));

import handler, { searchProSchema } from '../../api/_handlers/search-pro.js';
import { isAllowedInPublicBeta } from '../../api/_utils/public-beta.js';

const root = process.cwd();
const call = async (body, ip = '203.0.113.7') => {
  const res = { statusCode: 200, body: /** @type {any} */ (null), status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
  await handler({ method: 'POST', url: '/api/search-pro', headers: { 'x-forwarded-for': ip }, body }, res);
  return res;
};
let n = 0;
const freshIp = () => `198.51.100.${++n}`;
beforeEach(() => db.execute.mockClear());

describe('A-4: /api/search-pro input bounds', () => {
  it.each([
    ['needs is not an array', { needs: 'logement' }, 'needs'],
    ['more than 20 needs', { needs: Array.from({ length: 21 }, (_, i) => `n${i}`) }, 'needs'],
    ['a need that is not a slug', { needs: ["x'); DROP TABLE"] }, 'needs'],
    ['an over-long audience', { audiences: ['a'.repeat(65)] }, 'audiences'],
    ['a non-string modality', { modalities: [{ a: 1 }] }, 'modalities'],
    ['a territory that is not text (it used to throw: 500)', { territory: 67 }, 'territory'],
    ['an over-long territory', { territory: 'x'.repeat(81) }, 'territory'],
    ['an over-long free text', { q: 'x'.repeat(121) }, 'q'],
    ['a free text that is not text (it used to throw: 500)', { q: ['a'] }, 'q'],
    ['a page beyond the ceiling', { page: 100000 }, 'page'],
    ['a limit beyond the ceiling', { limit: 5000 }, 'limit'],
  ])('%s → 400, no query', async (_label, body, field) => {
    const res = await call(body, freshIp());
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'Invalid payload', code: 'VALIDATION_ERROR' });
    expect(res.body.fields).toContain(field);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('a well-formed body is searched (the values the retired page sent stay valid)', async () => {
    const res = await call({ needs: ['logement', 'acces-aux-droits'], audiences: ['jeunes'], modalities: ['sur-place'], territory: '67', q: 'accueil', page: 1, limit: 12 }, freshIp());
    expect(res.statusCode).toBe(200);
    expect(db.execute).toHaveBeenCalled();
    expect(searchProSchema.safeParse({}).success).toBe(true);
    expect(searchProSchema.safeParse({ page: '2', limit: '50' }).data).toMatchObject({ page: 2, limit: 50 });
  });
});

describe('A-4: /api/search-pro is rate-limited per address', () => {
  it('the 31st call in a minute from one address is refused (429) before any query; another address is not affected', async () => {
    const ip = freshIp();
    for (let i = 0; i < 30; i += 1) expect((await call({ q: 'accueil' }, ip)).statusCode).toBe(200);
    db.execute.mockClear();
    const refused = await call({ q: 'accueil' }, ip);
    expect(refused.statusCode).toBe(429);
    expect(refused.body.code).toBe('RATE_LIMITED');
    expect(db.execute).not.toHaveBeenCalled();
    expect((await call({ q: 'accueil' }, freshIp())).statusCode).toBe(200);
  });
});

describe('A-4: the orphan page is retired', () => {
  const routes = readFileSync(join(root, 'src/pages/index.jsx'), 'utf8');
  it('/trouver-aide redirects to /besoins and the duplicate page is gone', () => {
    expect(routes).toMatch(/<Route path="\/trouver-aide" element=\{<Navigate to="\/besoins" replace \/>\} \/>/);
    expect(routes).not.toMatch(/RechercheAide/);
    expect(existsSync(join(root, 'src/pages/RechercheAide.jsx'))).toBe(false);
  });
  it('nothing in src/ calls /api/search-pro any more, and the restricted beta no longer lets it through', () => {
    const walk = (/** @type {string} */ dir) => require('node:fs').readdirSync(dir, { withFileTypes: true }).flatMap((/** @type {any} */ e) => (e.isDirectory() ? (e.name === 'locales' ? [] : walk(join(dir, e.name))) : /\.(jsx?|tsx?)$/.test(e.name) ? [join(dir, e.name)] : []));
    const callers = walk(join(root, 'src')).filter((f) => /search-pro/.test(readFileSync(f, 'utf8')));
    expect(callers).toEqual([]);
    expect(isAllowedInPublicBeta('POST', 'search-pro')).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'search')).toBe(true);
  });
});
