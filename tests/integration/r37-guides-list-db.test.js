/**
 * R37 — the public guide list is the whole published catalogue. Production 02/11/2026: 70 guides published, /api/guides returned the 50 newest, so the 20
 * oldest were missing from /bonnes-pratiques and from the published count. Synthetic guides only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const N = String(Date.now()).slice(-7);
const COUNT = 60;
function mkRes() { return { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } }; }

describe.skipIf(!hasDatabase)('public guide list (real DB)', () => {
  let db; let handler;
  const get = async (url) => { const res = mkRes(); await handler({ method: 'GET', url, headers: { host: 'localhost' }, query: Object.fromEntries(new URL(url, 'http://x').searchParams) }, res); return res; };
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    handler = (await import('../../api/_handlers/guides.js')).default;
    for (let i = 0; i < COUNT; i++) {
      await db.execute(sql`INSERT INTO "Guide" (id, slug, titre, statut, categorie, publics, contexte, mots_cles, sources_urls, contenu_json, published_at, "createdAt", "updatedAt")
        VALUES (${`r37g-${N}-${i}`}, ${`r37g-${N}-${i}`}, ${`Guide R37 ${N} ${i}`}, ${i === 0 ? 'brouillon' : 'publie'}, 'r37-test', '{}', '{}', '{}', '{}', '[]'::jsonb, NOW() - (${i} || ' minutes')::interval, NOW(), NOW())`);
    }
  });
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "Guide" WHERE id LIKE ${`r37g-${N}-%`}`); });

  it('lists every published guide, beyond 50, and never a draft', async () => {
    const all = (await get('/api/guides')).body.filter((g) => g.slug.startsWith(`r37g-${N}-`));
    expect(all).toHaveLength(COUNT - 1);
    expect(all.some((g) => g.slug === `r37g-${N}-0`)).toBe(false);
    expect(all.some((g) => g.slug === `r37g-${N}-${COUNT - 1}`)).toBe(true);   // the oldest one, which the former cap of 50 dropped
    expect((await get('/api/guides?categorie=r37-test')).body).toHaveLength(COUNT - 1);
  });
});
