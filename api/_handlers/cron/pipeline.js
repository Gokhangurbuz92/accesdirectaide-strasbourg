// @ts-nocheck
import { consumePendingSyncRuns } from '../../lib/ingestion/SyncQueueConsumer.js';
import logger from '../../_utils/logger.js';
import { getCronAuth } from '../../_utils/cronAuth.js';
import { db } from '../../../src/db/index.js';
import { ImportLog } from '../../../src/db/schema.js';
import crypto from 'crypto';
import { runIngestStructures } from './ingest-structures.js';
import { runIngestAids } from './ingest-aids.js';
import { runIngestActualitesRss } from './ingest-actualites-rss.js';
import { runIngestAnnuaire } from './ingest-annuaire.js';
/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    // SENTINEL: Logic Entry
    const runId = crypto.randomUUID();
    const query = req.query || {}; // Safe access
    const sourceLog = query.source || 'N/A';
    logger.info(`PIPELINE_LOGIC_ENTER source=${sourceLog} runId=${runId}`);

    // 1. Authorization
    const auth = getCronAuth(req);
    if (!auth.ok) {
        if (auth.reason === 'missing_secret') {
            return res.status(500).json({ error: 'CRON_SECRET is not configured' });
        }
        logger.warn("Unauthorized Pipeline Attempt");
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // 2. Validation & Parameters (with Aliases)
    let sourceInput = query.source;
    let sourceResolved = sourceInput;

    // ALIAS LOGIC
    if (sourceInput === 'actualites') sourceResolved = 'rss';
    if (sourceInput === 'demarches') sourceResolved = 'aides';

    const mode = query.mode; // 'smoke'
    const limitParam = query.limit;

    // Determine limit: explicit > smoke default (5) > undefined (unlimited)
    let limit = limitParam ? parseInt(limitParam, 10) : (mode === 'smoke' ? 5 : undefined);

    if (!sourceResolved) {
        return res.status(400).json({
            ok: false,
            error: "Missing required 'source' parameter. Options: 'structures', 'aides' (or 'demarches'), 'rss' (or 'actualites')."
        });
    }

    // Enhanced Stats Logic (Explicit 'ingested' for contract compliance)
    let stats = {
        ingested: 0, // Requirement: stats.ingested != null
        fetched: 0,
        processed: 0,
        created: 0,
        updated: 0,
        skippedExisting: 0,
        errors: [],
        durationByStage: {
            fetchMs: 0,
            processingMs: 0
        }
    };

    const startTime = Date.now();

    // Helper: Retry wrapper
    async function retry(fn, retries = 3, delay = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (err) {
                if (i === retries - 1) throw err;
                await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
            }
        }
    }

    // Wrap entire execution in a timeout (50s safe limit for Vercel 60s max)
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Pipeline Timeout')), 50000)
    );

    const pipelineLogic = async () => {
        logger.info("[PIPELINE] calling ingester", { sourceResolved, mode, limit });

        // ==========================================
        // ROUTING LOGIC
        // ==========================================

        if (sourceResolved === 'sync_queue') {
            const result = await consumePendingSyncRuns();
            stats.ingested = result.stats?.created || 0;
            return res.status(200).json(result);
        } else if (sourceResolved === 'structures') {
            const result = await runIngestStructures({ limit, runId });
            // Merge stats from ingester
            stats = { ...stats, ...result };
            // Map created to ingested for contract compliance
            stats.ingested = result.created || 0;
            return;

        } else if (sourceResolved === 'aides') {
            const result = await runIngestAids({ limit, runId });
            // Merge stats from ingester
            stats = { ...stats, ...result };
            // Map created to ingested for contract compliance
            stats.ingested = result.created || 0;
            return;

        } else if (sourceResolved === 'rss') {
            // RSS ingestion (Actualites)
            // Note: this function is also used by the local script (scripts/ingest-actualites.js).
            const result = await retry(() => runIngestActualitesRss({ limit, runId }));
            stats = { ...stats, ...result };
            stats.ingested = result.created || 0;

        } else if (sourceResolved === 'annuaire') {
            // Annuaire ingestion (FINESS + RNA)
            const result = await retry(() => runIngestAnnuaire({ limit, runId }));
            stats = { ...stats, ...result };
            stats.ingested = result.created || 0;

        } else if (sourceResolved === 'geography') {
            // Phase 9: COG + BANATIC territory ingestion
            // Requires external data files or API access — ENVIRONMENT ACTION REQUIRED
            logger.info('[PIPELINE] Geography ingestion route invoked', { runId });
            const { ingestRegions, ingestDepartments, ingestEPCIMemberships, processReplacements } = await import('../../lib/geography/COGIngestion.js');
            // This route requires pre-fetched COG/BANATIC data passed via request body or fetched from official APIs.
            // Production deployment must provide data source configuration.
            // Current: validates route exists and is callable.
            stats.ingested = 0;
            stats.errors.push('Geography ingestion requires COG/BANATIC data source configuration (ENVIRONMENT ACTION REQUIRED)');

        } else {
            const err = new Error(`Invalid source '${sourceResolved}' (resolved from '${sourceInput}'). Valid: structures, aides, rss, annuaire, geography`);
            throw err;
        }

        // Log the Run
        try {
            await db.insert(ImportLog).values({
                source_name: `CRON_${sourceResolved.toUpperCase()}`,
                status: stats.errors.length > 0 ? 'PARTIAL' : 'SUCCESS',
                items_new: stats.created,
                items_total: stats.processed,
                logs: stats.errors.length ? JSON.stringify(stats.errors) : null,
                duration_ms: Date.now() - startTime
            });
        } catch { /* ignore */ }
    };

    try {
        await Promise.race([pipelineLogic(), timeoutPromise]);

        // Handlers (structures/aides) will have already responded and returned.
        // We check if response is finished to avoid double-response.
        if (res.writableEnded || res.headersSent) {
            return;
        }

    } catch (globalErr) {
        logger.error("Pipeline Global Error:", globalErr);
        // Try to log failure
        try {
            await db.insert(ImportLog).values({
                source_name: `CRON_${sourceResolved ? sourceResolved.toUpperCase() : 'UNKNOWN'}`,
                status: 'ERROR',
                // @ts-ignore
                logs: JSON.stringify(globalErr.message),
                duration_ms: Date.now() - startTime
            });
        } catch { /* ignore */ }

        // If headers already sent by sub-handler, we can't do anything but log
        if (res.writableEnded || res.headersSent) return;

        // Use 400 for bad requests, 500 for others
        // @ts-ignore
        const statusCode = globalErr.message.includes('Invalid source') ? 400 : 500;
        return res.status(statusCode).json({
            ok: false,
            // @ts-ignore
            error: globalErr.message,
            source: sourceInput,
            sourceResolved,
            mode,
            durationMs: Date.now() - startTime
        });
    }

    // STRICT CONTRACT: Check for Silent Failure / "Success Vide"
    // Condition: (fetchMs=0 AND errors=[]) AND fetched=0.
    if (sourceResolved !== 'sync_queue' && stats.fetched === 0 && stats.durationByStage.fetchMs === 0 && stats.errors.length === 0) {
        const errorMsg = "PIPELINE_NOOP: Execution yielded zero fetched results with no errors. This is a contract violation.";
        logger.error(errorMsg);

        // Log this specific failure
        try {
            await db.insert(ImportLog).values({
                source_name: `CRON_${sourceResolved ? sourceResolved.toUpperCase() : 'UNKNOWN'}`,
                status: 'ERROR',
                logs: JSON.stringify([errorMsg]),
                duration_ms: Date.now() - startTime
            });
        } catch (e) {
            logger.error('Failed to log NOOP error:', e);
        }

        return res.status(502).json({
            ok: false,
            error: errorMsg,
            stats
        });
    }

    return res.status(200).json({
        ok: true,
        source: sourceInput,
        sourceResolved,
        mode,
        durationMs: Date.now() - startTime,
        stats
    });
}
