// @ts-nocheck
import * as Sentry from '@sentry/node';
import { logger } from '../logger.js';
import crypto from 'crypto';
import { computeContentHash } from '../../_utils/contentHash.js';
import { ensureSlugOrNull } from '../../_utils/slug.js';
import { upsertSourceDocument } from '../../_utils/sourceDocument.js';
import { db } from '../../../src/db/index.js';
import { Aide, Demarche, Structure, SyncRun, ImportLog, SourceDocument } from '../../../src/db/schema.js';
import { eq, and, or, count } from 'drizzle-orm';
import { computeQualityScore } from '../quality-score.js';
import { applySourceUpdate } from '../../_services/source-updates.js';

const MODEL_MAP = {
    'aide': Aide,
    'demarche': Demarche,
    'structure': Structure
};

export class IngestionPipelineCore {
    /**
     * @param {Object} options
     * @param {string} options.modelName - DB model/table name ('aide', 'demarche', 'structure', etc)
     * @param {import('zod').ZodTypeAny} options.schema - Zod schema for validating the incoming item
     * @param {import('./SourceConnector.js').SourceConnector} options.connector - The crawler/parser instance
     * @param {string} [options.runId] - Unique ID for this CRON run
     * @param {number} [options.maxDurationMs] - Max duration before graceful shutdown (default: 270s for Vercel 300s limit)
     * @param {number} [options.batchSize] - DB upsert batch size to avoid connection pool exhaustion (default: 15)
     */
    constructor({
        modelName,
        schema,
        connector,
        runId = crypto.randomUUID(),
        maxDurationMs = 270_000,
        batchSize = 15
    }) {
        if (!MODEL_MAP[modelName]) throw new Error(`Model ${modelName} not configured in Drizzle mapper`);
        this.modelName = modelName;
        this.schema = schema;
        this.connector = connector;
        this.runId = runId;
        this.maxDurationMs = maxDurationMs;
        this.batchSize = batchSize;
        this.dbTable = MODEL_MAP[modelName];
        
        this.stats = {
            fetched: 0,
            processed: 0,
            created: 0,
            updated: 0,
            heldForReverification: 0,
            skippedExisting: 0,
            errors: [],
            durationByStage: {
                fetchMs: 0,
                processingMs: 0,
                dbUpsertMs: 0
            }
        };
    }

    /**
     * @param {number} [limit] - Maximum items to process for this run
     */
    async run(limit) {
        const startTotal = Date.now();
        logger.info(`[PipelineCore] Starting pass for connector: ${this.connector.name} (model: ${this.modelName})`, { runId: this.runId, limit });

        try {
            // Stage 1: Fetch metadata / URLs
            const startFetch = Date.now();
            let urls = [];
            try {
                urls = await this.connector.getDetailUrls();
                this.stats.fetched = urls.length;
            } catch (crawlErr) {
                this._recordFatalError('crawl', crawlErr);
                return await this._finalizeRun(startTotal);
            }
            this.stats.durationByStage.fetchMs += (Date.now() - startFetch);

            if (limit && limit > 0) {
                urls = urls.slice(0, limit);
            }

            // Stage 2 & 3: Parse, Validate, Upsert with GUARDRAILS
            const startProcess = Date.now();
            
            // We use a buffer to batch DB operations (Guardrail 2)
            let batchBuffer = [];
            
            for (const url of urls) {
                // Guardrail 1: Graceful Shutdown (Timeout Protection)
                if (Date.now() - startTotal >= this.maxDurationMs) {
                    logger.warn(`[PipelineCore] ⏱ Vercel Timeout Threshold Reached (${this.maxDurationMs}ms). Triggering Graceful Shutdown.`, { runId: this.runId });
                    this.stats.errors.push(`Graceful shutdown triggered due to ${this.maxDurationMs}ms timeout limit.`);
                    break;
                }

                this.stats.processed++;
                try {
                    const parsedItem = await this._processItem(url);
                    if (parsedItem) {
                        batchBuffer.push(parsedItem);
                    }
                } catch (itemErr) {
                    this._recordItemError(url, itemErr);
                }

                // Guardrail 2: Batching DB Upserts
                if (batchBuffer.length >= this.batchSize) {
                    await this._flushBatch(batchBuffer);
                    batchBuffer = [];
                }
            }

            // Flush remaining items
            if (batchBuffer.length > 0) {
                await this._flushBatch(batchBuffer);
            }

            this.stats.durationByStage.processingMs += (Date.now() - startProcess);

        } catch (fatalErr) {
            this._recordFatalError('pipeline_core', fatalErr);
        }

        return await this._finalizeRun(startTotal);
    }

