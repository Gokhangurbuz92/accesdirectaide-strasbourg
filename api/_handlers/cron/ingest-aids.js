// @ts-nocheck
import { getCronAuth, scheduledByVercel } from '../../_utils/cronAuth.js';
import { db } from '../../../src/db/index.js';
import { startCronRun, finishCronRun } from '../../_utils/cron-run.js';
import crypto from 'crypto';
import { logger } from '../../lib/logger.js';
import * as Sentry from '@sentry/node';
import { withLock } from '../../_utils/pipelineLock.js';
import { GrandEstConnector } from '../../lib/ingestion/GrandEstConnector.js';
import { AgefiphConnector } from '../../lib/ingestion/AgefiphConnector.js';
import { AidesTerritoiresConnector } from '../../lib/ingestion/AidesTerritoiresConnector.js';
import { DreesConnector } from '../../lib/ingestion/DreesConnector.js';
import { IngestionPipelineCore } from '../../lib/ingestion/IngestionPipelineCore.js';
import { AidIngestSchema } from '../../lib/ingestion/validators.js';

/**
 * R40 / G3 — the sources this job may read. Reading a publisher's content into the catalogue is a reuse of it: only a source whose reuse is authorised runs.
 *   aides-territoires  public API of the State (beta.gouv.fr), account + token; the only Aides-territoires path
 *   Grand Est          grandest.fr — reuse « authorisation-required » (news-verification.js, legal notice read 31/10/2026): NOT authorised
 *   AGEFIPH            agefiph.fr — scraping of the association's pages, no reuse licence recorded: NOT authorised
 *   drees              a curated local file (api/data/drees-aides.json) whose licence and provenance are not recorded: NOT authorised until they are
 * A source becomes authorised by changing this list in a reviewed commit (with the written authorisation or the licence), never by a request parameter.
 */
export const AUTHORISED_AID_SOURCES = Object.freeze(['aides-territoires']);

/**
 * @param {{ limit?: number, runId?: string, source?: string }} params
 */
export async function runIngestAids({ limit, runId, source } = {}) {
    if (!runId) runId = crypto.randomUUID();

    logger.info('INGEST_AIDS_START', { runId, limit, source });

    const GLOBAL_START = Date.now();
    const MAX_VERCEL_TIME = 280_000; // 280 seconds max margin

    // 1. Source Routing
    const allConnectors = [
        new GrandEstConnector(),
        new AgefiphConnector(),
        new AidesTerritoiresConnector(),
        new DreesConnector(),
    ];

    // R40 / G3: « all » means every AUTHORISED source; naming a source that is not authorised is refused (nothing is fetched)
    const authorised = allConnectors.filter((c) => AUTHORISED_AID_SOURCES.includes(c.name));
    let targetConnectors = authorised;
    if (source && source !== 'all') {
        if (!allConnectors.some((c) => c.name === source)) {
            logger.warn(`INGEST_AIDS_UNKNOWN_SOURCE`, { runId, source });
            return { error: `Unknown source: ${source}` };
        }
        targetConnectors = authorised.filter(c => c.name === source);
        if (targetConnectors.length === 0) {
            logger.warn('INGEST_AIDS_SOURCE_NOT_AUTHORISED', { runId, source });
            return { error: 'SOURCE_NOT_AUTHORISED', source, authorised: [...AUTHORISED_AID_SOURCES] };
        }
    }

    const aggregatedResults = {};

    // 2. Global Time Budget (Sequential for...of loop)
    for (const connector of targetConnectors) {
        const timeElapsed = Date.now() - GLOBAL_START;
        const timeRemaining = MAX_VERCEL_TIME - timeElapsed;

        // If we've consumed too much time, stop cleanly
        if (timeRemaining < 30_000) {
            logger.warn(`[ingest-aids] Global time almost up. Connector ${connector.name} skipped.`, { runId });
            aggregatedResults[connector.name] = { status: 'SKIPPED_DUE_TO_TIMEOUT' };
            continue;
        }

        logger.info(`CONNECTOR_START`, { runId, connector: connector.name, timeRemainingMs: timeRemaining });

        const pipeline = new IngestionPipelineCore({
            modelName: 'aide',
            schema: AidIngestSchema,
            connector: connector,
            runId: runId,
            maxDurationMs: timeRemaining, // Inject dynamic remaining time!
            batchSize: 15
        });

        // Run the pipeline for this specific connector
        const stats = await pipeline.run(limit);
        // @ts-ignore
        aggregatedResults[connector.name] = stats;

        logger.info(`CONNECTOR_END`, { runId, connector: connector.name, stats });
    }

    const durationTotal = Date.now() - GLOBAL_START;
    logger.info('INGEST_AIDS_END', { runId, duration_ms: durationTotal, results: aggregatedResults });

    return {
        runId,
        durationMs: durationTotal,
        results: aggregatedResults
    };
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const auth = getCronAuth(req);
    if (!auth.ok) {
        if (auth.reason === 'missing_secret') {
            return res.status(500).json({ error: 'CRON_SECRET is not configured' });
        }
        logger.warn("Unauthorized Ingest-Aids Attempt");
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const source = req.query.source || 'all';
    const runId = crypto.randomUUID();

    try {
        const stats = await withLock('ingest-aids', async () => {
            // R40 / G4: a CronRun row like the other jobs (health-alert's ingestion freshness reads only CronRun)
            const startedAtMs = Date.now();
            const cronRunId = await startCronRun(db, 'ingest-aids', { trigger: scheduledByVercel(req) ? 'vercel-cron' : 'manual', metrics: { runId, source, limit: limit ?? null } });
            try {
                const out = await runIngestAids({ limit, runId, source });
                const per = Object.values(out?.results || {});
                const errorCount = per.reduce((n, r) => n + (Array.isArray(r?.errors) ? r.errors.length : 0), 0);
                // failed: refused, or no source could be read at all (e.g. AT_CREDENTIALS_MISSING); partial: some items or sources failed
                const allFatal = per.length > 0 && per.every((r) => Array.isArray(r?.errors) && r.errors.some((e) => String(e).startsWith('FATAL')) && !r.created && !r.updated && !r.skippedExisting);
                const refused = Boolean(out?.error) || allFatal;
                await finishCronRun(db, cronRunId, { status: refused ? 'failed' : errorCount > 0 || per.some((r) => r?.status === 'SKIPPED_DUE_TO_TIMEOUT') ? 'partial' : 'success', startedAtMs,
                    error: out?.error || (allFatal ? per.flatMap((r) => r.errors || []).find((e) => String(e).startsWith('FATAL')) : null), metrics: { runId, source, sources: Object.keys(out?.results || {}),
                        created: per.reduce((n, r) => n + (r?.created || 0), 0), updated: per.reduce((n, r) => n + (r?.updated || 0), 0), errorCount } });
                return out;
            } catch (err) {
                await finishCronRun(db, cronRunId, { status: 'failed', startedAtMs, error: err?.message || String(err), metrics: { runId, source } });
                throw err;
            }
        }, { ttl: 900 });
        return res.status(stats?.error === 'SOURCE_NOT_AUTHORISED' ? 403 : 200).json(stats);
    } catch (error) {
        // @ts-ignore
        if (error.message?.includes('already running')) {
            logger.warn({ runId }, 'Ingest-Aids already running, skipping');
            return res.status(409).json({ error: 'Pipeline already running', runId });
        }
        logger.error('Ingest Aids Handler Error', { runId, error });
        Sentry.captureException(error, { extra: { runId } });
        return res.status(500).json({ error: 'Internal Server Error', runId });
    }
}
