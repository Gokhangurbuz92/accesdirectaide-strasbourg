/**
 * PKG-1 repairs of the FIRST native run (20261018T192252Z-2ede5b): each case pins a defect that only real PostgreSQL / real Chrome revealed.
 * (The real-PG / Chrome proofs themselves stay in tests/integration/pkg1-*-db.test.js and DTA-B19/B20.)
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { getProvenance } from '../../src/lib/provenance.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('LAB_UNVERIFIED survives the double normalisation done by the detail pages', () => {
  const api = { provenance: { contentStatus: 'LAB_UNVERIFIED', verifiedAt: null, sourceUrl: null }, date_verification: '2026-10-01T00:00:00.000Z' };
  it('keeps the server content status through getProvenance(getProvenance(x))', () => {
    const once = getProvenance(api);
    const twice = getProvenance({ provenance: once });
    expect(twice.contentStatus).toBe('LAB_UNVERIFIED');
  });
  it('never turns a legacy edit/import date into a verification date for an unverified record', () => {
    expect(getProvenance(api).verifiedAt).toBeNull();
  });
  it('a verified record keeps its verification date', () => {
    const p = getProvenance({ provenance: { contentStatus: 'VERIFIED', verifiedAt: '2026-10-01T00:00:00.000Z' } });
    expect(p.contentStatus).toBe('VERIFIED'); expect(p.verifiedAt).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('search-pro never hands a bare JS array to = ANY(...) (drizzle renders it as a row on real PostgreSQL)', () => {
  it('uses explicit IN lists', () => { expect(src('api/_handlers/search-pro.js')).not.toMatch(/ANY\(\$\{/); });
});

describe('citizen account API contract', () => {
  const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
  it('every account endpoint answers GET (the auth check runs first: an anonymous caller is 401, not 405) and GET /profile has the same { account } shape as PUT', async () => {
    vi.resetModules();
    vi.doMock('../../api/_utils/citizen-auth.js', () => ({ requireCitizen: async (_q, res) => { res.status(401).json({ error: 'unauthorized' }); return null; } }));
    vi.doMock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
    vi.doMock('../../src/db/index.js', () => ({ db: {} }));
    for (const h of ['profile', 'household', 'preferences', 'shares']) {
      const handler = (await import(`../../api/_handlers/citizen/${h}.js`)).default;
      const r = mk(); await handler({ method: 'GET', headers: {} }, r);
      expect(r.statusCode, h).toBe(401);
    }
    expect(src('api/_handlers/citizen/profile.js')).toMatch(/account: await getAccount/);
    vi.doUnmock('../../api/_utils/citizen-auth.js'); vi.doUnmock('../../api/_utils/rateLimit.js'); vi.doUnmock('../../src/db/index.js');
  });
  it('the 500 log keeps the database diagnosis (SQLSTATE / constraint) without row data', () => {
    expect(src('api/_utils/citizen-handler.js')).toMatch(/cause\.code/);
  });
});
