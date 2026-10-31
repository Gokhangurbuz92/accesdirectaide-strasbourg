// @ts-nocheck
import logger from '../../_utils/logger.js';
import crypto from 'crypto';
import { getCronAuth, getHeader, scheduledByVercel } from '../../_utils/cronAuth.js';
import { withLock } from '../../_utils/pipelineLock.js';
import { db } from '../../../src/db/index.js';
import { CronRun, Actualite } from '../../../src/db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { env } from '../../_utils/env.js';
import Sentry from '../../_utils/sentry.js';
import { kv } from '../../_utils/kv.js';
import { runIngestActualitesRss } from './ingest-actualites-rss.js';
import { verifyNewsDrafts } from '../../_services/news-verification.js';

const CRON_LOCK_KEY = 'cron:actualites:lock';
const CRON_LOCK_TTL_SECONDS = 15 * 60; // 15 minutes
const CRON_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * @typedef {'vercel' | 'manual' | 'external' | 'unknown'} CronTrigger
 */


/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {boolean} vercelCronOk
 * @param {boolean} secretAuthOk
 * @returns {CronTrigger}
 */
function detectTrigger(req, vercelCronOk, secretAuthOk) {
  if (vercelCronOk) return 'vercel';
  if (!secretAuthOk) return 'unknown';

  const host = String(getHeader(req, 'host') || '').toLowerCase();
  const ua = String(getHeader(req, 'user-agent') || '').toLowerCase();

  const isLocalHost = host.includes('localhost') || host.startsWith('127.0.0.1') || host.endsWith('.local');
  const isCliUa =
    ua.includes('curl') ||
    ua.includes('postman') ||
    ua.includes('insomnia') ||
    ua.includes('httpie') ||
    ua.includes('wget');

  if (isLocalHost || isCliUa) return 'manual';
  return 'external';
}

/**
 * Attempt to acquire a coarse throttle lock to prevent endpoint flooding.
 *
 * Returns:
 * - true: acquired
 * - false: already locked
 * - null: KV unavailable (best-effort fallback)
 *
 * @param {string} runId
 * @returns {Promise<true | false | null>}
 */
