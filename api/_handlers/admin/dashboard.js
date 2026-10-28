// @ts-nocheck
/**
 * Admin Dashboard — GET /api/admin/dashboard
 *
 * Aggregates all operational metrics into a single JSON response:
 * health, data counts, AI metrics (24h), crons, recent errors.
 */
import { verifyAdmin } from '../../_utils/auth.js';
import { db } from '../../../src/db/index.js';
import { sql } from 'drizzle-orm';
import { getLogs } from '../../lib/log-store.js';

const TIMEOUT_MS = 10_000;

export default async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await verifyAdmin(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const [health, data, ai, crons, recentErrors] = await Promise.all([
      getHealth(),
      getDataCounts(),
      getAiMetrics24h(),
      getCronStatus(),
      getRecentErrors(),
    ]);

    clearTimeout(timeout);

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      status: health.db && health.kv ? 'healthy' : 'degraded',
      health,
      data,
      ai,
      crons,
      recentErrors,
    });
  } catch (err) {
    clearTimeout(timeout);
    return res.status(500).json({ error: 'Dashboard failed', detail: err.message });
  }
}

async function getHealth() {
  const result = { db: false, kv: false, latencyDbMs: 0, latencyKvMs: 0 };

  // Test DB
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    result.db = true;
    result.latencyDbMs = Date.now() - start;
  } catch { /* noop */ }

  // Test KV
  try {
    const { Redis } = await import('@upstash/redis');
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (url && token) {
      const redis = new Redis({ url, token });
      const start = Date.now();
      await redis.ping();
      result.kv = true;
      result.latencyKvMs = Date.now() - start;
    }
  } catch { /* noop */ }

  return result;
}

async function getDataCounts() {
  const tables = ['Aide', 'Structure', 'Demarche', 'Actualite', 'CitizenUser', 'ProUser'];
  const counts = {};

  for (const table of tables) {
    try {
      const rows = await db.execute(sql.raw(`SELECT COUNT(*) as c FROM "${table}"`));
      // @ts-ignore
      counts[table.toLowerCase()] = Number(rows.rows?.[0]?.c ?? rows[0]?.c ?? 0);
    } catch {
      // @ts-ignore
      counts[table.toLowerCase()] = -1;
    }
  }

  // Average quality score for Aide
  try {
    const rows = await db.execute(sql`SELECT AVG(quality_score) as avg FROM "Aide"`);
    counts.aideAvgQuality = Math.round(Number(rows.rows?.[0]?.avg ?? rows[0]?.avg ?? 0));
  } catch {
    counts.aideAvgQuality = 0;
  }

  return counts;
}

async function getAiMetrics24h() {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = await db.execute(
      sql.raw(`SELECT
        COUNT(*) as total,
        SUM(total_tokens) as tokens,
        AVG(latency_ms) as avg_latency,
        COUNT(*) FILTER (WHERE success = false) as errors,
        COUNT(*) FILTER (WHERE circuit_breaker_open = true) as cb_open
      FROM "AiMetric" WHERE "createdAt" >= '${cutoff}'`),
    );
    const r = rows.rows?.[0] ?? rows[0] ?? {};
    const total = Number(r.total || 0);
    const tokens = Number(r.tokens || 0);
    const errors = Number(r.errors || 0);
    return {
      totalRequests24h: total,
      totalTokens24h: tokens,
      estimatedCostUsd: Math.round(tokens * 0.00000035 * 100) / 100, // Gemini Flash pricing
      avgLatencyMs: Math.round(Number(r.avg_latency || 0)),
      errorRatePct: total > 0 ? Math.round((errors / total) * 10000) / 100 : 0,
      circuitBreakerOpen: Number(r.cb_open || 0) > 0,
    };
  } catch {
    return { totalRequests24h: 0, totalTokens24h: 0, estimatedCostUsd: 0, avgLatencyMs: 0, errorRatePct: 0, circuitBreakerOpen: false };
  }
}

async function getCronStatus() {
  try {
    const rows = await db.execute(
      sql.raw(`SELECT job, MAX("startedAt") as last_run
        FROM "CronRun" GROUP BY job ORDER BY last_run DESC`),
    );
    const crons = {};
    for (const r of rows.rows ?? rows ?? []) {
      crons[r.job] = r.last_run;
    }
    return crons;
  } catch {
    return {};
  }
}

async function getRecentErrors() {
  try {
    const logs = await getLogs(100);
    return logs.filter((l) => l.level === 'error' || l.level === 'critical').slice(0, 5);
  } catch {
    return [];
  }
}
