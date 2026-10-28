// @ts-nocheck
import logger from '../_utils/logger.js';
import { db } from '../../src/db/index.js';
import { Guide } from '../../src/db/schema.js';
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
    } else if (lastPart !== 'guides' && lastPart !== 'api') {
        possibleSlug = lastPart;
    }

    // Polyfill req.query for local dev-server (raw node http)
    const query = req.query || Object.fromEntries(urlObj.searchParams);
    const { categorie, public: publicFilter, statut } = query;

    try {
        // --- PUBLIC GET ---
        if (method === 'GET') {
            // 1. FACETS
            if (isFacets) {
                const guides = await db.query.Guide.findMany({
                    where: (t, { eq }) => eq(t.statut, 'publie'),
                    columns: { categorie: true, publics: true, contexte: true },
                });

                const categories = [...new Set(guides.map(g => g.categorie).filter(Boolean))].sort();
                const publics = [...new Set(guides.flatMap(g => g.publics || []))].sort();
                const contexts = [...new Set(guides.flatMap(g => g.contexte || []))].sort();

                res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=300');
                return res.json({ categories, publics, contextes: contexts });
            }

            // 2. DETAIL (SLUG)
            const slugToFind = possibleSlug || query.slug;
            if (slugToFind) {
                const guide = await db.query.Guide.findFirst({
                    where: (t, { eq }) => eq(t.slug, slugToFind),
                });

                // PKG-11 / A02: an unpublished guide answers exactly like an unknown one (no existence oracle; 403 used to confirm a draft existed)
                if (!guide || (guide.statut !== 'publie' && !(await isAdmin(req)))) return res.status(404).json({ error: "Not found" });
                return res.json(guide);
            }

            // 3. LIST
            const viewingAsAdmin = query.admin === 'true' && (await isAdmin(req));

            /** @type {((t: any, ops: any) => any) | undefined} */
            let whereClause;
            if (!viewingAsAdmin) {
                whereClause = (t, { eq: eqOp, and: andOp }) => {
                    const conditions = [eqOp(t.statut, 'publie')];
                    if (categorie) conditions.push(eqOp(t.categorie, categorie));
                    return conditions.length === 1 ? conditions[0] : andOp(...conditions);
                };
            } else {
                whereClause = (t, { eq: eqOp, and: andOp }) => {
                    const conditions = [];
                    if (statut) conditions.push(eqOp(t.statut, statut));
                    if (categorie) conditions.push(eqOp(t.categorie, categorie));
                    if (conditions.length === 0) return undefined;
                    return conditions.length === 1 ? conditions[0] : andOp(...conditions);
                };
            }

            const guides = await db.query.Guide.findMany({
                where: whereClause,
                orderBy: (t, { desc }) => [desc(t.published_at)],
                limit: 50,
            });

            // Post-filter for array `has` (Drizzle relational API doesn't support it)
            let filtered = guides;
            if (publicFilter) filtered = filtered.filter(g => Array.isArray(g.publics) && g.publics.includes(publicFilter));
            if (query.contexte) filtered = filtered.filter(g => Array.isArray(g.contexte) && g.contexte.includes(query.contexte));

            return res.json(filtered);
        }

        // PKG-11 audit: no write here any more (raw request body, no MFA, no audit, permanent DELETE). Guides are written through /api/admin/content (named MFA administrator, editorial allow-list, versions, archive instead of delete).
        if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed', hint: '/api/admin/content?kind=guide' });

        res.status(405).json({ error: "Method not allowed" });

    } catch (e) {
        logger.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
}
