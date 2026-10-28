// @ts-nocheck
import { decide, stripReviewFields } from '../lib/publicVisibility.js';
import { db } from '../../src/db/index.js';
import { sql, eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema.js';
import { searchDemarchesSchema } from '../_utils/validators.js';
import { searchDemarches } from '../lib/search-query.js';
import { verifyAdmin } from '../_utils/auth.js';
import { logger } from '../lib/logger.js';
import * as Sentry from '@sentry/node';
import crypto from 'crypto';
import { buildProvenance } from '../_utils/provenance.js';

const DEMARCHE_TEST_TITLE_PATTERN = /^(?:d[ée]marche\s+)?test\b/i;

/**
 * @param {string | null | undefined} titre
 * @returns {boolean}
 */
function isTestDemarcheTitle(titre) {
    if (!titre) return false;
    return DEMARCHE_TEST_TITLE_PATTERN.test(String(titre).trim());
}
const MALFORMED_SLUG = Symbol('malformed-slug');
/**
 * @param {string | null | undefined} url
 * @param {string | null | undefined} host
 * @returns {string | null | typeof MALFORMED_SLUG}
 */
function extractSlugFromPath(url, host = 'localhost') {
    if (!url) return null;
    try {
        const urlObj = new URL(url, `https://${host}`);
        const pathname = urlObj.pathname || '';
        // Support both `/api/demarches/:slug` and `/demarches/:slug` (depending on runtime rewrites).
        const match = pathname.match(/^\/(?:api\/)?demarches\/([^/?#]+)/);
        if (!match) return null;
        // Q04: an undecodable segment (« %E0%A4%A ») is a malformed detail request, not « no slug » (it used to return the whole list, publicly cached)
        let slug; try { slug = decodeURIComponent(match[1] || '').trim(); } catch { return MALFORMED_SLUG; }
        return slug || null;
    } catch {
        return null;
    }
}

/**
 * @param {unknown} value
 * @returns {string | undefined | null}
 */
function normalizeCategoryLikeParam(value) {
    if (!value) return value;
    const raw = String(value).trim();
    if (!raw) return undefined;

    // Allow callers to pass category codes (LOGEMENT, SANTE, ...) or slugs (logement, sante, ...).
    if (/^[A-Z_]+$/.test(raw)) return raw.toLowerCase();
    return raw;
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const requestId = crypto.randomUUID();
    const start = Date.now();
    const isAdmin = await verifyAdmin(req);

    try {
        // launch-readiness item 58: a read-only public resource. Writes answered 501 « Not implemented » (as if they were coming); the catalogue is edited through
        // /api/admin/content (named administrator with MFA, versioned, re-verified)
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.setHeader('Allow', 'GET, HEAD');
            return res.status(405).json({ error: 'Method not allowed' });
        }

        // Validate Input
        const rawQuery = req.query || {};
        const slugFromPath = extractSlugFromPath(req.url, req.headers?.host);
        if (slugFromPath === MALFORMED_SLUG) return res.status(400).json({ error: 'Invalid parameters', details: { slug: 'malformed' } });
        const queryWithPath = { ...rawQuery };
        if (slugFromPath && !queryWithPath.slug && !queryWithPath.id) {
            queryWithPath.slug = slugFromPath;
        }

        const validation = searchDemarchesSchema.safeParse(queryWithPath);
        if (!validation.success) {
            return res.status(400).json({ error: 'Invalid parameters', details: validation.error.format() });
        }
        const params = validation.data;
        const effectiveParams = { ...params };

        // Query param aliases
        if (effectiveParams.limit != null) {
            effectiveParams.pageSize = effectiveParams.limit;
        }
        if (!effectiveParams.category && effectiveParams.theme) {
            effectiveParams.category = effectiveParams.theme;
        }
        if (!effectiveParams.geo && effectiveParams.territoire) {
            effectiveParams.geo = effectiveParams.territoire;
        }
        if (!effectiveParams.geo && effectiveParams.territory) {
            effectiveParams.geo = effectiveParams.territory;
        }
        if (effectiveParams.category) {
            effectiveParams.category = normalizeCategoryLikeParam(effectiveParams.category);
        }

        // Default sort:
        // - With q: relevance
        // - Without q: quality first (then recent)
        if (!effectiveParams.sort) {
            effectiveParams.sort = effectiveParams.q ? 'relevance' : 'quality';
        }

        // Public endpoint: accept published and active items unless admin.
        if (!isAdmin) {
            effectiveParams.statut_in = ['publie', 'actif'];
        }

        // 1. Single Item
        if (effectiveParams.id || effectiveParams.slug) {
            const demarcheObj = await db.query.Demarche.findFirst({
                where: effectiveParams.id
                    ? eq(schema.Demarche.id, effectiveParams.id)
                    : eq(schema.Demarche.slug, effectiveParams.slug),
                with: {
                    category: {
                        columns: { id: true, slug: true, label: true },
                    },
                    sourceDocument: {
                        columns: { fetched_at: true, source_url: true },
                    },
                },
            });

            if (!demarcheObj) return res.status(404).json({ error: "Démarche non trouvée" });
            // D-5: the public sees a démarche only when published AND verified/current/eligible (admin reviewers keep access to everything, with the decision attached).
            const visibility = decide(demarcheObj, 'demarche');
            if (!isAdmin && !visibility.visible) {
                return res.status(404).json({ error: "Démarche non trouvée" });
            }
            if (!isAdmin && isTestDemarcheTitle(demarcheObj.titre)) {
                return res.status(404).json({ error: "Démarche non trouvée" });
            }

            const { sourceDocument, ...demarcheRest } = demarcheObj;
            const safeDemarche = stripReviewFields(demarcheRest, isAdmin);   // reviewer identity and hold reasons are internal
            return res.status(200).json({
                ...safeDemarche,
                provenance: {
                    ...buildProvenance({
                        verifiedAt: visibility.contentStatus === 'VERIFIED' ? safeDemarche.date_verification : null,
                        fetchedAt: sourceDocument?.fetched_at,
                        sourceUrl: sourceDocument?.source_url || safeDemarche.source_url || safeDemarche.source_url_exact,
                    }),
                    contentStatus: visibility.contentStatus,
                    freshness: visibility.freshness,
                    ...(isAdmin ? { publicVisibility: { visible: visibility.visible, reasons: visibility.reasons } } : {}),
                },
            });
        }

        // 2. Search / List
        logger.info('SEARCH_DEMARCHES_START', { requestId, path: req.url, query: rawQuery });

        let territoryFilter = null;
        if (effectiveParams.geo || effectiveParams.territory || effectiveParams.territoire) {
            const geo = effectiveParams.geo || effectiveParams.territory || effectiveParams.territoire;
            const { getHierarchy } = await import('../lib/geography/TerritoryService.js');
            const schemas = await import('../../src/db/schema.js');
            const { hierarchy } = await getHierarchy(geo, db, schemas);
            if (hierarchy && hierarchy.length > 0) {
                territoryFilter = { userTerritoryIds: hierarchy.map(h => h.id) };
            }
        }

        const { items, total } = await searchDemarches({
            ...effectiveParams,
            territoryFilter,
            hideTestContent: !isAdmin,
            publicOnly: !isAdmin,
        });

        return res.status(200).json({
            items,
            pagination: {
                total,
                page: effectiveParams.page,
                limit: effectiveParams.pageSize,
                pageSize: effectiveParams.pageSize,
                totalPages: Math.ceil(total / effectiveParams.pageSize),
                hasNext: effectiveParams.page * effectiveParams.pageSize < total
            }
        });

    } catch (error) {
        logger.error('SEARCH_DEMARCHES_ERROR', { requestId, duration_ms: Date.now() - start, error });
        Sentry.captureException(error, { extra: { requestId, query: req.query } });
        return res.status(500).json({ error: 'Internal server error' });
    }
}
