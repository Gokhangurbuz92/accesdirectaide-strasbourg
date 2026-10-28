// @ts-nocheck
import logger from '../_utils/logger.js';
import { db } from '../../src/db/index.js';
import { ToolboxItem } from '../../src/db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { verifyAdmin } from '../_utils/auth.js';

// PKG-11 audit: draft previews use the platform's administrator session check (named admin; the retired token only where allowed). The former local
// jwt.verify accepted any admin-role token without MFA (and in guides.js the dev-login flag opened it even in production).
const isAdmin = (/** @type {any} */ req) => verifyAdmin(req).catch(() => false);
/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    const { method } = req;

    // Parse URL for path params (facets or slug)
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const parts = pathname.split('/').filter(p => p);
    const lastPart = parts[parts.length - 1];

    let possibleSlug = null;
    let isFacets = false;

    if (lastPart === 'facets') {
        isFacets = true;
    } else if (lastPart !== 'tools' && lastPart !== 'api') {
        possibleSlug = lastPart;
    }

    const query = req.query || Object.fromEntries(new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams);
    const { categorie, type, public: publicFilter, statut } = query;

    try {
        if (method === 'GET') {
            // 1. FACETS
            if (isFacets) {
                const items = await db.query.ToolboxItem.findMany({
                    where: (t, { eq }) => eq(t.statut, 'publie'),
                    columns: { categorie: true, publics: true, type: true },
                });
                const categories = [...new Set(items.map(i => i.categorie).filter(Boolean))].sort();
                const publics = [...new Set(items.flatMap(i => i.publics || []))].sort();
                const types = [...new Set(items.map(i => i.type).filter(Boolean))].sort();
                res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=300');
                return res.json({ categories, publics, types });
            }

            // 2. DETAIL (SLUG)
            const slugToFind = possibleSlug || req.query.slug;
            if (slugToFind) {
                const item = await db.query.ToolboxItem.findFirst({
                    where: (t, { eq }) => eq(t.slug, slugToFind),
                });
                if (!item) return res.status(404).json({ error: "Not found" });
                if (item.statut !== 'publie' && !(await isAdmin(req))) return res.status(404).json({ error: "Not found" });   // unpublished = unknown (no existence oracle)
                return res.json(item);
            }

            // 3. LIST
            const viewingAsAdmin = req.query.admin === 'true' && (await isAdmin(req));

            /** @type {((t: any, ops: any) => any) | undefined} */
            let whereClause;
            if (!viewingAsAdmin) {
                whereClause = (t, { eq: eqOp, and: andOp }) => {
                    const conditions = [eqOp(t.statut, 'publie')];
                    if (categorie) conditions.push(eqOp(t.categorie, categorie));
                    if (type) conditions.push(eqOp(t.type, type));
                    return conditions.length === 1 ? conditions[0] : andOp(...conditions);
                };
            } else {
                whereClause = (t, { eq: eqOp, and: andOp }) => {
                    const conditions = [];
                    if (statut) conditions.push(eqOp(t.statut, statut));
                    if (categorie) conditions.push(eqOp(t.categorie, categorie));
                    if (type) conditions.push(eqOp(t.type, type));
                    if (conditions.length === 0) return undefined;
                    return conditions.length === 1 ? conditions[0] : andOp(...conditions);
                };
            }

            // Note: Drizzle `has` filter for array fields is not directly
            // available in Drizzle relational API. The publicFilter is
            // handled post-query for now.
            const items = await db.query.ToolboxItem.findMany({
                where: whereClause,
                orderBy: (t, { desc }) => [desc(t.published_at)],
                limit: 50,
            });

            const filtered = publicFilter
                ? items.filter(i => Array.isArray(i.publics) && i.publics.includes(publicFilter))
                : items;

            return res.json(filtered);
        }

        // PKG-11 audit: no write here any more (raw request body, no MFA, no audit, permanent DELETE). Toolbox items have no editor: they are seeded data; a governed editor would go through /api/admin/content.
        if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

        res.status(405).json({ error: "Method not allowed" });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
}
