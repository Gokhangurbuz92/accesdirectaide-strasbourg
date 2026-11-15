/**
 * A-31 on REAL PostgreSQL — "PartnershipRequest".website / .email are NOT NULL: a suggestion sent without them (both optional) was a 500.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const NAME = `PU A31 structure ${Date.now()}`;

describe.skipIf(!hasDatabase)('suggest-structure without website / e-mail (real DB)', () => {
  /** @type {any} */ let db;
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "PartnershipRequest" WHERE "structureName" = ${NAME}`); });

  it('is recorded with empty website and e-mail instead of a 500', async () => {
    ({ db } = await import('../../src/db/index.js'));
    const { default: handler } = await import('../../api/_handlers/public/suggest-structure.js');
    const res = { statusCode: 200, body: /** @type {any} */ (null), status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
    await handler({ method: 'POST', url: '/api/public/suggest-structure', headers: { host: 'localhost', 'x-forwarded-for': '198.51.100.231' }, body: { structureName: NAME, city: 'Strasbourg', consent: true } }, res);
    expect(res.statusCode).toBe(200);
    const row = (await db.execute(sql`SELECT website, email, consent, status FROM "PartnershipRequest" WHERE id = ${res.body.id}`)).rows[0];
    expect(row).toEqual({ website: '', email: '', consent: true, status: 'pending' });
  });
});
