#!/usr/bin/env node
// PKG-11 / D16 — operator: measure retrieval on the PROPOSED evaluation set (data/search-eval/retrieval-eval.v1.json) in a LAB database.
// Usage: DATABASE_URL=postgresql://…@127.0.0.1/… node scripts/search-eval.mjs [--semantic]
// The synthetic documents are inserted as visible fixtures under a unique prefix, measured (lexical; hybrid with the LOCAL model when --semantic), then deleted.
// Refuses a database that is not on this machine. The result is evidence of the mechanism on a small synthetic set, not of real-world quality (D18 review open).
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { evaluateRetrieval, localOllamaEmbedder, rebuildAideIndex } from '../api/lib/retrieval-index.js';
import { searchAidesHybrid } from '../api/lib/hybrid-search.js';

const dbHost = new URL(process.env.DATABASE_URL || 'postgresql://x@invalid/x').hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(dbHost)) { console.error('refused: search-eval runs only against a database on this machine'); process.exit(2); }
const semantic = process.argv.includes('--semantic');
const SET = JSON.parse(readFileSync(new URL('../data/search-eval/retrieval-eval.v1.json', import.meta.url), 'utf8'));
const tag = `seval-${Date.now()}`; const slug = (k) => `${tag}-${k}`; const keyOf = (s) => (String(s || '').startsWith(`${tag}-`) ? String(s).slice(tag.length + 1) : null);
const model = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
try {
  for (const d of SET.documents) {
    await db.execute(sql`INSERT INTO "Aide" (id, slug, titre, categorie, cest_quoi, pour_qui, ce_que_ca_aide, mots_cles, statut, launch_eligible, verification_status, verified_by, territory_verified, date_verification, data_origin, source_url, "updatedAt")
      VALUES (${slug(d.key)}, ${slug(d.key)}, ${d.titre}, ${d.categorie}, ${d.cest_quoi}, ${d.pour_qui}, ${d.ce_que_ca_aide}, ${`{${d.mots_cles.map((m) => `"${m}"`).join(',')}}`}::text[], 'publie', true, 'VERIFIED', 'search-eval', true, NOW(), 'official', 'https://www.service-public.fr/', NOW())`);
  }
  const out = { set: SET.version, status: SET.status, documents: SET.documents.length, queries: SET.queries.length };
  const lexical = await evaluateRetrieval({ queries: SET.queries, search: async (q) => (await searchAidesHybrid({ query: q, limit: 10 })).items.map((i) => keyOf(i.slug)).filter(Boolean) });
  out.lexical = { recallAt5: lexical.recallAtK, mrr: lexical.mrr, misses: lexical.perQuery.filter((p) => p.recall < 1).map((p) => p.q) };
  if (semantic) {
    const embed = localOllamaEmbedder({ model });
    out.rebuild = await rebuildAideIndex({ db, embed, model, limit: 5000 });
    const [only] = await Promise.all([evaluateRetrieval({ queries: SET.queries, search: async (q) => {
      const [v] = await embed([q]);
      return (await db.execute(sql`SELECT slug FROM "Aide" WHERE slug LIKE ${`${tag}-%`} AND embedding IS NOT NULL AND embedding_model = ${model} ORDER BY embedding <=> ${`[${v.map((x) => Number(x).toFixed(8)).join(',')}]`}::vector LIMIT 10`)).rows.map((r) => keyOf(r.slug));
    } })]);
    out.semanticOnly = { recallAt5: only.recallAtK, mrr: only.mrr, misses: only.perQuery.filter((p) => p.recall < 1).map((p) => p.q) };
    const hybrid = await evaluateRetrieval({ queries: SET.queries, search: async (q) => { const [v] = await embed([q]); return (await searchAidesHybrid({ query: q, limit: 10, embedding: v, embeddingModel: model })).items.map((i) => keyOf(i.slug)).filter(Boolean); } });
    out.hybrid = { recallAt5: hybrid.recallAtK, mrr: hybrid.mrr, misses: hybrid.perQuery.filter((p) => p.recall < 1).map((p) => p.q) };
  }
  console.log('SEARCH_EVAL_RESULT ' + JSON.stringify(out));
} finally {
  await db.execute(sql`DELETE FROM "Aide" WHERE slug LIKE ${`${tag}-%`}`).catch(() => {});
  process.exit(0);
}
