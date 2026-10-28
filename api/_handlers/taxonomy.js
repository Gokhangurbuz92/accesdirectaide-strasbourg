// @ts-nocheck
import { visibleWhere } from '../lib/publicVisibility.js';
import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, sql, and, asc, count, inArray } from 'drizzle-orm';
import { checkRateLimit, getClientIp } from '../_utils/rateLimit.js';
import { logger } from '../lib/logger.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const taxonomyJson = require('../data/taxonomy.json');

// Build color lookup from taxonomy.json
const colorBySlug = {};
for (const cat of taxonomyJson) {
    colorBySlug[cat.slug] = cat.color || null;
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('TAXONOMY', ip);
    if (!rateLimit.allowed) {
        return res.status(429).json(rateLimit.error);
    }

    try {
        const [rawCategories, rawSituations, rawAidSituations] = await Promise.all([
            db.query.AidCategory.findMany({ orderBy: [asc(schema.AidCategory.label)] }),
            db.query.LifeSituation.findMany({ orderBy: [asc(schema.LifeSituation.label)] }),
            db.query.Situation.findMany({ orderBy: [asc(schema.Situation.label)] }),
        ]);

        // Fetch counts efficiently using group by equivalent for published Aides and Demarches
        // Or if simple enough, construct the counts manually
        const [aidesAgg, demarchesAgg] = await Promise.all([
             db.select({
                 category: schema.Aide.categorie,
                 situation: schema.Aide.frequentation,
                 count: count()
             })
             .from(schema.Aide)
             .where(visibleWhere(schema.Aide, 'aide'))
             .groupBy(schema.Aide.categorie, schema.Aide.frequentation),
             
             db.select({
                 category: schema.Demarche.categorie,
                 situation: schema.Demarche.frequentation,
                 count: count()
             })
             .from(schema.Demarche)
             .where(visibleWhere(schema.Demarche, 'demarche'))
             .groupBy(schema.Demarche.categorie, schema.Demarche.frequentation),
        ]);

        const categories = rawCategories.map(cat => {
             const aidesCount = aidesAgg.filter(a => a.category === cat.slug).reduce((acc, a) => acc + Number(a.count), 0);
             const demarchesCount = demarchesAgg.filter(d => d.category === cat.slug).reduce((acc, d) => acc + Number(d.count), 0);
             return { ...cat, _count: { aides: aidesCount, demarches: demarchesCount } };
        });

        const situations = rawSituations.map(sit => {
             const aidesCount = aidesAgg.filter(a => a.situation === sit.slug).reduce((acc, a) => acc + Number(a.count), 0);
             const demarchesCount = demarchesAgg.filter(d => d.situation === sit.slug).reduce((acc, d) => acc + Number(d.count), 0);
             return { ...sit, _count: { aides: aidesCount, demarches: demarchesCount } };
        });

        // 3rd query: AidSituation relations -> count of published aides
        const aidRels = await db.select({
              situationId: schema.AidSituation.situationId,
              count: count()
        })
        .from(schema.AidSituation)
        .leftJoin(schema.Aide, eq(schema.AidSituation.aidId, schema.Aide.id))
        .where(visibleWhere(schema.Aide, 'aide'))
        .groupBy(schema.AidSituation.situationId);

        const aidSituations = rawAidSituations.map(s => {
             const matchingRel = aidRels.find(rel => rel.situationId === s.id);
             return { ...s, _count: { aidRelations: matchingRel ? Number(matchingRel.count) : 0 } };
        });

        // Merge DB categories with taxonomy.json to ensure all 13 are present
        const dbSlugs = new Set(categories.map(c => c.slug));
        const extraFromJson = taxonomyJson
            .filter(t => !dbSlugs.has(t.slug))
            .map(t => ({
                id: t.slug,
                slug: t.slug,
                label: t.label,
                color: t.color || null,
                count: 0,
                aidesCount: 0,
                demarchesCount: 0,
            }));

        return res.status(200).json({
            taxonomy: taxonomyJson,
            categories: [
                ...categories.map(c => ({
                    id: c.id,
                    slug: c.slug,
                    label: c.label,
                    // @ts-ignore
                    color: colorBySlug[c.slug] || null,
                    count: c._count.aides + c._count.demarches,
                    aidesCount: c._count.aides,
                    demarchesCount: c._count.demarches
                })),
                ...extraFromJson,
            ],
            situations: situations.map(s => ({
                id: s.id,
                slug: s.slug,
                label: s.label,
                count: s._count.aides + s._count.demarches,
                aidesCount: s._count.aides,
                demarchesCount: s._count.demarches
            })),
            aidSituations: aidSituations.map(s => ({
                id: s.id,
                code: s.code,
                slug: s.code,
                label: s.label,
                count: s._count.aidRelations
            }))
        });
    } catch (error) {
        // Fallback: if DB query fails (unseeded tables, connection error),
        // return taxonomy.json directly so the UI always has categories
        // @ts-ignore
        logger.warn('Taxonomy DB query failed, falling back to taxonomy.json', { error: error.message });
        return res.status(200).json({
            taxonomy: taxonomyJson,
            categories: taxonomyJson.map(t => ({
                id: t.slug,
                slug: t.slug,
                label: t.label,
                color: t.color || null,
                count: 0,
                aidesCount: 0,
                demarchesCount: 0,
            })),
            situations: [],
            aidSituations: [],
        });
    }
}

