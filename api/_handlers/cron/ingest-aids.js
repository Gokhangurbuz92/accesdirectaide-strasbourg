// @ts-nocheck
import { getCronAuth } from '../../_utils/cronAuth.js';
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

    let targetConnectors = allConnectors;
    if (source && source !== 'all') {
        targetConnectors = allConnectors.filter(c => c.name === source);
        if (targetConnectors.length === 0) {
            logger.warn(`INGEST_AIDS_UNKNOWN_SOURCE`, { runId, source });
            return { error: `Unknown source: ${source}` };
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
            return runIngestAids({ limit, runId, source });
        }, { ttl: 900 });
        return res.status(200).json(stats);
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
