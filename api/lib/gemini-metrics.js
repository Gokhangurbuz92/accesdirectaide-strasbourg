// @ts-nocheck
/**
 * Gemini AI Metrics — persistent DB storage with in-memory fallback.
 *
 * Records token counts, latency, and errors to the AiMetric table.
 * Uses fire-and-forget inserts so metrics never block API responses.
 *
 * Pricing based on Gemini 2.0 Flash (March 2026):
 *   Input  : $0.10 / 1M tokens
 *   Output : $0.40 / 1M tokens
 */

import logger from '../_utils/logger.js';

// Pricing per token (USD)
const PRICING = {
  inputPerToken: 0.10 / 1_000_000,
  outputPerToken: 0.40 / 1_000_000,
};

/** @type {(() => Promise<import('drizzle-orm/node-postgres').NodePgDatabase>) | null} */
let _getDb = null;

/** @type {(() => any) | null} */
let _getTable = null;

/**
 * Lazy-load DB & schema to avoid import cycles and allow mocking.
 */
function getDbAndTable() {
  if (!_getDb) {
    _getDb = async () => {
      const { db } = await import('../../src/db/index.js');
      return db;
    };
  }
  if (!_getTable) {
    _getTable = () => {
      // Dynamic import is cached by Node
      return import('../../src/db/schema.js').then(m => m.AiMetric);
    };
  }
  return { getDb: _getDb, getTable: _getTable };
}

// ─── In-memory fallback (for tests and when DB is unavailable) ────────────
const MAX_ENTRIES = 1000;

/** @type {Array<Record<string, any>>} */
const memoryBuffer = [];

/** Whether to use DB persistence (set to false in tests) */
let _useDb = true;

/**
 * @typedef {{
 *   type: string,
 *   model?: string,
 *   promptTokens?: number,
 *   completionTokens?: number,
 *   totalTokens?: number,
 *   latencyMs?: number,
 *   success?: boolean,
 *   circuitBreakerOpen?: boolean,
 *   error?: string,
 * }} MetricInput
 */

/**
 * Record a Gemini API call metric.
 * Fire-and-forget: never blocks the caller.
 * @param {MetricInput} data
 */
export function recordMetric(data) {
  const entry = {
    type: data.type || 'unknown',
    model: data.model || 'gemini-2.0-flash',
    promptTokens: data.promptTokens || 0,
    completionTokens: data.completionTokens || 0,
    totalTokens: data.totalTokens || 0,
    latencyMs: data.latencyMs || 0,
    success: data.success !== false,
    circuitBreakerOpen: data.circuitBreakerOpen === true,
    errorMessage: data.error || null,
  };

  // Always keep in memory for fast reads
  memoryBuffer.push({ ...entry, timestamp: new Date().toISOString() });
  if (memoryBuffer.length > MAX_ENTRIES) {
    memoryBuffer.splice(0, memoryBuffer.length - MAX_ENTRIES);
  }

  // Fire-and-forget DB insert
  if (_useDb) {
    _persistToDb(entry).catch((err) => {
      logger.warn({ err: err?.message }, '[AI-METRICS] DB persist failed, kept in memory');
    });
  }
}

/**
 * Persist a metric entry to the database.
 * @param {Record<string, any>} entry
 */
async function _persistToDb(entry) {
  const { getDb, getTable } = getDbAndTable();
  const [db, AiMetric] = await Promise.all([getDb(), getTable()]);
  await db.insert(AiMetric).values(entry);
}

/**
 * Get aggregated metrics from the database.
 * Falls back to in-memory buffer if DB is unavailable.
 */
export async function getMetrics() {
  if (_useDb) {
    try {
      return await _getDbMetrics();
    } catch (err) {
      logger.warn({ err: err?.message }, '[AI-METRICS] DB query failed, returning in-memory stats');
      // R12: say where the figures come from — the counters of this one process are not the service's figures
      return { ..._getMemoryMetrics(), source: 'memory', degraded: true };
    }
  }
  return { ..._getMemoryMetrics(), source: 'memory', degraded: _useDb };
}

/**
 * Get metrics from DB via SQL aggregation.
 */
