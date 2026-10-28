// @ts-nocheck
import logger from '../../_utils/logger.js';
import { withLock } from '../../_utils/pipelineLock.js';
/**
 * ingest-annuaire — Cron handler for ingesting Annuaire data (FINESS + RNA).
 *
 * Orchestrates the FINESS (health/social establishments) and RNA (associations)
 * connectors, upserting results into the Structure model with idempotent keys
 * (numero_finess, rna_id).
 *
 * Pattern: Same as ingest-aids.js and ingest-structures.js.
 */

import { getCronAuth } from '../../_utils/cronAuth.js';
import { db } from '../../../src/db/index.js';
import { Structure, ImportLog } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { computeContentHash } from '../../_utils/contentHash.js';
import { ensureSlugOrNull } from '../../_utils/slug.js';
import { upsertSourceDocument } from '../../_utils/sourceDocument.js';
import { fetchFinessData } from '../../lib/ingestion/FinessConnector.js';
import { fetchRnaData } from '../../lib/ingestion/RnaConnector.js';
import { applySourceUpdate } from '../../_services/source-updates.js';

/**
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'unknown error';
}

/**
 * Pure ingestion logic for Annuaire (FINESS + RNA).
 *
 * @param {{ limit?: number, runId?: string }} params
 * @returns {Promise<{
 *   fetched: number, processed: number, created: number, updated: number,
 *   skippedExisting: number, errors: string[],
 *   durationByStage: { fetchMs: number, processingMs: number }
 * }>}
 */