    /**
     * Inner flow: Fetch HTML/JSON, parse, validate with Zod.
     */
    async _processItem(url) {
        const rawHtmlOrJson = await this.connector.fetch(url);
        const unvalidatedData = await this.connector.parse(rawHtmlOrJson, url);

        // Required minimal check to ensure mapping exists
        if (!unvalidatedData.titre && !unvalidatedData.title) {
            throw new Error('Pipeline Drop: No title mapped by connector.');
        }

        // Validate via Zod Shield
        const parsed = this.schema.safeParse(unvalidatedData);
        if (!parsed.success) {
            const errorIssues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
            logger.warn(`[PipelineCore] Validation failed for ${url}`, { runId: this.runId, validationErrors: errorIssues });
            throw new Error(`Zod Validation Failed: ${errorIssues}`);
        }

        return {
            url,
            rawContent: rawHtmlOrJson,
            data: parsed.data
        };
    }

    /**
     * @param {Array<{url: string, rawContent: string, data: Object}>} batch
     */
    async _flushBatch(batch) {
        const startDb = Date.now();
        
        // Séquentiel pour éviter de saturer le connection pool PG (Guardrail 2)
        for (const item of batch) {
            // Guardrail 1 inner check just in case DB is very slow
            if (Date.now() - startDb >= this.maxDurationMs) {
                break;
            }
            try {
                await this._upsertItem(item);
            } catch (err) {
                this._recordItemError(item.url, err);
            }
        }

        this.stats.durationByStage.dbUpsertMs += (Date.now() - startDb);
    }

    /**
     * Idempotent Upsert + SourceDocument + Guardrail 3 (Embeddings)
     */
    // @ts-ignore
    async _upsertItem({ url, rawContent, data }) {
        const displayTitle = data.titre || data.title;
        const normalizedItem = { ...data };

        // Normalize specific fields to ADA DB schema expectations based on modelName
        if (this.modelName === 'aide') {
            normalizedItem.titre = displayTitle;
            normalizedItem.summary_falc = data.description;
            normalizedItem.cest_quoi = data.content;
        } else if (this.modelName === 'demarche') {
            normalizedItem.titre = displayTitle;
            normalizedItem.description_courte = data.description_courte || data.description;
            // Map content based on specific model demands
        }

        const baseSlug = ensureSlugOrNull(`${this.connector.name}-${displayTitle}`);
        
        // Generate Content Hash for idempotency comparison
        const contentHashRaw = {
            title: displayTitle,
            desc: normalizedItem.summary_falc || normalizedItem.description_courte || data.description,
            content: normalizedItem.cest_quoi || data.content,
            source_url: data.source_url,
            apply_url: data.apply_url || data.lien_demarche,
            theme: data.theme || data.categorie
        };
        const contentHash = computeContentHash(contentHashRaw);

        // 1. Source Document Creation/Enrichment
        let sourceDocumentId = null;
        try {
            const sourceDoc = await upsertSourceDocument({
                sourceUrl: data.source_url || url,
                rawContent: typeof rawContent === 'string' ? rawContent.slice(0, 20000) : JSON.stringify(rawContent),
                metadata: {
                    entityType: this.modelName,
                    connector: this.connector.name,
                    version: 'pipeline-core-v1'
                }
            });
            sourceDocumentId = sourceDoc.id;
        } catch (sourceErr) {
            logger.warn(`[PipelineCore] SourceDoc failed for ${url}`, { runId: this.runId, msg: sourceErr.message });
        }

        // 2. Locate existing record to determine created vs updated vs skipped
        const qOr = [];
        if (data.external_id && 'externalId' in this.dbTable) qOr.push(eq(this.dbTable.externalId, data.external_id));
        if (baseSlug) qOr.push(eq(this.dbTable.slug, baseSlug));
        if (data.source_url && 'source_url_exact' in this.dbTable) qOr.push(eq(this.dbTable.source_url_exact, data.source_url));
        if (data.source_url && 'source_url' in this.dbTable) qOr.push(eq(this.dbTable.source_url, data.source_url));

        const existing = await db.select().from(this.dbTable).where(or(...qOr)).limit(1).then(r => r[0] || null);

        const dbRecordConfig = {
            ...normalizedItem,
            source_url: data.source_url || url,
            source_url_exact: data.source_url || url,
            content_hash: contentHash,
            source_document_id: sourceDocumentId,
            statut: 'publie',
            last_checked_at: new Date(),
            quality_score: computeQualityScore(normalizedItem).score,
        };

        // Inject provider fields if not specified otherwise
        if (!dbRecordConfig.providerName && !dbRecordConfig.source_api) {
            dbRecordConfig.providerName = this.connector.name;
        }
        if (!dbRecordConfig.providerType) {
            dbRecordConfig.providerType = 'ingest';
        }

        if (existing) {
            // Guardrail 3 + Idempotency logic
            if (existing.content_hash !== contentHash || existing.source_document_id !== sourceDocumentId) {
                // Texts have changed! Must invalidate embeddings 
                // Because embedding generation is often async or cron-triggered elsewhere.
                // Make sure we only set the property if it logically can be null for embedding
                if ('embedding' in dbRecordConfig) {
                    dbRecordConfig.embedding = null; 
                }

                // launch-readiness item 45: versioned, statut untouched, a verified record held until the veille re-verifies it (api/_services/source-updates.js)
                const r = await applySourceUpdate({ kind: this.modelName, id: existing.id, patch: dbRecordConfig, source: this.connector.name });
                if (r.ok && r.held) this.stats.heldForReverification++;
                this.stats.updated++;
            } else {
                // Completely unchanged -> Skip DB write
                this.stats.skippedExisting++;
            }
        } else {
            let finalSlug = baseSlug;
            if (finalSlug) {
                const slC = await db.select({ value: count() }).from(this.dbTable).where(eq(this.dbTable.slug, finalSlug));
                if (slC[0].value > 0) {
                    finalSlug = ensureSlugOrNull(`${finalSlug}-${contentHash.slice(0, 6)}`);
                }
            }
            
            dbRecordConfig.slug = finalSlug;
            dbRecordConfig.published_at = new Date();
            dbRecordConfig.retrieved_at = new Date(); // first sight
            if (data.external_id && 'externalId' in dbRecordConfig) {
                dbRecordConfig.externalId = data.external_id;
            }

            await db.insert(this.dbTable).values(dbRecordConfig);
            this.stats.created++;
        }
    }

