/**
 * PKG-11 / D16 — rebuild of the aide index and retrieval evaluation on REAL PostgreSQL + pgvector. The embedder is a deterministic STUB (hashed bag of words,
 * 768 dimensions): it proves the rebuild and the hybrid path, NOT semantic quality (the local model is measured by scripts/search-eval.mjs outside QA).
 *  - only visible aides are embedded; a re-run changes nothing; a changed text or a new model re-embeds exactly what changed; a wrong-dimension vector is refused;
 *  - lexical retrieval over the proposed evaluation set (data/search-eval/retrieval-eval.v1.json) is measured and must stay at or above its recorded floor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const SET = JSON.parse(readFileSync('data/search-eval/retrieval-eval.v1.json', 'utf8'));
const slugOf = (key) => `d16-${TS}-${key}`;
const keyOf = (slug) => (String(slug || '').startsWith(`d16-${TS}-`) ? String(slug).slice(`d16-${TS}-`.length) : null);
/** deterministic 768-d hashed bag of words (accents folded), L2-normalized */
const stubVector = (text) => {
  const v = new Array(768).fill(0);
  for (const w of String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) || []) v[crypto.createHash('md5').update(w).digest().readUInt16BE(0) % 768] += 1;
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1; return v.map((x) => x / n);
};
const stubEmbed = async (texts) => texts.map(stubVector);
// Measured 2026-10-23 on this set: before the PKG-11 / D16 repair of the lexical fallback (ILIKE on the whole query) recall@5 0.19 / MRR 0.19; after it 1.00 / 1.00.
// The floors catch a regression on this small synthetic set; they are not a claim about real-world quality (D18 human review of the set is open).
const LEXICAL_FLOOR = { recallAt5: 0.9, mrr: 0.9 };

describe.skipIf(!hasDatabase)('PKG-11 / D16 retrieval index (real DB, stub embedder)', () => {
  let db, idx, hybrid;
  const ours = async () => (await db.execute(sql`SELECT slug, embedding IS NOT NULL AS has, embedding_model AS m, embedded_text_sha256 AS h FROM "Aide" WHERE slug LIKE ${`d16-${TS}-%`} ORDER BY slug`)).rows;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    idx = await import('../../api/lib/retrieval-index.js'); hybrid = await import('../../api/lib/hybrid-search.js');
    for (const d of SET.documents) {
      await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, categorie, cest_quoi, pour_qui, ce_que_ca_aide, mots_cles, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, "updatedAt")
        VALUES (${slugOf(d.key)}, ${slugOf(d.key)}, ${d.titre}, ${d.categorie}, ${d.cest_quoi}, ${d.pour_qui}, ${d.ce_que_ca_aide}, ${`{${d.mots_cles.map((m) => `"${m}"`).join(',')}}`}::text[], 'publie', true, 'VERIFIED', 'reviewer-seed@example.test', true, NOW() - interval '3 days', 'official', 'https://www.service-public.fr/particuliers/vosdroits/F1', NOW())`);
    }
    // unverified and of official origin: invisible in every content mode (lab shows only unclassified / synthetic fixtures without verification)
    await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, cest_quoi, statut, data_origin, "updatedAt") VALUES (${slugOf('hidden')}, ${slugOf('hidden')}, 'Aide non vérifiée D16 mutuelle', 'Texte non vérifié : mutuelle gratuite.', 'publie', 'official', NOW())`);
  }, 60000);
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "Aide" WHERE slug LIKE ${`d16-${TS}-%`}`).catch(() => {}); });

  it('rebuild: visible aides only; a re-run changes nothing; a changed text re-embeds that record; a new model re-embeds all; a wrong vector is refused', async () => {
    const first = await idx.rebuildAideIndex({ db, embed: stubEmbed, model: 'qa-stub-v1' });
    expect(first.embedded).toBeGreaterThanOrEqual(SET.documents.length); expect(first.failed).toBe(0);
    let rows = await ours();
    expect(rows.filter((r) => r.slug !== slugOf('hidden')).every((r) => r.has && r.m === 'qa-stub-v1' && /^[0-9a-f]{64}$/.test(r.h))).toBe(true);
    expect(rows.find((r) => r.slug === slugOf('hidden'))).toMatchObject({ has: false, h: null });   // an unverified aide is never embedded
    expect((await idx.rebuildAideIndex({ db, embed: stubEmbed, model: 'qa-stub-v1' })).embedded).toBe(0);
    await db.execute(sql`UPDATE "Aide" SET cest_quoi = cest_quoi || ' Texte revu.' WHERE slug = ${slugOf('apl')}`);
    const changed = await idx.rebuildAideIndex({ db, embed: stubEmbed, model: 'qa-stub-v1' });
    expect([changed.embedded, changed.reasons]).toEqual([1, { TEXT_CHANGED: 1 }]);
    const dry = await idx.rebuildAideIndex({ db, embed: stubEmbed, model: 'qa-stub-v2', dryRun: true });
    expect(dry.reasons.MODEL_CHANGED).toBeGreaterThanOrEqual(SET.documents.length); expect(dry.embedded).toBe(0);
    const bad = await idx.rebuildAideIndex({ db, embed: async (t) => t.map(() => [0.1, 0.2]), model: 'qa-stub-bad', limit: 5000 });
    expect(bad.embedded).toBe(0); expect(bad.failed).toBeGreaterThanOrEqual(SET.documents.length);
    rows = await ours(); expect(rows.filter((r) => r.m === 'qa-stub-bad')).toHaveLength(0);
  });

  it('lexical retrieval over the proposed evaluation set stays at or above its recorded floor', async () => {
    const search = async (q) => (await hybrid.searchAidesHybrid({ query: q, limit: 10 })).items.map((i) => keyOf(i.slug)).filter(Boolean);
    const m = await idx.evaluateRetrieval({ search, queries: SET.queries, k: 5 });
    console.log('[D16] lexical', JSON.stringify({ recallAt5: Number(m.recallAtK.toFixed(3)), mrr: Number(m.mrr.toFixed(3)), misses: m.perQuery.filter((p) => p.recall < 1).map((p) => p.q) }));
    expect(m.queries).toBe(16);
    expect(m.recallAtK).toBeGreaterThanOrEqual(LEXICAL_FLOOR.recallAt5); expect(m.mrr).toBeGreaterThanOrEqual(LEXICAL_FLOOR.mrr);
  });

  it('the hybrid path uses the stored vectors (stub: the mechanism, not the quality)', async () => {
    await idx.rebuildAideIndex({ db, embed: stubEmbed, model: 'qa-stub-v1', limit: 5000 });
    const r = await hybrid.searchAidesHybrid({ query: 'mutuelle gratuite', limit: 10, embedding: stubVector('mutuelle gratuite'), embeddingModel: 'qa-stub-v1' });
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.some((i) => (i.semanticScore ?? 0) > 0)).toBe(true);
    expect(r.items.map((i) => i.slug)).not.toContain(slugOf('hidden'));
  });
});