async function _getDbMetrics() {
  const { getDb, getTable } = getDbAndTable();
  const [db, AiMetric] = await Promise.all([getDb(), getTable()]);
  const { sql } = await import('drizzle-orm');
  // PKG-6 / A14: local-model events (assistant.*, falc.*: local-ai-metrics.js) share the table; they are not Gemini calls and cost nothing.
  const notLocal = sql`${AiMetric.type} NOT LIKE 'assistant.%' AND ${AiMetric.type} NOT LIKE 'falc.%'`;

  // Run all aggregation queries in parallel
  const [totals, byType, last24h, cbTrips] = await Promise.all([
    // Total aggregations
    db.select({
      totalRequests: sql`COUNT(*)`.as('totalRequests'),
      totalPromptTokens: sql`COALESCE(SUM(${AiMetric.promptTokens}), 0)`.as('totalPromptTokens'),
      totalCompletionTokens: sql`COALESCE(SUM(${AiMetric.completionTokens}), 0)`.as('totalCompletionTokens'),
      totalTokens: sql`COALESCE(SUM(${AiMetric.totalTokens}), 0)`.as('totalTokens'),
      totalLatency: sql`COALESCE(SUM(${AiMetric.latencyMs}), 0)`.as('totalLatency'),
      errorCount: sql`COUNT(*) FILTER (WHERE ${AiMetric.success} = false)`.as('errorCount'),
    }).from(AiMetric).where(notLocal),

    // By type
    db.select({
      type: AiMetric.type,
      requests: sql`COUNT(*)`.as('requests'),
      tokens: sql`COALESCE(SUM(${AiMetric.totalTokens}), 0)`.as('tokens'),
      errors: sql`COUNT(*) FILTER (WHERE ${AiMetric.success} = false)`.as('errors'),
    }).from(AiMetric).where(notLocal).groupBy(AiMetric.type),

    // Last 24h
    db.select({
      requests: sql`COUNT(*)`.as('requests'),
      tokens: sql`COALESCE(SUM(${AiMetric.totalTokens}), 0)`.as('tokens'),
    }).from(AiMetric).where(sql`${notLocal} AND ${AiMetric.createdAt} > NOW() - INTERVAL '24 hours'`),

    // Circuit breaker trips
    db.select({
      count: sql`COUNT(*)`.as('count'),
    }).from(AiMetric).where(sql`${notLocal} AND ${AiMetric.circuitBreakerOpen} = true`),
  ]);

  const row = totals[0] || {};
  const totalRequests = Number(row.totalRequests) || 0;
  const totalPromptTokens = Number(row.totalPromptTokens) || 0;
  const totalCompletionTokens = Number(row.totalCompletionTokens) || 0;
  const totalTokensSum = Number(row.totalTokens) || 0;
  const totalLatency = Number(row.totalLatency) || 0;
  const errorCount = Number(row.errorCount) || 0;

  const estimatedCostUsd =
    totalPromptTokens * PRICING.inputPerToken +
    totalCompletionTokens * PRICING.outputPerToken;

  /** @type {Record<string, { requests: number, tokens: number, errors: number }>} */
  const byTypeMap = {};
  for (const r of byType) {
    byTypeMap[r.type] = {
      requests: Number(r.requests) || 0,
      tokens: Number(r.tokens) || 0,
      errors: Number(r.errors) || 0,
    };
  }

  const l24 = last24h[0] || {};

  return {
    total_requests: totalRequests,
    total_prompt_tokens: totalPromptTokens,
    total_completion_tokens: totalCompletionTokens,
    total_tokens: totalTokensSum,
    estimated_cost_usd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
    avg_latency_ms: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
    error_rate_pct: totalRequests > 0 ? Math.round((errorCount / totalRequests) * 10000) / 100 : 0,
    by_type: byTypeMap,
    last_24h: { requests: Number(l24.requests) || 0, tokens: Number(l24.tokens) || 0 },
    circuit_breaker_trips: Number(cbTrips[0]?.count) || 0,
    storage: 'database',
  };
}

/**
 * Get metrics from in-memory buffer (fallback).
 */
function _getMemoryMetrics() {
  const now = Date.now();
  const h24Ago = now - 24 * 60 * 60 * 1000;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalLatency = 0;
  let errorCount = 0;
  let cbTrips = 0;
  let last24hRequests = 0;
  let last24hTokens = 0;

  /** @type {Record<string, { requests: number, tokens: number, errors: number }>} */
  const byType = {};

  for (const entry of memoryBuffer) {
    totalPromptTokens += entry.promptTokens || 0;
    totalCompletionTokens += entry.completionTokens || 0;
    totalTokens += entry.totalTokens || 0;
    totalLatency += entry.latencyMs || 0;
    if (!entry.success) errorCount++;
    if (entry.circuitBreakerOpen) cbTrips++;

    if (!byType[entry.type]) {
      byType[entry.type] = { requests: 0, tokens: 0, errors: 0 };
    }
    byType[entry.type].requests++;
    byType[entry.type].tokens += entry.totalTokens || 0;
    if (!entry.success) byType[entry.type].errors++;

    const ts = new Date(entry.timestamp).getTime();
    if (ts >= h24Ago) {
      last24hRequests++;
      last24hTokens += entry.totalTokens || 0;
    }
  }

  const totalRequests = memoryBuffer.length;
  const estimatedCostUsd =
    totalPromptTokens * PRICING.inputPerToken +
    totalCompletionTokens * PRICING.outputPerToken;

  return {
    total_requests: totalRequests,
    total_prompt_tokens: totalPromptTokens,
    total_completion_tokens: totalCompletionTokens,
    total_tokens: totalTokens,
    estimated_cost_usd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
    avg_latency_ms: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
    error_rate_pct: totalRequests > 0 ? Math.round((errorCount / totalRequests) * 10000) / 100 : 0,
    by_type: byType,
    last_24h: { requests: last24hRequests, tokens: last24hTokens },
    circuit_breaker_trips: cbTrips,
    buffer_size: totalRequests,
    buffer_max: MAX_ENTRIES,
    storage: 'memory',
  };
}

/**
 * Reset metrics (for testing).
 */
export function resetMetrics() {
  memoryBuffer.length = 0;
}

/**
 * Disable DB persistence (for unit tests).
 * @param {boolean} value
 */
export function _setUseDb(value) {
  _useDb = value;
}
