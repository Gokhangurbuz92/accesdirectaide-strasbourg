// @ts-nocheck
import { visibleWhere } from '../lib/publicVisibility.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, and, or, ilike, asc, desc, count } from 'drizzle-orm';
import { checkRateLimit, getClientIp } from '../_utils/rateLimit.js';
import { logger } from '../lib/logger.js';

/**
 * GET /api/drees — List DREES social program data (APA, PCH, ASH, AAH, ASPA)
 * Supports filters: ?q=, ?category=, ?page=, ?limit=
 */
export default async function handler(/** @type {import('../_utils/http-types').ApiRequest} */ req, /** @type {import('../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('DREES_API', ip);
    if (!rateLimit.allowed) {
        return res.status(429).json(rateLimit.error);
    }

    try {
        const { q, category, page = '1', limit = '20' } = req.query || {};
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const skip = (pageNum - 1) * pageSize;

        const conditions = [
            visibleWhere(schema.Aide, 'aide'),   // D-5
            eq(schema.Aide.providerName, 'drees')
        ];

        if (q) {
            conditions.push(ilike(schema.Aide.titre, `%${q}%`));
        }

        if (category) {
            conditions.push(eq(schema.Aide.categorie, category.toLowerCase()));
        }

        const whereClause = and(...conditions);

        let items, totalRes;
        try {
            [items, totalRes] = await Promise.all([
                db.query.Aide.findMany({
                    where: whereClause,
                    offset: skip,
                    limit: pageSize,
                    orderBy: [asc(schema.Aide.titre)],
                    columns: {
                        id: true,
                        slug: true,
                        titre: true,
                        cest_quoi: true,
                        categorie: true,
                        theme: true,
                        territory_scope: true,
                        source_url: true,
                        apply_url: true,
                        providerName: true,
                        published_at: true,
                        updatedAt: true,
                    },
                }),
                db.select({ count: count() }).from(schema.Aide).where(whereClause),
            ]);
        } catch (selectError) {
            logger.warn('DREES_API_FULL_SELECT_FAILED', { error: selectError.message });
            [items, totalRes] = await Promise.all([
                db.query.Aide.findMany({
                    where: whereClause,
                    offset: skip,
                    limit: pageSize,
                    orderBy: [desc(schema.Aide.updatedAt)],
                    columns: {
                        id: true,
                        slug: true,
                        titre: true,
                        updatedAt: true,
                        statut: true,
                    },
                }),
                db.select({ count: count() }).from(schema.Aide).where(whereClause),
            ]);
        }
        const total = Number(totalRes[0].count);

        return res.status(200).json({
            items,
            pagination: {
                total,
                page: pageNum,
                limit: pageSize,
                totalPages: Math.ceil(total / pageSize),
                hasNext: pageNum * pageSize < total,
            },
        });
    } catch (error) {
        // @ts-ignore
        logger.error('DREES_API_ERROR', { error: error.message || error });

        // Never 500 — return empty valid JSON
        return res.status(200).json({
            items: [],
            pagination: { total: 0, page: 1, limit: 20, totalPages: 0, hasNext: false },
            _error: 'database_unavailable',
        });
    }
}
