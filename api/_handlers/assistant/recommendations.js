// @ts-nocheck
import logger from '../../_utils/logger.js';
import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';


import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { generateCitizenLocalQueryEmbedding } from '../../lib/ai-foundation.js';
import { searchAidesHybrid } from '../../lib/hybrid-search.js';
import { searchDemarches, searchStructures } from '../../lib/search-query.js';

// --- Constants ---
const VALID_TYPES = ['aide', 'demarche', 'structure'];
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 20;
const MAX_NEED_LENGTH = 200;

// --- PKG-11 / P16: ranking and « why shown » ---
/*
 * Before: the need text could leave for an external embedding provider, a postal code was used as a département filter (no démarche or structure ever matched
 * « 67000 »), structures linked to /annuaire/<slug> (no such page), and results were concatenated by kind (all aides first). Now: LOCAL query embedding only
 * (lexical when the local model is unavailable), démarches are not filtered by place (national procedures apply everywhere), structures by the département of
 * a postal code, each kind keeps its relevance order and the kinds alternate, and each lead says why it is shown.
 */
const fold = (/** @type {unknown} */ v) => String(v || '').toLowerCase().replace(/œ/g, 'oe').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** @param {unknown} territory @returns {string | undefined} the département of a postal code (Corse is ambiguous: none), or a département code as given */
export function departementOf(territory) {
    const t = String(territory || '').trim().toUpperCase();
    if (/^97\d{3}$/.test(t)) return t.slice(0, 3);
    if (/^20\d{3}$/.test(t)) return undefined;
    if (/^\d{5}$/.test(t)) return t.slice(0, 2);
    if (/^(\d{2}|2A|2B|97\d)$/.test(t)) return t;
    return undefined;
}
/** @param {Record<string, unknown>} item @param {string[]} words */
export function whyShownOf(item, words) {
    const services = Array.isArray(item._services) ? item._services : [];
    if (services.length) return `la structure indique proposer ${services.map((s) => `« ${s} »`).join(', ')}`;
    const hay = ` ${fold(`${item.title || ''} ${item.excerpt || ''}`)} `;
    const found = words.filter((w) => hay.includes(` ${w}`));
    return found.length ? `correspond ${found.length > 1 ? 'aux mots' : 'au mot'} ${found.map((w) => `« ${w} »`).join(', ')} de votre besoin` : 'proche de votre besoin dans le catalogue (recherche par le sens)';
}
/** best of each kind first, then alternating: [a1, d1, s1, a2, d2, s2, …] @param {Array<Array<Record<string, unknown>>>} lists */
export function interleave(lists) {
    const out = []; const max = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < max; i += 1) for (const l of lists) if (l[i]) out.push(l[i]);
    return out;
}

// --- Normalizers ---

/**
 * @param {unknown} body
 * @returns {Record<string, unknown>}
 */
function parseBody(body) {
    if (!body) return {};
    if (typeof body === 'string') {
        try { return JSON.parse(body); } catch { return {}; }
    }
    if (typeof body === 'object') return /** @type {Record<string, unknown>} */ (body);
    return {};
}

/**
 * Normalize an aide item into the unified recommendation schema.
 * @param {Record<string, unknown>} item
 * @returns {Record<string, unknown>}
 */
function normalizeAide(item) {
    const slug = item.slug || null;
    return {
        type: 'aide',
        slug,
        title: item.title || item.titre || null,
        excerpt: item.description || item.cest_quoi || item.summary_falc || null,
        url: slug ? `/aides/${slug}` : null,
        sourceLabel: item.source_name || item.source_org || item.providerName || null,
        sourceUrl: item.provenance?.sourceUrl || item.source_url || null,
        // @ts-ignore
        verifiedAt: item.provenance?.verifiedAt || item.date_verification || null,
    };
}

/**
 * Normalize a demarche item into the unified recommendation schema.
 * @param {Record<string, unknown>} item
 * @returns {Record<string, unknown>}
 */
function normalizeDemarche(item) {
    const slug = item.slug || null;
    return {
        type: 'demarche',
        slug,
        title: item.titre || null,
        excerpt: item.description_courte || item.summary_falc || null,
        url: slug ? `/demarches/${slug}` : null,
        sourceLabel: null,
        // @ts-ignore
        sourceUrl: item.provenance?.sourceUrl || item.source_url || item.source_url_exact || null,
        // @ts-ignore
        verifiedAt: item.provenance?.verifiedAt || item.date_verification || null,
    };
}

/**
 * Normalize a structure item into the unified recommendation schema.
 * @param {Record<string, unknown>} item
 * @returns {Record<string, unknown>}
 */
function normalizeStructure(item) {
    const slug = item.slug || null;
    return {
        type: 'structure',
        slug,
        title: item.nom || null,
        excerpt: item.description_courte || null,
        url: slug ? `/structures/${encodeURIComponent(String(slug))}` : null,
        // @ts-ignore E04: the declared / bookable services that matched (internal, turned into whyShown)
        _services: Array.isArray(item.whyShown?.services) ? item.whyShown.services : [],
        sourceLabel: null,
        // @ts-ignore
        sourceUrl: item.provenance?.sourceUrl || item.source_url || item.source_url_exact || null,
        // @ts-ignore
        verifiedAt: item.provenance?.verifiedAt || item.date_verification || null,
    };
}

