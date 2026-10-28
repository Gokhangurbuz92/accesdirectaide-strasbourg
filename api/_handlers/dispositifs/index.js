import { sql } from 'drizzle-orm';
import { stripReviewFields, visibleSql, visibleWhere } from '../../lib/publicVisibility.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
/** PKG-11 / P09: the aides and structures linked to a dispositif, ONLY those that are public themselves (D-5); the raw id lists never leave the server. @param {Record<string, any>} row */
const publicView = (row) => { const { related_aide_ids: _a, related_structure_ids: _s, ...d } = row; return stripReviewFields(d); };
/** @param {Record<string, any>} d */
async function relatedOf(d) {
    /** @param {unknown} xs */
    const ids = (xs) => (Array.isArray(xs) && xs.length ? sql`ARRAY[${sql.join(xs.map((x) => sql`${String(x)}`), sql`, `)}]::text[]` : null);
    const a = ids(d.related_aide_ids); const s = ids(d.related_structure_ids);
    const aides = a ? (await db.execute(sql`SELECT slug, titre FROM "Aide" WHERE id = ANY(${a}) AND ${visibleSql('aide')} ORDER BY titre`)).rows : [];
    const structures = s ? (await db.execute(sql`SELECT slug, nom, ville FROM "Structure" WHERE id = ANY(${s}) AND ${visibleSql('structure')} ORDER BY nom`)).rows : [];
    return { aides, structures };
}

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    if (req.method !== 'GET') {
         return res.status(405).json({ error: 'Method not allowed' });
    }

    // Support both Vercel req.query and fallback parsing
    const query = req.query || Object.fromEntries(new URL(req.url, `http://${req.headers.host}`).searchParams);

    const { departement, public: publicCible, id, slug } = query;

    try {
        // 1. Single Item Lookup
        if (id || slug) {
            const dispositif = await db.query.Dispositif.findFirst({
                where: (t, { eq, and }) => {
                    const conditions = [visibleWhere(t, 'dispositif')];   // D-5
                    if (id) conditions.push(eq(t.id, id));
                    if (slug) conditions.push(eq(t.slug, slug));
                    return conditions.length === 1 ? conditions[0] : and(...conditions);
                },
            });

            if (!dispositif) {
                return res.status(404).json({ error: 'Dispositif non trouvé' });
            }

            return res.status(200).json({ ...publicView(dispositif), related: await relatedOf(dispositif) });
        }

        // 2. List Lookup
        const dispositifs = await db.query.Dispositif.findMany({
            where: (t, { eq, and }) => {
                const conditions = [visibleWhere(t, 'dispositif')];   // D-5
                if (departement) conditions.push(eq(t.departement, departement));
                return conditions.length === 1 ? conditions[0] : and(...conditions);
            },
            orderBy: (t, { asc }) => [asc(t.titre)],
        });

        // Post-filter for array `has` (Drizzle relational API doesn't support it)
        const filtered = publicCible
            ? dispositifs.filter(d => Array.isArray(d.public) && d.public.includes(publicCible))
            : dispositifs;

        return res.status(200).json(filtered.map((d) => publicView(d)));
    } catch (error) {
        logger.error({ err: error }, "Dispositifs API Error");
        return res.status(500).json({ error: 'Failed to fetch dispositifs' });
    }
}
