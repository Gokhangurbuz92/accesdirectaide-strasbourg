const EMERGENCY_RESOURCES = [
    { id: 'emergency-112', slug: 'urgence-112', title: 'Urgences européennes', type: 'URGENCE', phone: '112', content: 'Urgence immédiate, partout dans l’Union européenne.' },
    { id: 'emergency-15', slug: 'samu-15', title: 'SAMU', type: 'URGENCE', phone: '15', content: 'Urgence médicale.' },
    { id: 'emergency-17', slug: 'police-17', title: 'Police secours', type: 'URGENCE', phone: '17', content: 'Danger ou infraction nécessitant une intervention.' },
    { id: 'emergency-18', slug: 'pompiers-18', title: 'Sapeurs-pompiers', type: 'URGENCE', phone: '18', content: 'Incendie, accident ou secours.' },
    { id: 'emergency-115', slug: 'samu-social-115', title: 'SAMU social', type: 'URGENCE', phone: '115', content: 'Hébergement d’urgence et mise à l’abri.' },
];

import logger from '../_utils/logger.js';
import { db } from '../../src/db/index.js';
import { ResourceAccessibility } from '../../src/db/schema.js';
import { eq, and, desc, gte, isNotNull, lte } from 'drizzle-orm';
import { checkRateLimit, getClientIp } from '../_utils/rateLimit.js';
import { resourcePublicationSchema } from '../_utils/schema-features.js';
import { decideResource, publicView, TYPES } from '../_services/resource-publication.js';
import { maxAgeDays } from '../lib/publicVisibility.js';
import { z } from 'zod';

const searchRessourcesSchema = z.object({
    id: z.string().max(64).optional(),
    slug: z.string().max(120).optional(),
    type: z.string().max(40).optional(),
    territory_scope: z.string().max(80).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(12),
    emergency: z.enum(['1', 'true']).optional()
});

/**
 * C12 — a document of /ressources is public only when it meets the publication contract (api/_services/resource-publication.js): published by a named
 * administrator, official https source and its publisher, a human verification date no older than the catalogue's limit (180 days by default) and the
 * content unchanged since that verification. The SQL narrows the rows; decideResource() is the authority (same rule, plus the content check).
 * On a database WITHOUT migration 0050 no row can meet the contract (no publisher, no verification, no reviewer): the list is empty, as before C12,
 * and a single document answers 404. Rows created before 0050 are never public until a human completes and verifies them, whatever their old status.
 * The public answer never carries the reviewer's identity or the withdrawal reason.
 */
/** @param {Date} now @param {number} maxAge */
const publishedWhere = (now, maxAge) => and(
    eq(ResourceAccessibility.status, 'published'),
    isNotNull(ResourceAccessibility.verified_at), gte(ResourceAccessibility.verified_at, new Date(now.getTime() - maxAge * 86400000)), lte(ResourceAccessibility.verified_at, new Date(now.getTime() + 86400000)),
    isNotNull(ResourceAccessibility.reviewer_id), isNotNull(ResourceAccessibility.source_publisher), isNotNull(ResourceAccessibility.source_url),
);
/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */

async function handler(req, res) {
    try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const ip = getClientIp(req);
        const rateLimit = await checkRateLimit('SEARCH_RESSOURCES', ip);
        if (!rateLimit.allowed) {
            return res.status(429).json(rateLimit.error);
        }

        // Validate Input
        const validation = searchRessourcesSchema.safeParse(req.query);
        if (!validation.success) {
            return res.status(400).json({ error: 'Invalid parameters', details: validation.error.format() });
        }
        const params = validation.data;

        if (params.emergency) {
            return res.status(200).json({
                items: EMERGENCY_RESOURCES,
                pagination: { total: EMERGENCY_RESOURCES.length, page: 1, pageSize: EMERGENCY_RESOURCES.length, totalPages: 1 },
                emergency: true
            });
        }

        const has0050 = await resourcePublicationSchema(db);
        const now = new Date(); const maxAge = maxAgeDays();

        // 1. Single Item (ID or Slug)
        if (params.id || params.slug) {
            if (!has0050) return res.status(404).json({ error: "Ressource non trouvée" });
            const [ressource] = await db.select().from(ResourceAccessibility)
                .where(params.id ? eq(ResourceAccessibility.id, params.id) : eq(ResourceAccessibility.slug, params.slug || '')).limit(1);
            const decision = decideResource(ressource, { now, maxAge });
            // a withdrawn document says so (410), without its reason; anything else not public is simply not found
            if (ressource && ressource.status === 'withdrawn' && ressource.published_at) return res.status(410).json({ error: 'WITHDRAWN', withdrawn: true });
            if (!decision.visible) {
                return res.status(404).json({ error: "Ressource non trouvée" });
            }
            return res.status(200).json(publicView(ressource, decision.freshness));
        }

        // 2. Search / List
        if (!has0050 || (params.type && !TYPES.includes(params.type))) {
            return res.status(200).json({ items: [], pagination: { total: 0, page: params.page, pageSize: params.pageSize, totalPages: 0 } });
        }
        const conditionArr = [publishedWhere(now, maxAge)];
        if (params.type) conditionArr.push(eq(ResourceAccessibility.type, params.type));
        if (params.territory_scope) conditionArr.push(eq(ResourceAccessibility.territory_scope, params.territory_scope));
        const rows = await db.select().from(ResourceAccessibility).where(and(...conditionArr))
            .orderBy(desc(ResourceAccessibility.verified_at)).limit(500);
        const visible = rows.map((r) => ({ r, d: decideResource(r, { now, maxAge }) })).filter((x) => x.d.visible).map((x) => publicView(x.r, x.d.freshness));
        const total = visible.length;
        const items = visible.slice((params.page - 1) * params.pageSize, params.page * params.pageSize);

        return res.status(200).json({
            items,
            pagination: {
                total,
                page: params.page,
                pageSize: params.pageSize,
                totalPages: Math.ceil(total / params.pageSize)
            }
        });
    } catch (error) {
        logger.error({ err: error }, 'Ressources handler error:');
        return res.status(500).json({ error: 'Internal server error' });
    }
}

export default handler;