/**
 * POST /api/assistant/recommendations
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const requestId = req.requestId || randomUUID();
    const log = logger.child({ handler: 'assistant-recommendations', requestId });

    // --- Method gate ---
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, requestId, error: 'method_not_allowed' });
    }

    // --- Rate limit ---
    const ip = getClientIp(req);
    const limit = await checkRateLimit('ASSISTANT_RECOS', ip);
    if (!limit.allowed) {
        // @ts-ignore
        return res.status(getRateLimitStatus(limit)).json({
            ...(limit.error || { error: 'rate_limited' }),
            requestId,
        });
    }

    // --- Parse & validate input ---
    const payload = parseBody(req.body);
    const { need, territory, limit: rawLimit, types: rawTypes } = payload;

    if (typeof need !== 'string' || need.trim().length === 0) {
        return res.status(400).json({
            ok: false,
            requestId,
            error: 'invalid_need',
            message: 'Le champ "need" est requis (1-200 caractères).',
        });
    }

    const trimmedNeed = need.trim();
    if (trimmedNeed.length > MAX_NEED_LENGTH) {
        return res.status(400).json({
            ok: false,
            requestId,
            error: 'need_too_long',
            message: `Le champ "need" ne peut pas dépasser ${MAX_NEED_LENGTH} caractères.`,
        });
    }

    const resultLimit = Math.min(
        Math.max(1, typeof rawLimit === 'number' ? rawLimit : DEFAULT_LIMIT),
        MAX_LIMIT,
    );

    // Validate types
    let requestedTypes = VALID_TYPES;
    if (Array.isArray(rawTypes) && rawTypes.length > 0) {
        const filtered = rawTypes.filter((t) => typeof t === 'string' && VALID_TYPES.includes(t));
        if (filtered.length === 0) {
            return res.status(400).json({
                ok: false,
                requestId,
                error: 'invalid_types',
                message: `Les types valides sont : ${VALID_TYPES.join(', ')}.`,
            });
        }
        requestedTypes = filtered;
    }

    const territoryStr = typeof territory === 'string' ? territory.trim() || undefined : undefined;

    // --- Execute searches in parallel ---
    try {
        /** @type {Array<Array<Record<string, unknown>>>} */
        const lists = [];
        const words = [...new Set(fold(trimmedNeed).split(' ').filter((w) => w.length >= 4))];

        // Calculate per-type limit (distribute evenly, minimum 2 per type)
        const perTypeLimit = Math.max(2, Math.ceil(resultLimit / requestedTypes.length));

        const searchPromises = [];

        // --- Aides: embedding + lexical hybrid ---
        if (requestedTypes.includes('aide')) {
            searchPromises.push(
                (async () => {
                    let embedding = null; let embeddingModel = null;
                    try {
                        ({ embedding, embeddingModel } = await generateCitizenLocalQueryEmbedding(trimmedNeed));   // local loopback model only
                    } catch {
                        log.info({ msg: 'recos.local_embedding_unavailable' });   // lexical search still runs
                    }

                    const { items } = await searchAidesHybrid({
                        query: trimmedNeed,
                        limit: perTypeLimit,
                        embedding,
                        embeddingModel,
                    });

                    return items.map(normalizeAide);
                })(),
            );
        }

        // --- Demarches: lexical ---
        if (requestedTypes.includes('demarche')) {
            searchPromises.push(
                (async () => {
                    const { items } = await searchDemarches({
                        q: trimmedNeed,
                        pageSize: perTypeLimit,
                        page: 1,
                        sort: 'relevance',
                        statut: 'publie',
                        hideTestContent: true,
                    });

                    return items.map(normalizeDemarche);
                })(),
            );
        }

        // --- Structures: lexical ---
        if (requestedTypes.includes('structure')) {
            searchPromises.push(
                (async () => {
                    const { items } = await searchStructures({
                        q: trimmedNeed,
                        departement: departementOf(territoryStr),
                        pageSize: perTypeLimit,
                        page: 1,
                        sort: 'relevance',
                    });

                    return items.map(normalizeStructure);
                })(),
            );
        }

        // Await all searches in parallel
        const results = await Promise.allSettled(searchPromises);

        for (const result of results) {
            if (result.status === 'fulfilled') {
                lists.push(result.value);
            } else {
                log.warn({ msg: 'recos.search_partial_failure', error: result.reason?.message || String(result.reason) });
            }
        }

        // Rank: best of each kind first, alternating; trim; say why each lead is shown
        const finalItems = interleave(lists).slice(0, resultLimit).map(({ _services, ...it }) => ({ ...it, whyShown: whyShownOf({ ...it, _services }, words) }));

        log.info({ msg: 'recos.success', requestId, count: finalItems.length, types: requestedTypes });

        return res.status(200).json({
            items: finalItems,
            meta: {
                from: 'search',
                method: 'embedding+lexical',
                requestId,
            },
        });
    } catch (error) {
        const errorName = error instanceof Error ? error.name : 'unknown';
        log.error({ msg: 'recos.failed', errorName, requestId });

        Sentry.captureException(error, {
            tags: { route: 'assistant/recommendations', requestId },
        });

        return res.status(500).json({
            ok: false,
            requestId,
            error: 'internal',
            message: 'Une erreur interne est survenue.',
        });
    }
}
