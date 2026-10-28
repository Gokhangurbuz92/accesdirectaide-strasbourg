// @ts-nocheck
/**
 * PKG-6 / A14 D21 — metrics of the LOCAL model (Ollama on 127.0.0.1): what the citizen assistant and the FALC drafts actually did, measured on real runs.
 *
 * One AiMetric row per event, written fire-and-forget (never blocks or fails a request):
 *   type          `${feature}.${outcome}`  e.g. assistant.answered, assistant.abstained, assistant.blocked, assistant.error, falc.drafted, falc.fallback
 *   model         the local model, or 'none' when no model was called (a guard or a missing source stopped the request first)
 *   latency_ms    the model call only (0 when no model was called)
 *   error_message a reason CODE from a closed vocabulary (snake_case, ≤ 64 chars), never message text, prompt, answer or identifier
 *   tokens        as reported by the local provider; the cost of a local run is 0
 * Retention: AiMetric is purged after 90 days (cron/gdpr-purge). Kept apart from gemini-metrics.js: the citizen assistant never touches the Gemini code path.
 */
import logger from '../_utils/logger.js';
import { visibleSql } from './publicVisibility.js';

export const LOCAL_FEATURES = ['assistant', 'falc'];
export const LOCAL_OUTCOMES = ['answered', 'abstained', 'blocked', 'error', 'drafted', 'fallback'];
const CODE = /^[a-z0-9_]{1,64}$/;
const MODEL = /^[A-Za-z0-9._:-]{1,64}$/;
const int = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Math.trunc(Number(v)), 2_147_483_647) : 0);

/** @type {null | ((row: Record<string, any>) => Promise<unknown>)} */
let sink = null;
/** Tests inject a sink; null restores the database. */
export function _setLocalMetricsSink(fn) { sink = fn; }

/**
 * The row stored for an event, or null when the event is not one of the declared kinds. Free text cannot reach the table.
 * @param {{ feature: string, outcome: string, reason?: string, model?: string | null, latencyMs?: number, usage?: { promptTokens?: number, completionTokens?: number } }} e
 */
export function toMetricRow(e) {
  if (!LOCAL_FEATURES.includes(e?.feature) || !LOCAL_OUTCOMES.includes(e?.outcome)) return null;
  const model = typeof e.model === 'string' && MODEL.test(e.model) ? e.model : 'none';
  const promptTokens = int(e.usage?.promptTokens); const completionTokens = int(e.usage?.completionTokens);
  return {
    type: `${e.feature}.${e.outcome}`,
    model,
    promptTokens, completionTokens, totalTokens: promptTokens + completionTokens,
    latencyMs: model === 'none' ? 0 : int(e.latencyMs),
    success: e.outcome !== 'error',
    circuitBreakerOpen: false,
    errorMessage: typeof e.reason === 'string' && CODE.test(e.reason) ? e.reason : (e.reason ? 'other' : null),
  };
}

/** Fire-and-forget: records the event, swallows any storage error. */
export function recordLocalAiEvent(e) {
  const row = toMetricRow(e); if (!row) return;
  const write = sink || (async (r) => {
    const [{ db }, { AiMetric }] = await Promise.all([import('../../src/db/index.js'), import('../../src/db/schema.js')]);
    await db.insert(AiMetric).values(r);
  });
  Promise.resolve().then(() => write(row)).catch((err) => logger.debug?.({ err: err?.message }, '[LOCAL-AI-METRICS] not stored'));
}

/**
 * Aggregates for the admin page: the last `days` days of local events, latency percentiles of real model calls, reason codes, and RAG index coverage of the publicly visible aides.
 * @param {{ db?: any, days?: number }} [opts]
 */
export async function getLocalAiMetrics({ db, days = 30 } = {}) {
  const { sql } = await import('drizzle-orm');
  if (!db) ({ db } = await import('../../src/db/index.js'));
  const d = Math.min(Math.max(1, Math.trunc(Number(days) || 30)), 90);
  const since = sql`NOW() - make_interval(days => ${d})`;
  const local = sql`(type LIKE 'assistant.%' OR type LIKE 'falc.%')`;
  const pub = visibleSql('aide');   // "published" = what the public actually sees (D-5), not statut alone
  const rows = async (q) => (await db.execute(q)).rows;
  const [byType, latency, reasons, byModel, coverage] = await Promise.all([
    rows(sql`SELECT type, count(*)::int AS n FROM "AiMetric" WHERE ${local} AND "createdAt" > ${since} GROUP BY type ORDER BY type`),
    rows(sql`SELECT split_part(type, '.', 1) AS feature, count(*)::int AS calls,
               COALESCE(percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p50,
               COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p95,
               COALESCE(max(latency_ms), 0)::int AS max
             FROM "AiMetric" WHERE ${local} AND model <> 'none' AND "createdAt" > ${since} GROUP BY 1 ORDER BY 1`),
    rows(sql`SELECT type, error_message AS reason, count(*)::int AS n FROM "AiMetric" WHERE ${local} AND error_message IS NOT NULL AND "createdAt" > ${since} GROUP BY 1, 2 ORDER BY n DESC, 1, 2 LIMIT 50`),
    rows(sql`SELECT model, count(*)::int AS n, COALESCE(sum(total_tokens), 0)::bigint AS tokens FROM "AiMetric" WHERE ${local} AND model <> 'none' AND "createdAt" > ${since} GROUP BY 1 ORDER BY 1`),
    rows(sql`SELECT 'aide' AS entity, count(*)::int AS total,
               count(*) FILTER (WHERE ${pub})::int AS published,
               count(*) FILTER (WHERE ${pub} AND embedding IS NOT NULL)::int AS published_embedded,
               count(*) FILTER (WHERE embedding IS NOT NULL AND COALESCE(embedding_model, 'LEGACY_UNKNOWN') = 'LEGACY_UNKNOWN')::int AS embedded_unknown_model
             FROM "Aide"`),
  ]);
  const counts = Object.fromEntries(byType.map((r) => [r.type, r.n]));
  const a = (o) => counts[`assistant.${o}`] || 0;
  const assistantTotal = ['answered', 'abstained', 'blocked', 'error'].reduce((s, o) => s + a(o), 0);
  const rate = (n) => (assistantTotal ? Math.round((n / assistantTotal) * 1000) / 10 : null);
  const cov = coverage[0] || {};
  return {
    windowDays: d,
    counts,
    assistant: { total: assistantTotal, answeredPct: rate(a('answered')), abstainedPct: rate(a('abstained')), blockedPct: rate(a('blocked')), errorPct: rate(a('error')) },
    falc: { drafted: counts['falc.drafted'] || 0, fallback: counts['falc.fallback'] || 0 },
    latencyMs: latency.map((r) => ({ feature: r.feature, calls: r.calls, p50: r.p50, p95: r.p95, max: r.max })),
    reasons,
    models: byModel.map((r) => ({ model: r.model, calls: r.n, tokens: Number(r.tokens), costUsd: 0 })),
    rag: {
      aides: cov.total || 0, published: cov.published || 0, publishedEmbedded: cov.published_embedded || 0,
      publishedCoveragePct: cov.published ? Math.round((cov.published_embedded / cov.published) * 1000) / 10 : null,
      embeddedUnknownModel: cov.embedded_unknown_model || 0,
    },
  };
}