export async function runIngestAnnuaire({ limit, runId } = {}) {
    if (!runId) runId = crypto.randomUUID();

    const stats = {
        fetched: 0,
        processed: 0,
        created: 0,
        updated: 0,
        skippedExisting: 0,
        errors: [],
        durationByStage: { fetchMs: 0, processingMs: 0 },
    };

    const startTotal = Date.now();

    // ─────────────────────────────────────────────
    // 1. FINESS — Établissements sanitaires et sociaux
    // ─────────────────────────────────────────────
    logger.info(`[ANNUAIRE] Starting FINESS ingestion (runId: ${runId})`);
    try {
        const startFetch = Date.now();
        const finessItems = await fetchFinessData({ limit });
        stats.durationByStage.fetchMs += Date.now() - startFetch;
        stats.fetched += finessItems.length;

        logger.info(`[ANNUAIRE] FINESS fetched: ${finessItems.length} items`);

        const startProcess = Date.now();
        for (const item of finessItems) {
            stats.processed++;
            try {
                const hash = computeContentHash({
                    numero_finess: item.numero_finess,
                    nom: item.nom,
                    type_finess: item.type_finess,
                    adresse: item.adresse,
                    code_postal: item.code_postal,
                    ville: item.ville,
                    telephone: item.telephone,
                });

                const slug = ensureSlugOrNull(`finess-${item.nom}-${item.numero_finess}`);

                // Source document for traceability
                let sourceDocumentId = null;
                try {
                    const doc = await upsertSourceDocument({
                        sourceUrl: `https://finess.sante.gouv.fr/finess/detail.do?id=${item.numero_finess}`,
                        rawContent: JSON.stringify(item),
                        metadata: {
                            entityType: 'structure',
                            connector: 'FINESS',
                            numero_finess: item.numero_finess,
                        },
                    });
                    sourceDocumentId = doc.id;
                } catch {
                    stats.errors.push(`FINESS ${item.numero_finess}: source document failed`);
                }

                // Idempotent upsert by numero_finess
                const existing = await db.query.Structure.findFirst({
                    where: eq(Structure.numero_finess, item.numero_finess),
                });

                const data = {
                    nom: item.nom,
                    type_finess: item.type_finess,
                    adresse: `${item.adresse} ${item.code_postal} ${item.ville}`.trim(),
                    ville: item.ville,
                    code_postal: item.code_postal,
                    departement: item.departement,
                    telephone: item.telephone,
                    latitude: item.latitude,
                    longitude: item.longitude,
                    source_annuaire: 'FINESS',
                    source_id: 'FINESS',
                    source_url: `https://finess.sante.gouv.fr/finess/detail.do?id=${item.numero_finess}`,
                    raw_data_hash: hash,
                    source_document_id: sourceDocumentId,
                    last_checked_at: new Date(),
                    import_batch: runId,
                };

                if (existing) {
                    if (existing.raw_data_hash !== hash) {
                        // launch-readiness item 45: versioned, statut untouched, a verified record held until the veille re-verifies it
                        await applySourceUpdate({ kind: 'structure', id: existing.id, patch: { ...data, last_sync: new Date() }, source: data.source_annuaire });
                        stats.updated++;
                    } else {
                        stats.skippedExisting++;
                    }
                } else {
                    await db.insert(Structure).values({
                        ...data,
                        numero_finess: item.numero_finess,
                        slug: slug || null,
                        statut: 'actif', // FINESS = données officielles → publication directe
                        published_at: new Date(),
                        geoloc_status: item.latitude ? 'success' : 'pending',
                        quality_score: item.latitude ? 80 : 60,
                        import_status: 'active',
                        last_sync: new Date(),
                    });
                    stats.created++;
                }
            } catch (err) {
                logger.error(`[ANNUAIRE] FINESS item error (${item.numero_finess}):`, getErrorMessage(err));
                stats.errors.push(`FINESS ${item.numero_finess}: ${getErrorMessage(err)}`);
            }
        }
        stats.durationByStage.processingMs += Date.now() - startProcess;
    } catch (err) {
        logger.error('[ANNUAIRE] FINESS fatal error:', getErrorMessage(err));
        stats.errors.push(`FINESS fatal: ${getErrorMessage(err)}`);
    }

    // ─────────────────────────────────────────────
    // 2. RNA — Associations
    // ─────────────────────────────────────────────
    logger.info(`[ANNUAIRE] Starting RNA ingestion (runId: ${runId})`);
    try {
        const startFetch = Date.now();
        const rnaItems = await fetchRnaData({ limit });
        stats.durationByStage.fetchMs += Date.now() - startFetch;
        stats.fetched += rnaItems.length;

        logger.info(`[ANNUAIRE] RNA fetched: ${rnaItems.length} items`);

        const startProcess = Date.now();
        for (const item of rnaItems) {
            stats.processed++;
            try {
                const hash = computeContentHash({
                    rna_id: item.rna_id,
                    nom: item.nom,
                    objet: item.objet,
                    adresse: item.adresse,
                    code_postal: item.code_postal,
                    ville: item.ville,
                });

                const slug = ensureSlugOrNull(`asso-${item.nom}-${item.rna_id.slice(-6)}`);

                // Source document for traceability
                let sourceDocumentId = null;
                try {
                    const doc = await upsertSourceDocument({
                        sourceUrl: `https://www.journal-officiel.gouv.fr/associations/detail-annonce/associations_b/${item.rna_id}`,
                        rawContent: JSON.stringify(item),
                        metadata: {
                            entityType: 'structure',
                            connector: 'RNA',
                            rna_id: item.rna_id,
                        },
                    });
                    sourceDocumentId = doc.id;
                } catch {
                    stats.errors.push(`RNA ${item.rna_id}: source document failed`);
                }

                // Idempotent upsert by rna_id
                const existing = await db.query.Structure.findFirst({
                    where: eq(Structure.rna_id, item.rna_id),
                });

                const data = {
                    nom: item.nom,
                    adresse: `${item.adresse} ${item.code_postal} ${item.ville}`.trim(),
                    ville: item.ville,
                    code_postal: item.code_postal,
                    departement: item.departement,
                    type_structure: 'association',
                    source_annuaire: 'RNA',
                    source_id: 'RNA',
                    source_url: `https://www.journal-officiel.gouv.fr/associations/detail-annonce/associations_b/${item.rna_id}`,
                    raw_data_hash: hash,
                    source_document_id: sourceDocumentId,
                    last_checked_at: new Date(),
                    import_batch: runId,
                };

                if (existing) {
                    if (existing.raw_data_hash !== hash) {
                        // launch-readiness item 45: versioned, statut untouched, a verified record held until the veille re-verifies it
                        await applySourceUpdate({ kind: 'structure', id: existing.id, patch: { ...data, last_sync: new Date() }, source: data.source_annuaire });
                        stats.updated++;
                    } else {
                        stats.skippedExisting++;
                    }
                } else {
                    await db.insert(Structure).values({
                        ...data,
                        rna_id: item.rna_id,
                        slug: slug || null,
                        statut: 'brouillon', // RNA = données non vérifiées → modération
                        quality_score: 50,
                        import_status: 'active',
                        last_sync: new Date(),
                    });
                    stats.created++;
                }
            } catch (err) {
                logger.error(`[ANNUAIRE] RNA item error (${item.rna_id}):`, getErrorMessage(err));
                stats.errors.push(`RNA ${item.rna_id}: ${getErrorMessage(err)}`);
            }
        }
        stats.durationByStage.processingMs += Date.now() - startProcess;
    } catch (err) {
        logger.error('[ANNUAIRE] RNA fatal error:', getErrorMessage(err));
        stats.errors.push(`RNA fatal: ${getErrorMessage(err)}`);
    }

    // ─────────────────────────────────────────────
    // 3. Log the Run
    // ─────────────────────────────────────────────
    const durationTotal = Date.now() - startTotal;

    try {
        await db.insert(ImportLog).values({
            run_id: runId,
            source_name: 'CRON_ANNUAIRE',
            status: stats.errors.length > 0 ? 'PARTIAL' : 'SUCCESS',
            items_new: stats.created,
            items_updated: stats.updated,
            items_skipped: stats.skippedExisting,
            items_total: stats.processed,
            error_count: stats.errors.length,
            logs: stats.errors.length ? JSON.stringify(stats.errors) : null,
            duration_ms: durationTotal,
        });
    } catch (e) {
        logger.error('[ANNUAIRE] ImportLog failed:', getErrorMessage(e));
    }

    logger.info(`[ANNUAIRE] Done (${durationTotal}ms) — created: ${stats.created}, updated: ${stats.updated}, skipped: ${stats.skippedExisting}, errors: ${stats.errors.length}`);

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
        logger.warn('[ANNUAIRE] Unauthorized attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 200; // Default 200 to fit within Vercel timeout
    const runId = crypto.randomUUID();

    try {
        const stats = await withLock('ingest-annuaire', async () => {
            return runIngestAnnuaire({ limit, runId });
        }, { ttl: 900 });
        return res.status(200).json({ ok: true, runId, stats });
    } catch (error) {
        if (error.message?.includes('already running')) {
            logger.warn({ runId }, '[ANNUAIRE] Already running, skipping');
            return res.status(409).json({ error: 'Pipeline already running', runId });
        }
        logger.error('[ANNUAIRE] Handler error:', getErrorMessage(error));
        return res.status(500).json({ error: 'Internal Server Error', runId });
    }
}