    _recordItemError(/** @type {string | number | boolean | null | undefined} */ url, /** @type {unknown} */ error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.stats.errors.push(`[${url}]: ${msg}`);
        logger.error(`[PipelineCore] Item Error`, { runId: this.runId, url, msg });
        
        Sentry.captureException(error, {
            tags: { connector: this.connector.name, runId: this.runId, stage: 'item_processing' },
            extra: { url } // Important: NO user PII here, only public URLs
        });
    }

    _recordFatalError(/** @type {string | number | boolean | null | undefined} */ stage, /** @type {unknown} */ error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.stats.errors.push(`FATAL [${stage}]: ${msg}`);
        logger.error(`[PipelineCore] Fatal Error`, { runId: this.runId, connector: this.connector.name, stage, msg });
        
        Sentry.captureException(error, {
            tags: { connector: this.connector.name, runId: this.runId, stage },
            level: 'fatal'
        });
    }

    async _finalizeRun(/** @type {number} */ startTimeMs) {
        const durationTotal = Date.now() - startTimeMs;
        const status = this.stats.errors.length > 0 ? 'PARTIAL' : 'SUCCESS';

        logger.info(`[PipelineCore] Run completed.`, { runId: this.runId, connector: this.connector.name, stats: this.stats, durationMs: durationTotal });

        // Phase 4: Full Traceability into ImportLog & SyncRun
        try {
            await db.insert(ImportLog).values({
                run_id: this.runId,
                source_name: `CRON_${this.modelName.toUpperCase()}_${this.connector.name.toUpperCase()}`,
                status: status,
                items_new: this.stats.created,
                items_updated: this.stats.updated,
                items_skipped: this.stats.skippedExisting,
                items_total: this.stats.processed,
                error_count: this.stats.errors.length,
                logs: this.stats.errors.length > 0 ? JSON.stringify(this.stats.errors.slice(0, 50)) : null,
                duration_ms: durationTotal
            });

            await db.insert(SyncRun).values({
                id: crypto.randomUUID(),
                source_id: `pipeline-${this.connector.name}`,
                status: status.toLowerCase(),
                started_at: new Date(startTimeMs),
                ended_at: new Date(),
                stats: {
                    fetched: this.stats.fetched,
                    processed: this.stats.processed,
                    created: this.stats.created,
                    updated: this.stats.updated,
                    skipped: this.stats.skippedExisting,
                    errors: this.stats.errors.slice(0, 20),
                    processing_stage_ms: this.stats.durationByStage
                }
            });
        } catch (traceErr) {
            logger.error(`[PipelineCore] Failed to save traceability logs`, { runId: this.runId, err: traceErr.message });
        }

        return this.stats;
    }
}
