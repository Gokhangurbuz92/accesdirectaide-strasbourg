#!/usr/bin/env node
// PKG-11 / D16 — operator: rebuild the aide index from what people can see (api/lib/retrieval-index.js). Only D-5-visible aides are embedded; unchanged
// records are left alone.
//
// Local (default): DATABASE_URL=… node scripts/reindex-embeddings.mjs [--dry-run] [--limit=1000]
//   LOCAL embedding model only (Ollama on this machine, nomic-embed-text, column "embedding"); nothing is sent outside this machine.
//
// G14-AI — Cloudflare Workers AI (@cf/baai/bge-m3, column "embedding_m3", migration 0060), gated like a job (fail-closed):
//   DATABASE_URL=… AI_PROVIDER=workers_ai AI_WORKERS_PRODUCTION_APPROVED=true CF_WORKERS_AI_ACCOUNT_ID=… CF_WORKERS_AI_TOKEN=… KV_REST_API_URL=… KV_REST_API_TOKEN=… \
//     node scripts/reindex-embeddings.mjs --provider=workers_ai [--apply] [--limit=1000]
//   - without --apply: a dry run (what is stale, the estimated neurons, today's remaining budget) — no call to Cloudflare;
//   - with --apply: refused unless the Workers AI policy is enabled, the shared KV counter is configured and the estimate fits today's remaining budget;
//     every request goes through the same daily neuron counter as the assistant (api/lib/workers-ai.js). Only public, verified fiche texts are sent.
//   Cost: bge-m3 is 1 075 neurons per million tokens — ~1 000 aides of ~600 tokens ≈ 650 neurons, once; later runs re-embed changed fiches only.
import { db } from '../src/db/index.js';
import { localOllamaEmbedder, rebuildAideIndex, staleVisibleAides, INDEX_TARGETS } from '../api/lib/retrieval-index.js';

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const limit = Number(args.get('limit') || 1000);

if (args.get('provider') === 'workers_ai') {
  const { workersAiState } = await import('../api/lib/ai-policy.js');
  const { workersAiEmbed, neuronsFor, estimateTokens, dailyUsage, WORKERS_AI_MODELS } = await import('../api/lib/workers-ai.js');
  const { kv } = await import('../api/_utils/kv.js');
  const model = WORKERS_AI_MODELS.embedding;
  const target = INDEX_TARGETS.m3;
  const { visible, stale } = await staleVisibleAides(db, model, { limit, target });
  const estimate = neuronsFor(model, stale.reduce((n, s) => n + estimateTokens(s.text.slice(0, 8000)), 0));
  const state = workersAiState(process.env);
  const usage = kv.isRemote ? await dailyUsage() : null;
  const plan = { provider: 'workers_ai', model, visible, stale: stale.length, estimatedNeurons: estimate, policy: state.enabled ? 'ENABLED' : state.reason, sharedCounter: kv.isRemote, todayRemaining: usage?.remaining ?? null };
  if (!args.get('apply')) { console.log('REINDEX_PLAN ' + JSON.stringify({ ...plan, dryRun: true })); process.exit(0); }
  const refusal = !state.enabled ? `Workers AI not enabled (${state.reason})` : !kv.isRemote ? 'the shared KV counter is not configured (KV_REST_API_URL / KV_REST_API_TOKEN)'
    : estimate > usage.remaining ? `estimate ${estimate} neurons exceeds today's remaining budget ${usage.remaining}: run with --limit or tomorrow` : null;
  if (refusal) { console.log('REINDEX_REFUSED ' + JSON.stringify({ ...plan, reason: refusal })); process.exit(2); }
  const summary = await rebuildAideIndex({ db, embed: (texts) => workersAiEmbed(texts.map((t) => t.slice(0, 8000)), { timeoutMs: 30000 }), model, limit, target });
  console.log('REINDEX_RESULT ' + JSON.stringify(summary));
  process.exit(summary.failed ? 1 : 0);
}

const model = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const summary = await rebuildAideIndex({ db, embed: localOllamaEmbedder({ model }), model, limit, dryRun: Boolean(args.get('dry-run')) });
console.log('REINDEX_RESULT ' + JSON.stringify(summary));
process.exit(summary.failed ? 1 : 0);
