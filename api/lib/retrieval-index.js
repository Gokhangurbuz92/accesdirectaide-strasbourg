// @ts-nocheck
/**
 * PKG-11 / D16 — the semantic index of the aides, rebuilt from what people can see, and measured. Before: embeddings were written by the ingestion of the moment,
 * never rebuilt; nothing told a stale vector (the record changed since) from a current one, and there was no evaluation set to say how good retrieval is.
 *   - rebuildAideIndex: only D-5-VISIBLE aides are embedded (an unverified or held record never is); a record is re-embedded when it has no vector, when the
 *     model changed, or when the exact text it was embedded from changed (SHA-256 kept beside the vector); everything else is left alone (idempotent);
 *     a vector of the wrong dimension is refused, never stored;
 *   - the embedder is injected: the operator script (scripts/reindex-embeddings.mjs) uses the LOCAL model only; tests use a deterministic stub;
 *   - evaluateRetrieval: recall@k and MRR of a search function over a judged query set (data/search-eval/retrieval-eval.v1.json, PROPOSED — not reviewed).
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { visibleSql } from './publicVisibility.js';

export const DIMENSION = 768;
const TEXT_FIELDS = ['titre', 'cest_quoi', 'pour_qui', 'ce_que_ca_aide', 'summary_falc'];

/** The exact text an aide is embedded from (same order, normalized spaces). */
export function embeddingTextOf(row) {
  return [...TEXT_FIELDS.map((f) => row?.[f]), (row?.mots_cles || []).join(' ')].map((v) => String(v || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, 12000);
}
export const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** The visible aides that need a (new) vector for `model`. */
export async function staleVisibleAides(db, model, { limit = 1000 } = {}) {
  const rows = (await db.execute(sql`SELECT id, titre, cest_quoi, pour_qui, ce_que_ca_aide, summary_falc, mots_cles, embedding_model, embedded_text_sha256, (embedding IS NULL) AS missing
    FROM "Aide" WHERE ${visibleSql('aide')} ORDER BY id LIMIT ${limit}`)).rows;
  const out = { visible: rows.length, stale: [] };
  for (const r of rows) {
    const text = embeddingTextOf(r); const hash = sha256(text);
    const why = r.missing ? 'MISSING' : r.embedding_model !== model ? 'MODEL_CHANGED' : r.embedded_text_sha256 !== hash ? 'TEXT_CHANGED' : null;
    if (why && text) out.stale.push({ id: r.id, text, hash, why });
  }
  return out;
}

/**
 * @param {{ db: any, embed: (texts: string[]) => Promise<number[][]>, model: string, limit?: number, batchSize?: number, dryRun?: boolean }} opts
 */
export async function rebuildAideIndex({ db, embed, model, limit = 1000, batchSize = 16, dryRun = false }) {
  if (!model || typeof embed !== 'function') throw new Error('rebuildAideIndex: an embedder and its model name are required');
  const { visible, stale } = await staleVisibleAides(db, model, { limit });
  const summary = { model, visible, stale: stale.length, reasons: {}, embedded: 0, failed: 0, upToDate: visible - stale.length, dryRun };
  for (const s of stale) summary.reasons[s.why] = (summary.reasons[s.why] || 0) + 1;
  if (dryRun) return summary;
  for (let i = 0; i < stale.length; i += batchSize) {
    const batch = stale.slice(i, i + batchSize);
    let vectors;
    try { vectors = await embed(batch.map((b) => b.text)); } catch { summary.failed += batch.length; continue; }
    for (let j = 0; j < batch.length; j += 1) {
      const v = vectors?.[j];
      if (!Array.isArray(v) || v.length !== DIMENSION || !v.every((x) => Number.isFinite(x))) { summary.failed += 1; continue; }
      const literal = `[${v.map((x) => Number(x).toFixed(8)).join(',')}]`;
      await db.execute(sql`UPDATE "Aide" SET embedding = ${literal}::vector, embedding_model = ${model}, embedded_text_sha256 = ${batch[j].hash}, embedded_at = NOW() WHERE id = ${batch[j].id}`);
      summary.embedded += 1;
    }
  }
  return summary;
}

/**
 * Recall@k (share of the judged relevant documents found in the top k) and MRR (1 / rank of the first relevant one) of `search` over `queries`.
 * @param {{ search: (q: string) => Promise<string[]>, queries: Array<{ q: string, relevant: string[] }>, k?: number }} opts
 */
export async function evaluateRetrieval({ search, queries, k = 5 }) {
  const perQuery = [];
  for (const { q, relevant } of queries) {
    const ranked = (await search(q)).slice(0, Math.max(k, 10));
    const top = ranked.slice(0, k);
    const found = relevant.filter((r) => top.includes(r)).length;
    const first = ranked.findIndex((key) => relevant.includes(key));
    perQuery.push({ q, recall: relevant.length ? found / relevant.length : 1, rr: first >= 0 && first < 10 ? 1 / (first + 1) : 0, top });
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return { k, queries: perQuery.length, recallAtK: mean(perQuery.map((p) => p.recall)), mrr: mean(perQuery.map((p) => p.rr)), perQuery };
}

/**
 * The LOCAL embedding model (Ollama on this machine) — the only embedder the operator scripts accept: an address that is not loopback is refused, there is no
 * cloud fallback. Returns an embed(texts) function for rebuildAideIndex.
 */
export function localOllamaEmbedder({ url = process.env.OLLAMA_EMBED_URL || 'http://127.0.0.1:11434/api/embeddings', model = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text', fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) throw new Error(`refused: the embedding model must run on this machine (got ${host})`);
  return async (texts) => {
    const out = [];
    for (const prompt of texts) {
      const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt }), signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`local embedding failed (${r.status})`);
      out.push((await r.json()).embedding);
    }
    return out;
  };
}
