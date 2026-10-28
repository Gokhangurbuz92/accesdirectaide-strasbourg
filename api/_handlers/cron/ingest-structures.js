import logger from '../../_utils/logger.js';
import { getCronAuth } from '../../_utils/cronAuth.js';
import { db } from '../../../src/db/index.js';
import { Structure, ImportLog, SyncRun, ReviewQueueItem } from '../../../src/db/schema.js';
import { snapshotRow } from '../../_services/content-versions.js';
import { and, eq, sql } from 'drizzle-orm';
import { classifyStructureChange, factValues, identityKey, isCompleteFetch } from '../../lib/ingestion/structureChanges.js';
import crypto from 'crypto';
import { geocodeAddress } from '../../_utils/geocoder.js';
import { withLock } from '../../_utils/pipelineLock.js';
import { computeContentHash } from '../../_utils/contentHash.js';
import { ensureSlugOrNull } from '../../_utils/slug.js';
import { upsertSourceDocument } from '../../_utils/sourceDocument.js';
import { StructureIngestSchema } from '../../lib/ingestion/validators.js';

const DATASETS = [
    {
        id: 'mediation_numerique_lieux',
        name: "Médiation numérique – lieux (Strasbourg)",
        url: "https://opendata.strasbourg.eu/api/explore/v2.1/catalog/datasets/mediation_numerique_lieux/records?limit=100",   // pages of PAGE_SIZE via &offset=
        trust_level: "OFFICIAL"
    }
];


const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/** D14: the structure of this dataset with the same identity (SIRET, else name + postal code). @param {string} datasetId @param {Record<string, any>} v */
async function findByIdentity(datasetId, v) {
    const siret = String(v.siret || '').replace(/\s+/g, '');
    const where = /^\d{14}$/.test(siret)
        ? and(eq(Structure.source_id, datasetId), eq(Structure.siret, siret))
        : and(eq(Structure.source_id, datasetId), sql`lower(trim(${Structure.nom})) = lower(trim(${v.nom}))`, eq(Structure.code_postal, v.code_postal));
    return db.query.Structure.findFirst({ where });
}

/**
 * D14: a person reviews a source difference on a VERIFIED structure (never overwritten automatically). One OPEN item per structure and difference.
 * @param {{ id: string, slug?: string | null, nom?: string | null }} row
 * @param {Record<string, { current: unknown, source: unknown }>} diff
 * @param {string} datasetId
 * @param {string} [reason]
 * @returns {Promise<boolean>} true when a new item was queued
 */
async function queueSourceChange(row, diff, datasetId, reason = 'SOURCE_FACT_CHANGED') {
    const details = { dataset: datasetId, diff };
    const open = await db.select({ id: ReviewQueueItem.id }).from(ReviewQueueItem)
        .where(and(eq(ReviewQueueItem.entityType, 'structure'), eq(ReviewQueueItem.entityId, row.id), eq(ReviewQueueItem.reason, reason), eq(ReviewQueueItem.status, 'OPEN'),
            sql`${ReviewQueueItem.details} = ${JSON.stringify(details)}::jsonb`)).limit(1);
    if (open.length) return false;
    await db.insert(ReviewQueueItem).values({ entityType: 'structure', entityId: row.id, entitySlug: row.slug || null, title: row.nom || null, reason, severity: 'P2', status: 'OPEN', details });
    return true;
}

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
 * Pure ingestion logic for Structures
 * @param {{ limit?: number, runId?: string }} params
 * @returns {Promise<{ fetched: number, processed: number, created: number, updated: number, skippedExisting: number, metadataOnly?: number, reviewQueued?: number, removed?: number, errors: string[], durationByStage: { fetchMs: number, processingMs: number } }>}
 */
