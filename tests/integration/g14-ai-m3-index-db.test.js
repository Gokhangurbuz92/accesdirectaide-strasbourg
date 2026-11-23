/**
 * G14-AI — the bge-m3 index of the aides (migration 0060, "Aide".embedding_m3 vector(1024)) on REAL PostgreSQL + pgvector, with a deterministic STUB embedder
 * (no Cloudflare call): only visible aides are embedded, a re-run changes nothing, the 768-d local index is never touched, and searchAidesHybrid ranks with the
 * m3 column when the query vector is bge-m3 (and never compares a 1024-d vector with the 768-d column).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const slug = (k) => `g14ai-${TS}-${k}`;
const M3 = '@cf/baai/bge-m3';
const stub = (text) => {
  const v = new Array(1024).fill(0);
  for (const w of String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) || []) v[crypto.createHash('md5').update(w).digest().readUInt16BE(0) % 1024] += 1;
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1; return v.map((x) => x / n);
};

describe.skipIf(!hasDatabase)('G14-AI bge-m3 index (real DB, stub embedder)', () => {
  let db; let idx; let hybrid;
  const ours = async () => (await db.execute(sql`SELECT slug, embedding_m3 IS NOT NULL AS m3, embedding IS NOT NULL AS local, embedding_m3_sha256 AS h FROM "Aide" WHERE slug LIKE ${`g14ai-${TS}-%`} ORDER BY slug`)).rows;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    idx = await import('../../api/lib/retrieval-index.js'); hybrid = await import('../../api/lib/hybrid-search.js');
    const ins = (k, titre, texte) => db.execute(sql`INSERT INTO "Aide" (id, slug, titre, categorie, cest_quoi, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, "updatedAt")
      VALUES (${slug(k)}, ${slug(k)}, ${titre}, 'logement', ${texte}, 'publie', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW() - interval '2 days', 'official', 'https://www.service-public.fr/particuliers/vosdroits/F1', NOW())`);
    await ins('loyer', 'Aide au loyer zorglub', 'Une aide pour payer le loyer zorglub chaque mois.');
    await ins('cantine', 'Aide à la cantine', 'Une aide pour les repas de la cantine scolaire.');
    await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, cest_quoi, statut, data_origin, "updatedAt") VALUES (${slug('hidden')}, ${slug('hidden')}, 'Non vérifiée', 'zorglub', 'publie', 'official', NOW())`);
  }, 60000);
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "Aide" WHERE slug LIKE ${`g14ai-${TS}-%`}`).catch(() => {}); });

  it('rebuild into embedding_m3: visible aides only, idempotent, the local column untouched', async () => {
    const first = await idx.rebuildAideIndex({ db, model: M3, target: idx.INDEX_TARGETS.m3, embed: async (t) => t.map(stub), limit: 100000 });
    expect(first.failed).toBe(0);
    const rows = await ours();
    expect(rows.filter((r) => r.slug !== slug('hidden')).every((r) => r.m3 && /^[0-9a-f]{64}$/.test(r.h))).toBe(true);
    expect(rows.find((r) => r.slug === slug('hidden'))).toMatchObject({ m3: false, h: null });
    expect(rows.every((r) => r.local === false)).toBe(true);
    expect((await idx.rebuildAideIndex({ db, model: M3, target: idx.INDEX_TARGETS.m3, embed: async (t) => t.map(stub), limit: 100000 })).embedded).toBe(0);
  });

  it('searchAidesHybrid ranks a bge-m3 query vector against embedding_m3', async () => {
    const r = await hybrid.searchAidesHybrid({ query: 'zorglub', limit: 5, embedding: stub('Aide au loyer zorglub Une aide pour payer le loyer zorglub chaque mois.'), embeddingModel: M3 });
    const hit = r.items.find((x) => x.slug === slug('loyer'));
    expect(hit).toBeTruthy();
    expect(hit.semanticScore).toBeGreaterThan(0.5);
    expect(r.items.some((x) => x.slug === slug('hidden'))).toBe(false);
  });
});
