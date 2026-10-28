// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { sql } from 'drizzle-orm';
import { verifyAdmin } from '../../_utils/auth.js';

/**
 * GET /api/admin/rag-health
 *
 * Returns per-aide embedding status for the admin cockpit.
 * Lists all aides with their id, titre, slug, updatedAt, and whether they have an embedding.
 * Used by AdminAides to display the RAG status column.
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('ADMIN_API', ip);
    if (!rateLimit.allowed) {
        return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: 'Unauthorized: Admin Token Required' });
    }

    try {
        // Raw SQL because Drizzle can't select/filter on Unsupported("vector") column types
        const aidesRes = await db.execute(sql`
            SELECT
                id,
                titre,
                slug,
                statut,
                "updatedAt",
                CASE WHEN embedding IS NOT NULL THEN true ELSE false END AS "hasEmbedding"
            FROM "Aide"
            ORDER BY "updatedAt" DESC
        `);
        const aides = aidesRes.rows || aidesRes;

        return res.status(200).json({
            success: true,
            data: aides.map(a => ({
                id: a.id,
                titre: a.titre,
                slug: a.slug,
                statut: a.statut,
                updatedAt: a.updatedAt,
                hasEmbedding: a.hasEmbedding,
            })),
        });
    } catch (error) {
        logger.error('[Admin RAG Health Error]:', error);
        return res.status(500).json({ success: false, error: 'Erreur lors de la récupération du statut RAG' });
    }
}