export async function runIngestStructures({ limit, runId }) {
    // Log format: INGEST_<SOURCE>_ENTER url=<...>
    // URL is from DATASETS[0] for simplicity in this loop
    logger.info(`INGEST_STRUCTURES_ENTER url=${DATASETS[0].url}`);

    // Ensure runId
    if (!runId) runId = crypto.randomUUID();

    /** @type {{ fetched: number, processed: number, created: number, updated: number, skippedExisting: number, metadataOnly: number, reviewQueued: number, removed: number, errors: string[], durationByStage: { fetchMs: number, processingMs: number } }} */
    const stats = {
        fetched: 0,
        processed: 0,
        created: 0,
        updated: 0,
        skippedExisting: 0,
        metadataOnly: 0,
        reviewQueued: 0,
        removed: 0,
        errors: [],
        durationByStage: {
            fetchMs: 0,
            processingMs: 0
        }
    };

    const startTotal = Date.now();

    for (const dataset of DATASETS) {
        // PKG-11 / D14: every page of the dataset (the URL asked for 100 records only, the rest was never seen), bounded; a failed page makes the fetch partial
        const startFetch = Date.now();
        /** @type {any[]} */
        let items = [];
        let announced = null;
        let fetchFailed = false;
        for (let page = 0; page < MAX_PAGES; page += 1) {
            const pageUrl = `${dataset.url}&offset=${page * PAGE_SIZE}`;
            let response;
            try {
                response = await fetch(pageUrl);
            } catch (fetchErr) {
                stats.errors.push(`${dataset.id}: Fetch failed - ${getErrorMessage(fetchErr)}`);
                logger.error(`[STRUCTURES] Fetch Error: ${getErrorMessage(fetchErr)}`);
                fetchFailed = true; break;
            }
            if (!response.ok) {
                const bodyText = await response.text().catch(() => '');
                stats.errors.push(`${dataset.id}: HTTP ${response.status} - ${bodyText.substring(0, 200)}`);
                fetchFailed = true; break;
            }
            let data;
            try { data = await response.json(); } catch (parseErr) { stats.errors.push(`${dataset.id}: JSON Parse Error - ${getErrorMessage(parseErr)}`); fetchFailed = true; break; }
            let pageItems = data?.results || data?.records || [];
            if (!Array.isArray(pageItems)) pageItems = Array.isArray(data) ? data : [];
            if (typeof data?.total_count === 'number') announced = data.total_count;
            items = items.concat(pageItems);
            if (pageItems.length < PAGE_SIZE || (announced != null && items.length >= announced)) break;
        }
        const fetchDuration = Date.now() - startFetch;
        stats.durationByStage.fetchMs += fetchDuration;
        if (items.length === 0 && !fetchFailed) {
            stats.errors.push(`[STRUCTURES] 0 items found for ${dataset.id} — last known good kept`);
        }
        logger.info(`INGEST_STRUCTURES_FETCH_DONE fetchMs=${fetchDuration} items=${items.length} announced=${announced}`);
        stats.fetched += items.length;

        const limited = Boolean(limit && limit > 0 && items.length > limit);
        if (limit && limit > 0) items = items.slice(0, limit);
        const complete = !fetchFailed && isCompleteFetch({ received: items.length, announced, limited });

        /** @type {Set<string>} ids of the structures of this dataset present in this fetch */
        const seen = new Set();
        const startProcess = Date.now();
        for (const item of items) {
            stats.processed++;
            try {
                // Determine fields based on API version (v2.1 has direct fields, v1 had 'fields' wrapper)
                const f = item.fields || item;
                const nom = f.nom || f.name || f.raison_sociale || f.structure_nom_usage || "Inconnu";

                let fullAdresse = [f.adresse_num, f.adresse_lib, f.adresse_cplt].filter(Boolean).join(' ');
                if (!fullAdresse && f.adresse) fullAdresse = f.adresse;

                const ville = f.commune || f.ville || "Strasbourg";
                const cp = (f.code_postal || f.cp || "").toString();

                // Zod Validation Shield
                const validationTarget = {
                    nom: nom?.trim(),
                    adresse: fullAdresse?.trim() || "Inconnue", // Ensure an address exists or fallback safely
                    ville: ville?.trim(),
                    code_postal: cp?.trim(),
                    telephone: f.tel || f.telephone || null,
                    email: f.mail || f.email || null,
                    site_web: f.url || f.site_internet || null,
                    siret: f.siret ? String(f.siret).replace(/\s+/g, '') : null,
                    source_id: dataset.id,
                    source_url: dataset.url,
                };

                const parsed = StructureIngestSchema.safeParse(validationTarget);
                if (!parsed.success) {
                    const errorIssues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
                    stats.errors.push(`Record validation fail: ${nom} - ${errorIssues}`);
                    logger.warn({ nom, errors: errorIssues }, 'INGEST_STRUCTURE_VALIDATION_ERROR');
                    continue;
                }

                const val = parsed.data;
                const hash = computeContentHash({
                    nom: val.nom,
                    fullAdresse: val.adresse,
                    ville: val.ville,
                    cp: val.code_postal,
                    email: val.email,
                    telephone: val.telephone,
                    site: val.site_web,
                });

                /** @type {string | null} */ let sourceDocumentId = null;
                try {
                    const sourceDocument = await upsertSourceDocument({
                        sourceUrl: dataset.url,
                        rawContent: JSON.stringify(item),
                        metadata: { entityType: 'structure', datasetId: dataset.id, datasetName: dataset.name },
                    });
                    sourceDocumentId = sourceDocument.id;
                } catch {
                    stats.errors.push(`${dataset.id}: source document failed`);
                }

                // D14: identity is the dataset + SIRET, else the dataset + name + postal code — never the content (a changed phone number was a new structure)
                const existing = await findByIdentity(dataset.id, val) || await db.query.Structure.findFirst({ where: eq(Structure.raw_data_hash, hash) });
                const change = classifyStructureChange(existing, val, sourceDocumentId);

                if (existing && change.state === 'UNCHANGED') {
                    seen.add(existing.id);
                    await db.update(Structure).set({ last_checked_at: new Date(), import_status: 'active' }).where(eq(Structure.id, existing.id));
                    stats.skippedExisting++;
                } else if (existing && change.state === 'METADATA_ONLY_CHANGED') {
                    seen.add(existing.id);   // FR-107: no reprocessing, only the traceability links move
                    await db.update(Structure).set({ raw_data_hash: hash, source_document_id: sourceDocumentId, last_sync: new Date(), last_checked_at: new Date(), import_batch: runId, import_status: 'active' })
                        .where(eq(Structure.id, existing.id));
                    stats.metadataOnly++;
                } else if (existing && change.state === 'NORMALIZED_FACT_CHANGED') {
                    seen.add(existing.id);
                    const current = /** @type {Record<string, unknown>} */ (existing); const incoming = /** @type {Record<string, unknown>} */ (factValues(val));
                    const diff = Object.fromEntries(change.changed.map((field) => [field, { current: current[field] ?? null, source: incoming[field] ?? null }]));
                    if (existing.verification_status === 'VERIFIED') {
                        // a verified record is never overwritten by the source: a person reviews the difference (one open item per difference)
                        const queued = await queueSourceChange(existing, diff, dataset.id);
                        await db.update(Structure).set({ last_checked_at: new Date(), import_status: 'active' }).where(eq(Structure.id, existing.id));
                        if (queued) stats.reviewQueued++;
                    } else {
                        // A07: the exact prior row is kept (same version store as every other change: listed in /admin/versions, restorable)
                        await db.transaction(async (tx) => {
                            await snapshotRow(tx, 'structure', existing.id, `SOURCE_UPDATE ${dataset.id}: ${change.changed.join(', ')}`, 'ingestion');
                            await tx.update(Structure).set({ ...factValues(val), raw_data_hash: hash, source_document_id: sourceDocumentId, last_sync: new Date(), last_checked_at: new Date(), import_batch: runId, import_status: 'active' })
                                .where(eq(Structure.id, existing.id));
                        });
                        stats.updated++;
                    }
                } else {
                    // CREATE - Valve 1: Ingest
                    const baseSlug = ensureSlugOrNull(val.nom);
                    const normalizedSlug = ensureSlugOrNull(`${baseSlug || 'structure'}-${crypto.createHash('sha256').update(identityKey(dataset.id, val)).digest('hex').substring(0, 6)}`);
                    const [newStructure] = await db.insert(Structure).values({
                        nom: val.nom,
                        slug: normalizedSlug || null,
                        adresse: `${val.adresse} ${val.code_postal} ${val.ville}`.trim(),
                        ville: val.ville,
                        code_postal: val.code_postal,
                        telephone: val.telephone,
                        email: val.email,
                        site_web: val.site_web,
                        siret: typeof val.siret === 'string' && val.siret ? val.siret : null,   // passthrough field (zod: unknown)
                        source_id: dataset.id,
                        source_url: dataset.url,
                        raw_data_hash: hash,
                        source_document_id: sourceDocumentId,
                        import_batch: runId,
                        last_checked_at: new Date(),
                        services: [],
                        publics_accueillis: [],
                        categories_aidees: [],
                        statut: "brouillon",
                        import_status: "active"
                    }).returning();
                    seen.add(newStructure.id);

                    // Valve 2: Enrich (Geocoding)
                    const geo = await geocodeAddress(`${val.adresse}, ${val.code_postal} ${val.ville}`);
                    if (geo && geo.score > 0.7) {
                        await db.update(Structure).set({ latitude: geo.lat, longitude: geo.lng, geoloc_status: "success", quality_score: 80 }).where(eq(Structure.id, newStructure.id));
                    } else {
                        await db.update(Structure).set({ geoloc_status: "failed", quality_score: 40 }).where(eq(Structure.id, newStructure.id));
                    }

                    // Valve 3: Publish
                    if (dataset.trust_level === "OFFICIAL") {
                        const updated = await db.query.Structure.findFirst({ where: eq(Structure.id, newStructure.id) });
                        if (updated && updated.quality_score >= 80) {
                            await db.update(Structure).set({ statut: "actif", published_at: new Date() }).where(eq(Structure.id, newStructure.id));
                        }
                    }

                    stats.created++;
                }
            } catch (recErr) {
                logger.error({ error: getErrorMessage(recErr) }, "Structure Record Error:");
                stats.errors.push(`Record fail: ${getErrorMessage(recErr)}`);
            }
        }

        // D14 / FR-029: a record absent from a COMPLETE fetch is soft-removed (kept, flagged); a verified one goes to review. A partial or empty fetch removes nothing.
        if (complete) {
            const previous = await db.select({ id: Structure.id, nom: Structure.nom, slug: Structure.slug, verification_status: Structure.verification_status })
                .from(Structure).where(and(eq(Structure.source_id, dataset.id), eq(Structure.import_status, 'active')));
            for (const gone of previous.filter((r) => !seen.has(r.id))) {
                await db.update(Structure).set({ import_status: 'removed', last_checked_at: new Date() }).where(eq(Structure.id, gone.id));
                if (gone.verification_status === 'VERIFIED') await queueSourceChange(gone, { removed: { current: 'présente', source: 'absente de la source' } }, dataset.id, 'SOURCE_RECORD_REMOVED');
                stats.removed++;
            }
        }
        stats.durationByStage.processingMs += (Date.now() - startProcess);
    }

    // Log the Run
    try {
        await db.insert(ImportLog).values({
            source_name: 'CRON_STRUCTURES_ALSACE',
            status: stats.errors.length > 0 ? 'PARTIAL' : 'SUCCESS',
            items_new: stats.created,
            items_total: stats.processed,
            items_updated: stats.updated,
            items_skipped: stats.skippedExisting,
            error_count: stats.errors.length,
            logs: stats.errors.length ? JSON.stringify(stats.errors) : null,
            duration_ms: Date.now() - startTotal
        });
    } catch (e) { logger.error({ err: e }, "Log Create Failed"); }

    return stats;
}
/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    // 1. Authorization
    const auth = getCronAuth(req);
    if (!auth.ok) {
        if (auth.reason === 'missing_secret') {
            return res.status(500).json({ error: 'CRON_SECRET is not configured' });
        }
        logger.warn("Unauthorized Ingest-Structures Attempt");
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const runId = crypto.randomUUID();

    try {
        // Use distributed lock to prevent concurrent runs
	        const stats = await withLock('ingest-structures', async () => {
	            // Log sync run start
	            await db.insert(SyncRun).values({
	                id: runId,
	                source_id: 'pipeline-structures', // Provide a valid string instead of null
	                status: 'running',
                    started_at: new Date()
                });

            try {
                const result = await runIngestStructures({ limit, runId });
                
                // Update sync run with success
                await db.update(SyncRun).set({
                    status: result.errors.length > 0 ? 'partial' : 'success',
                    ended_at: new Date(),
                    error: result.errors.length > 0 ? result.errors.join('; ') : null,
                    stats: result
                }).where(eq(SyncRun.id, runId));

                return result;
            } catch (error) {
                // Update sync run with failure
                await db.update(SyncRun).set({
                    status: 'failed',
                    ended_at: new Date(),
                    error: getErrorMessage(error)
                }).where(eq(SyncRun.id, runId));
                throw error;
            }
        });

        return res.status(200).json(stats);
    } catch (err) {
        if (getErrorMessage(err).includes('already running')) {
            logger.warn({ runId }, 'Ingest-Structures already running, skipping');
            return res.status(409).json({ error: 'Pipeline already running', runId });
        }
        
        logger.error({ runId, error: getErrorMessage(err) }, "Handler Structure Error");
        return res.status(500).json({ error: 'Internal Server Error', runId });
    }
}
