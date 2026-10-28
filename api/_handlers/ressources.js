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
import { eq, and, desc, count } from 'drizzle-orm';
import { checkRateLimit, getClientIp } from '../_utils/rateLimit.js';
import { z } from 'zod';

const searchRessourcesSchema = z.object({
    id: z.string().optional(),
    slug: z.string().optional(),
    type: z.string().optional(),
    territory_scope: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(12),
    emergency: z.enum(['1', 'true']).optional()
});
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

        // 1. Single Item (ID or Slug)
        if (params.id || params.slug) {
            const ressource = await db.query.ResourceAccessibility.findFirst({
                where: params.id ? eq(ResourceAccessibility.id, params.id) : eq(ResourceAccessibility.slug, params.slug || '')
            });

            if (!ressource || ressource.status !== 'published') {
                return res.status(404).json({ error: "Ressource non trouvée" });
            }
            return res.status(200).json(ressource);
        }

        // 2. Search / List
        const conditionArr = [eq(ResourceAccessibility.status, 'published')];

        if (params.type) {
            conditionArr.push(eq(ResourceAccessibility.type, params.type));
        }

        if (params.territory_scope) {
            conditionArr.push(eq(ResourceAccessibility.territory_scope, params.territory_scope));
        }
        
        const conditions = conditionArr.length === 1 ? conditionArr[0] : and(...conditionArr);

        const [items, totalRes] = await Promise.all([
            db.query.ResourceAccessibility.findMany({
                where: conditions,
                orderBy: [desc(ResourceAccessibility.createdAt)],
                offset: (params.page - 1) * params.pageSize,
                limit: params.pageSize
            }),
            db.select({ count: count() }).from(ResourceAccessibility).where(conditions)
        ]);
        const total = Number(totalRes[0].count);

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