async function tryAcquireCronLock(runId) {
  try {
    const result = await kv.set(CRON_LOCK_KEY, runId, { nx: true, ex: CRON_LOCK_TTL_SECONDS });
    return result != null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} err
 * @param {{
 *   trigger: CronTrigger,
 *   status: 'failed' | 'skipped',
 *   runId: string,
 *   requestId: string | null,
 *   httpStatus: number,
 *   durationMs: number,
 *   skipReason?: 'locked' | 'cooldown',
 * }} context
 */
async function captureCronError(err, context) {
  try {
    Sentry.captureException(err, {
      tags: {
        cron: 'actualites',
        source: 'cron',
        job: 'actualites',
        trigger: context.trigger,
        status: context.status,
        skipReason: context.skipReason,
        httpStatus: String(context.httpStatus),
        requestId: context.requestId ?? undefined,
      },
      extra: {
        runId: context.runId,
        durationMs: context.durationMs,
      },
    });
    await Sentry.flush(2000);
  } catch {
    // best-effort
  }
}

/**
 * @param {{
 *   runId: string,
 *   requestId: string | null,
 *   trigger: CronTrigger,
 *   reason: 'locked' | 'cooldown',
 *   startedAtMs: number,
 *   mode: unknown,
 *   limit: number | undefined,
 *   lockTtlMs?: number,
 *   cooldownMs?: number,
 *   lastSuccessAt?: Date | null,
 * }} params
 * @returns {Promise<string | null>}
 */
async function recordSkippedRun(params) {
  const finishedAt = new Date();
  const durationMs = Math.max(0, Date.now() - params.startedAtMs);

  const [created] = await db.insert(CronRun).values({
    job: 'actualites',
    status: 'skipped',
    trigger: params.trigger,
    skipReason: params.reason,
    startedAt: new Date(params.startedAtMs),
    finishedAt,
    durationMs,
    requestId: params.requestId,
    vercelEnv: env.runtime.vercelEnv,
    release: env.sentry.release,
    metrics: {
      runId: params.runId,
      reason: params.reason,
      mode: params.mode ?? null,
      limit: params.limit ?? null,
      lockTtlMs: params.lockTtlMs ?? null,
      cooldownMs: params.cooldownMs ?? null,
      lastSuccessAt: params.lastSuccessAt ? params.lastSuccessAt.toISOString() : null,
    },
    updatedAt: new Date(),
  }).returning({ id: CronRun.id });

  return created.id;
}

/**
 * Stable cron endpoint for RSS/Atom news ingestion.
 *
 * Note: ingestion logic lives in `runIngestActualitesRss` (P5). This handler only
 * orchestrates auth/locking and must not change ingestion behavior.
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const runId = crypto.randomUUID();
  const startedAtMs = Date.now();
  const requestId = typeof req.requestId === 'string' ? req.requestId : null;

  const mode = req.query?.mode;
  const limitParam = req.query?.limit;
  const limit = limitParam
    ? Number.parseInt(String(limitParam), 10)
    : mode === 'smoke'
      ? 5
      : undefined;

  const auth = getCronAuth(req);
  if (!auth.ok && auth.reason === 'missing_secret') {
    return res.status(500).json({ error: 'CRON_SECRET is not configured' });
  }

  // the secret is the only proof (Vercel Cron sends it as a Bearer token); the user-agent only labels an authorized run (item 36)
  const vercelCronOk = auth.ok && scheduledByVercel(req);
  const trigger = detectTrigger(req, vercelCronOk, auth.ok);
  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const lockState = await tryAcquireCronLock(runId);
  if (lockState === false) {
    let cronRunId = null;
    try {
      cronRunId = await recordSkippedRun({
        runId,
        requestId,
        trigger,
        reason: 'locked',
        startedAtMs,
        mode,
        limit,
        lockTtlMs: CRON_LOCK_TTL_SECONDS * 1000,
      });
    } catch (err) {
      logger.warn({ requestId, runId, job: 'actualites', reason: 'locked', trigger }, 'cron.actualites.skip_log_failed');
      await captureCronError(err, {
        trigger,
        status: 'skipped',
        skipReason: 'locked',
        runId,
        requestId,
        httpStatus: 202,
        durationMs: Date.now() - startedAtMs,
      });
    }
    return res.status(202).json({ ok: true, skipped: true, reason: 'locked', runId, requestId, cronRunId });
  }
  if (lockState === null) {
    try {
      Sentry.captureMessage('cron.lock.unavailable', {
        level: 'warning',
        tags: {
          cron: 'actualites',
          source: 'cron',
          job: 'actualites',
          trigger,
          status: 'running',
          requestId: requestId ?? undefined,
        },
        extra: { runId },
      });
      await Sentry.flush(500);
    } catch {
      // best-effort
    }
  }

  try {
    // Defense-in-depth: if KV is unavailable or the lock is manually cleared,
    // still avoid thrashing the ingestion pipeline too frequently.
    try {
      const lastSuccess = await db.query.CronRun.findFirst({
        where: and(eq(CronRun.job, 'actualites'), eq(CronRun.status, 'success')),
        orderBy: (cr, { desc }) => [desc(cr.startedAt)],
        columns: { startedAt: true },
      });

      if (lastSuccess) {
        const ageMs = Date.now() - new Date(lastSuccess.startedAt).getTime();
        if (ageMs >= 0 && ageMs < CRON_COOLDOWN_MS) {
          let cronRunId = null;
          try {
            cronRunId = await recordSkippedRun({
              runId,
              requestId,
              trigger,
              reason: 'cooldown',
              startedAtMs,
              mode,
              limit,
              cooldownMs: CRON_COOLDOWN_MS,
              lastSuccessAt: lastSuccess.startedAt,
            });
          } catch (err) {
            logger.warn(
              { requestId, runId, job: 'actualites', reason: 'cooldown', trigger },
              'cron.actualites.skip_log_failed',
            );
            await captureCronError(err, {
              trigger,
              status: 'skipped',
              skipReason: 'cooldown',
              runId,
              requestId,
              httpStatus: 202,
              durationMs: Date.now() - startedAtMs,
            });
          }

          return res
            .status(202)
            .json({ ok: true, skipped: true, reason: 'cooldown', runId, requestId, cronRunId });
        }
      }
    } catch {
      // best-effort; the cron will fail later anyway if DB is down.
    }

    /** @type {string | null} */
    let cronRunId = null;

    const stats = await withLock('ingest-actualites-rss', async () => {
      const [created] = await db.insert(CronRun).values({
        job: 'actualites',
        status: 'running',
        trigger,
        requestId,
        startedAt: new Date(startedAtMs),
        vercelEnv: env.runtime.vercelEnv,
        release: env.sentry.release,
        metrics: {
          runId,
          mode: mode ?? null,
          limit: limit ?? null,
        },
        updatedAt: new Date(),
      }).returning({ id: CronRun.id });

      cronRunId = created.id;

      try {
        const result = await runIngestActualitesRss({ limit, runId });
        // R29: the ingestion only writes drafts; the automatic verification publishes those that pass every check (a failure here keeps them drafts)
        let verification = null;
        try { verification = await verifyNewsDrafts({ db, schema: { Actualite }, ops: { eq } }); } catch (err) { logger.warn({ runId, job: 'actualites', error: err instanceof Error ? err.message : String(err) }, 'cron.actualites.verification_failed'); }
        const durationMs = Date.now() - startedAtMs;

        await db.update(CronRun).set({
          status: 'success',
          trigger,
          finishedAt: new Date(),
          durationMs,
          metrics: {
            runId,
            mode: mode ?? null,
            limit: limit ?? null,
            fetched: result?.fetched ?? null,
            processed: result?.processed ?? null,
            created: result?.created ?? null,
            updated: result?.updated ?? null,
            skippedExisting: result?.skippedExisting ?? null,
            errorCount: Array.isArray(result?.errors) ? result.errors.length : null,
            verified: verification ? { checked: verification.checked, published: verification.published, kept: verification.kept } : null,
          },
        }).where(eq(CronRun.id, created.id));

        return { ...result, verification };
      } catch (err) {
        const durationMs = Date.now() - startedAtMs;
        const message = err instanceof Error ? err.message : String(err);

        await db.update(CronRun).set({
          status: 'failed',
          trigger,
          finishedAt: new Date(),
          durationMs,
          errorSample: message.slice(0, 500),
          metrics: {
            runId,
            mode: mode ?? null,
            limit: limit ?? null,
          },
        }).where(eq(CronRun.id, created.id));

        throw err;
      }
    });

    return res.status(200).json({
      ok: true,
      source: 'actualites',
      runId,
      trigger,
      mode,
      limit: limit ?? null,
      durationMs: Date.now() - startedAtMs,
      stats,
      cronRunId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("CRON HANDLER CRASHED:", err?.stack || err);
    if (message.includes('already running')) {
      return res.status(409).json({ error: 'Pipeline already running', runId });
    }

    await captureCronError(err, {
      trigger,
      status: 'failed',
      runId,
      requestId,
      httpStatus: 500,
      durationMs: Date.now() - startedAtMs,
    });
    return res.status(500).json({ error: 'Internal Server Error', runId, requestId });
  }
}
