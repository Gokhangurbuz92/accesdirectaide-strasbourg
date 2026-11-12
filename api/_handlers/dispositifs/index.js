import { sql } from 'drizzle-orm';
import { stripReviewFields, visibleSql, visibleWhere } from '../../lib/publicVisibility.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { categoryVariants } from '../../_services/verification/classify.js';
/** PKG-11 / P09: the aides and structures linked to a dispositif, ONLY those that are public themselves (D-5); the raw id lists never leave the server. @param {Record<string, any>} row */
const publicView = (row, opts = {}) => { const { related_aide_ids: _a, related_structure_ids: _s, ...d } = row; return stripReviewFields(d, false, opts); };
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

            return res.status(200).json({ ...publicView(dispositif, { detail: true }), related: await relatedOf(dispositif) });
        }

        // 2. Catalogue (12/11/2026): the paged list — with ?page the API answers { items, pagination } (up to 50 a page), searchable (title and description,
        // accents ignored), filtered by taxonomy category (the classification of the official fiche) and by scope (local programmes / national rules). The
        // official text never travels in a list. Without ?page the former array (callers that predate the catalogue).
        if (query.page !== undefined) {
            const page = Math.max(1, Math.min(1000, Number.parseInt(String(query.page), 10) || 1));
            const limit = Math.max(1, Math.min(50, Number.parseInt(String(query.limit ?? 20), 10) || 20));
            const q = String(query.q ?? '').trim().slice(0, 120);
            const category = String(query.category ?? '').trim().slice(0, 60);
            const scope = query.scope === 'local' || query.scope === 'national' ? query.scope : '';
            const fold = (/** @type {any} */ e) => sql`lower(translate(coalesce(${e}, ''), 'àâäçéèêëîïôöùûüÿœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ', 'aaaceeeeiioouuuyoaaaceeeeiioouuuy'))`;
            const folded = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const words = folded.split(/[^a-z0-9]+/).filter((w) => w.length >= 2).slice(0, 6);
            const where = [visibleSql('dispositif')];
            for (const w of words) where.push(sql`(${fold(sql`titre`)} LIKE ${`%${w}%`} OR ${fold(sql`description_falc`)} LIKE ${`%${w}%`})`);
            if (category) where.push(sql`(auto_check->'classification'->>'categorie') IN (${sql.join(categoryVariants(category).map((v) => sql`${v}`), sql`, `)})`);
            if (scope === 'local') where.push(sql`(departement IS NOT NULL OR NOT (auto_check ? 'official'))`);
            if (scope === 'national') where.push(sql`(departement IS NULL AND auto_check ? 'official')`);
            const cond = sql.join(where, sql` AND `);
            const [rows, total] = await Promise.all([
                db.execute(sql`SELECT id, slug, titre, description_falc, summary_falc, montant, liens, public, departement, territory_scope, auto_check->'classification'->>'categorie' AS categorie,
                    (auto_check ? 'official') AS official FROM "Dispositif" WHERE ${cond}
                    ORDER BY ${words.length ? sql`(${fold(sql`titre`)} LIKE ${`%${words[0]}%`}) DESC,` : sql``} (auto_check ? 'official') ASC, titre ASC LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
                db.execute(sql`SELECT count(*)::int AS n FROM "Dispositif" WHERE ${cond}`),
            ]);
            const n = Number(total.rows[0]?.n || 0);
            res.setHeader?.('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
            return res.status(200).json({ items: rows.rows, pagination: { total: n, page, limit, pageSize: limit, totalPages: Math.max(1, Math.ceil(n / limit)), hasNext: page * limit < n } });
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
