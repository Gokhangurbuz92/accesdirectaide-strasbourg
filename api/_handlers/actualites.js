import { db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { eq, or, and, sql, desc, asc, ilike } from 'drizzle-orm';
import { verifyAdmin } from '../_utils/auth.js';
import { logger } from '../lib/logger.js'; // Ensure logger is imported
import { searchActualitesSchema } from '../_utils/validators.js';
import crypto from 'crypto';
import { buildProvenance } from '../_utils/provenance.js';
import { buildNewsFeed, enrichItem, loadRegistry, relatedTo } from '../_services/news/feed.js';
import { discoverCoverage } from '../_services/news/discovery-gdelt.js';

/** Actualités v2: the window the editorial feed is built from (published items, newest first) — bounded so a request stays cheap */
export const NEWS_V2_WINDOW = 600;
let registryCache = null;
const newsRegistry = () => (registryCache ||= loadRegistry());
const V2_COLUMNS = { id: true, slug: true, titre: true, resume: true, summary_falc: true, date_publication: true, updatedAt: true, published_at: true, type_actu: true,
  categorie: true, est_important: true, image_url: true, canonical_url: true, lien_url: true, url: true, source_url: true, auto_publish: true, raw_payload_json: true, statut: true };
async function newsWindow() {
  return db.query.Actualite.findMany({ where: eq(schema.Actualite.statut, 'publie'), orderBy: [desc(schema.Actualite.date_publication), desc(schema.Actualite.id)], limit: NEWS_V2_WINDOW, columns: V2_COLUMNS });
}
/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */

const MALFORMED_SLUG = Symbol('malformed-slug');

/**
 * R29: an item published by the automatic verification was checked against its original page on that day; any other item has no verification date
 * @param {Pick<typeof schema.Actualite.$inferSelect, 'auto_publish' | 'updatedBy' | 'published_at'> | null | undefined} item
 */
const newsVerifiedAt = (item) => (item?.auto_publish && item?.updatedBy === 'verification-automatique' && item?.published_at) || null;
/**
 * R29: what a visitor receives — never who decided (`updatedBy`, an administrator id) nor the editorial note (it can name a reviewer), nor the raw feed payload
 * @template {{ updatedBy?: unknown, commentaire_statut?: unknown, raw_payload_json?: unknown, ingest_batch?: unknown, raw_data_hash?: unknown }} T @param {T} row
 */
export const publicNewsFields = (row) => {
  const { updatedBy: _by, commentaire_statut: _note, raw_payload_json: _raw, ingest_batch: _batch, raw_data_hash: _hash, ...rest } = row;
  return rest;
};
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
        // Support both `/api/actualites/:slug` and `/actualites/:slug` (depending on runtime rewrites).
        const match = pathname.match(/^\/(?:api\/)?actualites\/([^/?#]+)/);
        if (!match) return null;
        // Q04: an undecodable segment (« %E0%A4%A ») is a malformed detail request, not « no slug » (it used to return the whole list, publicly cached)
        let slug; try { slug = decodeURIComponent(match[1] || '').trim(); } catch { return MALFORMED_SLUG; }
        return slug || null;
    } catch {
        return null;
    }
}

/**
 * @param {string | undefined} sort
 * @returns {Array<import('drizzle-orm').SQL<unknown>>}
 */
function buildOrderBy(sort) {
    const s = String(sort || '').trim();
    if (!s || s === 'recent' || s === '-recent' || s === '-date_publication') {
        return [desc(schema.Actualite.date_publication), desc(schema.Actualite.id)];
    }
    if (s === 'date_publication') {
        return [asc(schema.Actualite.date_publication), asc(schema.Actualite.id)];
    }
    if (s === 'updated_date') {
        return [asc(schema.Actualite.updatedAt), asc(schema.Actualite.id)];
    }
    if (s === '-updated_date') {
        return [desc(schema.Actualite.updatedAt), desc(schema.Actualite.id)];
    }
    if (s === 'quality') {
        return [desc(schema.Actualite.quality_score), desc(schema.Actualite.date_publication), desc(schema.Actualite.id)];
    }
    if (s === '-quality') {
        return [asc(schema.Actualite.quality_score), asc(schema.Actualite.id)];
    }
    if (s === 'titre') {
        return [asc(schema.Actualite.titre), asc(schema.Actualite.id)];
    }
    if (s === '-titre') {
        return [desc(schema.Actualite.titre), desc(schema.Actualite.id)];
    }
    // "relevance" fallback: stable recent-first ordering.
    return [desc(schema.Actualite.date_publication), desc(schema.Actualite.id)];
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const requestId = crypto.randomUUID();
    const isAdmin = await verifyAdmin(req);

    try {
        const rawQuery = req.query || {};
        const slugFromPath = extractSlugFromPath(req.url, req.headers?.host);
        if (slugFromPath === MALFORMED_SLUG) return res.status(400).json({ error: 'Invalid parameters', details: { slug: 'malformed' } });
        const queryWithPath = { ...rawQuery };
        if (slugFromPath && !queryWithPath.slug && !queryWithPath.id) {
            queryWithPath.slug = slugFromPath;
        }

        // PKG-11 audit: no write here any more — the generic CRUD took any column, deleted permanently and wrote no audit row, and PUT {statut:'publie'}
        // bypassed the moderation rules. Moderation: POST /api/admin/actions (named MFA administrator, https source only, audited).

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const validation = searchActualitesSchema.safeParse(queryWithPath);
        if (!validation.success) {
            return res.status(400).json({ error: 'Invalid parameters', details: validation.error.format() });
        }

        const params = validation.data;
        const effectiveParams = { ...params };

        // Query param alias
        if (effectiveParams.limit != null) {
            effectiveParams.pageSize = effectiveParams.limit;
        }
        if (!effectiveParams.territoire && effectiveParams.territory) {
            effectiveParams.territoire = effectiveParams.territory;
        }

        // Default sort:
        // - With q: relevance
        // - Without q: recent
        if (!effectiveParams.sort) {
            effectiveParams.sort = effectiveParams.q ? 'relevance' : 'recent';
        }

        // Public endpoint: only published items unless admin.
        if (!isAdmin) {
            effectiveParams.statut = 'publie';
        }

        // 1) Single item (ID or slug)
        if (effectiveParams.id || effectiveParams.slug) {
            const item = await db.query.Actualite.findFirst({
                where: effectiveParams.id ? eq(schema.Actualite.id, effectiveParams.id) : eq(schema.Actualite.slug, effectiveParams.slug || ''),
                with: {
                  sourceDocument: {
                    columns: {
                      fetched_at: true,
                      source_url: true,
                    },
                  },
                },
            });

            if (!item) return res.status(404).json({ error: 'Not found' });
            // an ADA article that was retracted stays visible as a retraction notice (never silently removed): 410 with the note and its date
            if (!isAdmin && item.statut === 'retire' && item.type_actu === 'ada_original') {
                const ed = /** @type {any} */ (item.raw_payload_json)?.ada?.editorial || {};
                return res.status(410).json({ error: 'Gone', retracted: true, titre: item.titre, retractedAt: ed.retractedAt || null, note: String(ed.retractionNote || '').slice(0, 500) });
            }
            if (!isAdmin && item.statut !== 'publie') return res.status(404).json({ error: 'Not found' });
            /** @type {any} */ let news = null;
            if (!isAdmin || effectiveParams.view === 'v2') {
                news = enrichItem(item, newsRegistry());
                // a source whose rights are not (or no longer) evidenced, or a link-only report, has no article page here
                if (!isAdmin && (!news || news.externalOnly)) return res.status(404).json({ error: 'Not found' });
                if (news) {
                    try {
                        const feed = buildNewsFeed(await newsWindow(), { group: true, balance: false, pageSize: 50, page: 1 }, newsRegistry());
                        const all = feed.items; const story = all.find((c) => c.id === news.id);
                        // optional worldwide discovery (links only, off unless NEWS_DISCOVERY_GDELT=on, bounded and cached)
                        const known = (story?.coverage || []).map((/** @type {any} */ c) => { try { return new URL(c.url).hostname.replace(/^www\./, ''); } catch { return ''; } });
                        // a publisher whose terms forbid any reuse (registry « blocked »: AFP, AP, Reuters, …) is not listed, even as a link
                        const blockedHost = (/** @type {any} */ l) => { try { const h = new URL(l.url).hostname.replace(/^www\./, ''); return [h, `www.${h}`].some((x) => newsRegistry().byHost.get(x)?.status === 'blocked'); } catch { return true; } };
                        const found = news.titre ? (await discoverCoverage(news.titre, { exclude: known })).filter((/** @type {any} */ l) => !blockedHost(l)) : [];
                        news = { ...news, coverage: [...(story?.coverage || []), ...found], related: relatedTo(story || { ...news, storyKey: null }, all).map((/** @type {any} */ r) => ({ id: r.id, slug: r.slug, titre: r.titre, date_publication: r.date_publication, publisher: r.publisher, geo: r.geo, topics: r.topics })) };
                    } catch (e) { logger.warn('actualites v2 related unavailable', { requestId, error: e }); news = { ...news, coverage: [], related: [] }; }
                }
            }

            const { sourceDocument, ...row } = item;
            const safeItem = isAdmin ? row : publicNewsFields(row);
            return res.status(200).json({
              ...safeItem,
              ...(news ? { news } : {}),
              provenance: buildProvenance({
                verifiedAt: newsVerifiedAt(row),
                fetchedAt: sourceDocument?.fetched_at || safeItem.fetched_at,
                sourceUrl:
                  sourceDocument?.source_url ||
                  safeItem.source_url ||
                  safeItem.canonical_url ||
                  safeItem.lien_url ||
                  safeItem.url,
              }),
            });
        }

        // 2) Listing / search
        // Actualités v2: the editorial feed (place, category, story grouping, balance, rights per source); the legacy list below is unchanged
        const wantsV2 = effectiveParams.view === 'v2' || ['geo', 'topic', 'from', 'to', 'group', 'balance', 'franceShare'].some((k) => /** @type {any} */ (effectiveParams)[k] != null);
        if (wantsV2 && effectiveParams.statut === 'publie') {
            try {
                const ep = /** @type {any} */ (effectiveParams);
                const feed = buildNewsFeed(await newsWindow(), {
                    geo: ep.geo, topic: ep.topic, source: ep.source, q: ep.q, from: ep.from, to: ep.to,
                    sort: ep.sort === 'relevance' ? 'relevant' : 'recent', group: ep.group !== '0', balance: ep.balance !== '0',
                    franceShare: ep.franceShare, page: ep.page || 1, pageSize: ep.pageSize || 12,
                }, newsRegistry());
                return res.status(200).json({ view: 'v2', items: feed.items, facets: feed.facets, window: NEWS_V2_WINDOW,
                    pagination: { total: feed.total, page: feed.page, limit: feed.pageSize, pageSize: feed.pageSize, totalPages: Math.ceil(feed.total / feed.pageSize), hasNext: feed.page * feed.pageSize < feed.total } });
            } catch (dbError) {
                logger.error('Actualites v2 DB Error (Recovered):', { requestId, error: dbError });
                res.setHeader?.('Cache-Control', 'no-store');
                return res.status(200).json({ view: 'v2', degraded: true, items: [], facets: { topics: {}, geo: { france: 0, monde: 0, alsace: 0 }, sources: {} },
                    pagination: { total: 0, page: 1, limit: 12, pageSize: 12, totalPages: 0, hasNext: false } });
            }
        }

        const andConditions = [];

        if (effectiveParams.statut) {
            andConditions.push(eq(schema.Actualite.statut, effectiveParams.statut));
        }
        if (effectiveParams.categorie) {
            andConditions.push(eq(schema.Actualite.categorie, effectiveParams.categorie));
        }
        if (effectiveParams.territoire) {
            andConditions.push(eq(schema.Actualite.territoire, effectiveParams.territoire));
        }
        if (effectiveParams.source) {
            const source = `%${effectiveParams.source}%`;
            andConditions.push(or(
                ilike(schema.Actualite.source_name, source),
                ilike(schema.Actualite.source_nom, source),
                ilike(schema.Actualite.source, source)
            ));
        }
        if (effectiveParams.q) {
            const q = `%${effectiveParams.q}%`;
            andConditions.push(or(
                ilike(schema.Actualite.titre, q),
                ilike(schema.Actualite.resume, q),
                ilike(schema.Actualite.contenu, q)
            ));
        }

        const whereCondition = andConditions.length > 0 ? and(...andConditions) : undefined;
        const orderByArr = buildOrderBy(effectiveParams.sort);
        const page = effectiveParams.page || 1;
        const pageSize = effectiveParams.pageSize || 10;
        const skip = (page - 1) * pageSize;

        try {
            const [totalCountResult, items] = await Promise.all([
                db.select({ count: sql`count(*)` }).from(schema.Actualite).where(whereCondition),
                db.query.Actualite.findMany({
                    where: whereCondition,
                    orderBy: orderByArr,
                    offset: skip,
                    limit: pageSize,
                    columns: {
                        id: true,
                        slug: true,
                        titre: true,
                        resume: true,
                        summary_falc: true,
                        date_publication: true,
                        updatedAt: true,
                        type_actu: true,
                        categorie: true,
                        est_important: true,
                        image_url: true,
                        canonical_url: true,
                        lien_url: true,
                        url: true,
                        source_name: true,
                        source_nom: true,
                        source_url: true,
                        quality_score: true,
                        fetched_at: true,
                        auto_publish: true,
                        published_at: true,
                        updatedBy: true,
                    },
                    with: {
                        sourceDocument: {
                          columns: {
                            fetched_at: true,
                            source_url: true,
                          },
                        },
                    },
                }),
            ]);
            const total = Number(totalCountResult[0].count);

            const itemsWithProvenance = items.map((item) => {
              const { sourceDocument, ...row } = item;
              const safeItem = isAdmin ? row : publicNewsFields(row);
              return {
                ...safeItem,
                provenance: buildProvenance({
                  verifiedAt: newsVerifiedAt(row),
                  fetchedAt: sourceDocument?.fetched_at || safeItem.fetched_at,
                  sourceUrl:
                    sourceDocument?.source_url ||
                    safeItem.source_url ||
                    safeItem.canonical_url ||
                    safeItem.lien_url ||
                    safeItem.url,
                }),
              };
            });

            return res.status(200).json({
                items: itemsWithProvenance,
                pagination: {
                    total,
                    page,
                    limit: pageSize,
                    pageSize,
                    totalPages: Math.ceil(total / pageSize),
                    hasNext: page * pageSize < total,
                },
            });
        } catch (dbError) {
            logger.error('Actualites DB Error (Recovered):', { requestId, error: dbError });
            // PKG-11 audit: still the 200 + empty envelope of the frozen contract, but SAID (degraded) and never cached: the page shows its error state instead
            // of « Aucune actualité », and the CDN no longer keeps the empty answer for 5 min + 6 h
            res.setHeader?.('Cache-Control', 'no-store');
            return res.status(200).json({
                degraded: true,
                items: [],
                pagination: {
                    total: 0,
                    page,
                    limit: pageSize,
                    pageSize,
                    totalPages: 0,
                    hasNext: false,
                },
            });
        }

    } catch (error) {
        logger.error('Actualites handler error:', { requestId, error });
        return res.status(500).json({ error: 'Internal server error' });
    }
}
