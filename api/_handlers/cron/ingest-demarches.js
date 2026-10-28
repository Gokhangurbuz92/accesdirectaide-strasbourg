// @ts-nocheck
import { getCronAuth } from '../../_utils/cronAuth.js';
import crypto from 'crypto';
import { logger } from '../../lib/logger.js';
import * as Sentry from '@sentry/node';
import { withLock } from '../../_utils/pipelineLock.js';
import { ServicePublicDemarchesConnector } from '../../lib/ingestion/ServicePublicDemarchesConnector.js';
import { IngestionPipelineCore } from '../../lib/ingestion/IngestionPipelineCore.js';
import { DemarcheIngestSchema } from '../../lib/ingestion/validators.js';

// We'll keep the curated demarches out of the pipeline for now or handle them separately later if needed
// Or we could build a CuratedConnector. For simplicity, we just run the ServicePublic connector through the pipeline.

/**
 * @param {{ limit?: number, runId?: string }} params
 */
export async function runIngestDemarches({ limit, runId } = {}) {
    if (!runId) runId = crypto.randomUUID();
    logger.info('INGEST_DEMARCHES_START', { runId, limit });

    const connector = new ServicePublicDemarchesConnector();
    
    // Instantiate the new Pipeline Core with the 3 guardrails
    const pipeline = new IngestionPipelineCore({
        modelName: 'demarche',
        schema: DemarcheIngestSchema,
        connector: connector,
        runId: runId,
        maxDurationMs: 270_000, // 4.5 minutes (leaves 30s buffer for Vercel 300s maxDuration)
        batchSize: 15 // Batch size to prevent connection pool exhaustion
    });

    // Run the pipeline
    const stats = await pipeline.run(limit);

    logger.info('INGEST_DEMARCHES_END', { runId, stats });
    return stats;
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
        logger.warn('Unauthorized Ingest-Demarches Attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const runId = crypto.randomUUID();

    try {
        const stats = await withLock('ingest-demarches', async () => {
            return runIngestDemarches({ limit, runId });
        }, { ttl: 900 });
        return res.status(200).json(stats);
    } catch (error) {
        if (error.message?.includes('already running')) {
            logger.warn({ runId }, 'Ingest-Demarches already running, skipping');
            return res.status(409).json({ error: 'Pipeline already running', runId });
        }
        logger.error('Ingest Demarches Handler Error', { runId, error });
        Sentry.captureException(error, { extra: { runId } });
        return res.status(500).json({ error: 'Internal Server Error', runId });
    }
}
