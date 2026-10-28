// @ts-nocheck
import { logger } from '../logger.js';
import { SourceConnector } from './SourceConnector.js';
import crypto from 'crypto';

const API_BASE = 'https://aides-territoires.beta.gouv.fr/api/aids/';
const CONNEXION_URL = 'https://aides-territoires.beta.gouv.fr/api/connexion/';
const PAGE_SIZE = 50;
const PAGES_PER_RUN = 20; // 50 * 20 = 1000 aides per run (safe within Vercel 300s timeout)
const KV_CURSOR_KEY = 'at-connector:last-offset';

/**
 * Connector for the Aides Territoires API v1.8+ (beta.gouv.fr).
 *
 * Auth flow (2 steps):
 *   1. POST /api/connexion/ with header X-AUTH-TOKEN = static token
 *      → returns a Bearer token valid 24h
 *   2. Use Bearer token in Authorization header for all /api/aids/ calls
 *
 * Docs: https://aides-territoires.beta.gouv.fr/api/swagger/
 */
export class AidesTerritoiresConnector extends SourceConnector {
    constructor() {
        super('aides-territoires', 'https://aides-territoires.beta.gouv.fr');
        /** @type {Map<string, object>} */
        this._cache = new Map();
        /** @type {string|null} */
        this._bearerToken = null;
    }

    /**
     * Exchange the static X-AUTH-TOKEN for a 24h Bearer token.
     * @returns {Promise<string|null>} Bearer token or null if no API key configured
     */
    async _authenticate() {
        const apiKey = process.env.AIDES_TERRITOIRES_API_KEY;
        if (!apiKey) {
            logger.warn('[AidesTerritoires] No AIDES_TERRITOIRES_API_KEY set — API calls will likely fail with 401');
            return null;
        }

        try {
            const res = await fetch(CONNEXION_URL, {
                method: 'POST',
                headers: {
                    'X-AUTH-TOKEN': apiKey,
                    'Accept': 'application/json',
                },
                signal: AbortSignal.timeout(15_000),
            });

            if (!res.ok) {
                // R12 (D08): the answer body is never echoed (an authentication endpoint may repeat what it was sent)
                throw new Error(`Connexion API ${res.status}`);
            }

            const data = await res.json();
            // The API returns the bearer token in the response
            const token = data.token || data.access_token || data.bearer || data.Token;
            if (!token) {
                // R12 (D08): fail closed — no guessing a token out of an unexpected answer (the former fallback used any long string as the bearer)
                logger.warn('[AidesTerritoires] Connexion response missing token field', { keys: data && typeof data === 'object' ? Object.keys(data) : [] });
                return null;
            }

            this._bearerToken = token;
            logger.info('[AidesTerritoires] Bearer token acquired successfully');
            return token;
        } catch (err) {
            logger.error(`[AidesTerritoires] Authentication failed: ${err.message}`);
            throw err;
        }
    }

    /**
     * Build headers for API requests, including Bearer auth if available.
     * @returns {Record<string, string>}
     */
    _buildHeaders() {
        const headers = { Accept: 'application/json' };
        if (this._bearerToken) {
            // @ts-ignore
            headers['Authorization'] = `Bearer ${this._bearerToken}`;
        }
        return headers;
    }

    /**
     * Fetches all published aides from the API (paginated).
     * Returns a list of "virtual" URLs (one per aide) that the pipeline
     * will pass back to fetch() and parse().
     *
     * @returns {Promise<string[]>}
     */
    /**
     * Load last offset from Upstash KV (or 0 if first run).
     * @returns {Promise<number>}
     */
    async _loadCursor() {
        try {
            const kvUrl = process.env.KV_REST_API_URL;
            const kvToken = process.env.KV_REST_API_TOKEN;
            if (!kvUrl || !kvToken) return 0;

            const res = await fetch(`${kvUrl}/get/${KV_CURSOR_KEY}`, {
                headers: { Authorization: `Bearer ${kvToken}` },
                signal: AbortSignal.timeout(5_000),
            });
            if (!res.ok) return 0;
            const data = await res.json();
            const offset = parseInt(data.result, 10);
            return Number.isFinite(offset) ? offset : 0;
        } catch {
            return 0;
        }
    }

    /**
     * Save offset to Upstash KV for next run.
     * @param {number} offset
     */
    async _saveCursor(offset) {
        try {
            const kvUrl = process.env.KV_REST_API_URL;
            const kvToken = process.env.KV_REST_API_TOKEN;
            if (!kvUrl || !kvToken) return;

            await fetch(`${kvUrl}/set/${KV_CURSOR_KEY}/${offset}`, {
                headers: { Authorization: `Bearer ${kvToken}` },
                signal: AbortSignal.timeout(5_000),
            });
            logger.info(`[AidesTerritoires] Cursor saved: offset=${offset}`);
        } catch (err) {
            // @ts-ignore
            logger.warn(`[AidesTerritoires] Failed to save cursor: ${err.message}`);
        }
    }

    async getDetailUrls() {
        this._cache.clear();

        // Step 1: Authenticate (exchange static token → 24h bearer)
        await this._authenticate();

        // Step 2: Paginate through the API using 'next' URL
        let nextUrl = `${API_BASE}?published=true&page_size=${PAGE_SIZE}`;
        let pagesProcessed = 0;
        let totalCount = null;

        while (nextUrl && pagesProcessed < PAGES_PER_RUN) {
            pagesProcessed++;
            let response;
            let retries = 0;
            const maxRetries = 1;

            while (retries <= maxRetries) {
                try {
                    response = await fetch(nextUrl, {
                        headers: this._buildHeaders(),
                        signal: AbortSignal.timeout(30_000),
                    });
                    if (response.ok) break;
                    if (response.status >= 500 && retries < maxRetries) {
                        retries++;
                        logger.warn(`[AidesTerritoires] Retry ${retries}/${maxRetries} after ${response.status}`);
                        await new Promise(r => setTimeout(r, 2000));
                        continue;
                    }
                    throw new Error(`Aides Territoires API ${response.status}: ${response.statusText}`);
                } catch (err) {
                    if (retries < maxRetries && /** @type {Error} */ (err).name !== 'AbortError') {
                        retries++;
                        // @ts-ignore
                        logger.warn(`[AidesTerritoires] Retry ${retries}/${maxRetries}: ${err.message}`);
                        await new Promise(r => setTimeout(r, 2000));
                        continue;
                    }
                    throw err;
                }
            }

            const data = await response.json();
            const results = data.results || [];
            if (totalCount === null) totalCount = data.count || 0;

            if (results.length === 0) {
                logger.info(`[AidesTerritoires] No more results on page ${pagesProcessed}`);
                break;
            }

            for (const item of results) {
                const key = item.slug || item.id || crypto.randomUUID();
                const virtualUrl = `${this.baseUrl}/aides/${key}/`;
                this._cache.set(virtualUrl, item);
            }

            // Use the API's 'next' URL for pagination (standard Django REST pattern)
            nextUrl = data.next || null;

            logger.info(`[AidesTerritoires] Page ${pagesProcessed}/${PAGES_PER_RUN}, total=${totalCount}, cache: ${this._cache.size}, hasNext: ${!!nextUrl}`);
        }

        logger.info(`[AidesTerritoires] Total fetched: ${this._cache.size} aides (${pagesProcessed} pages, ${totalCount} available)`);
        return Array.from(this._cache.keys());
    }

    /**
     * Returns the cached JSON for the given virtual URL.
     * @param {string} url
     * @returns {Promise<string>}
     */
    async fetch(url) {
        const item = this._cache.get(url);
        if (!item) throw new Error(`No cached item for ${url}`);
        return JSON.stringify(item);
    }

    /**
     * Parses a cached API item into the normalized aide format.
     * @param {string} json - JSON string from fetch()
     * @param {string} url - Virtual URL
     * @returns {Promise<{
     *   title: string, description: string, content: string,
     *   source_url: string, apply_url: string|null, theme: string|null,
     *   fetched_at: Date,
     *   _territory_scope: string, _source_last_modified: Date|null,
     *   _montant_max: string|null, _echelon_territorial: string|null,
     *   _code_insee_territoire: string|null, _source_donnee: string,
     *   _lien_demarche: string|null, _financers: string|null,
     *   _targeted_audiences: string[]
     * }>}
     */
    async parse(json, url) {
        const item = JSON.parse(json);

        const title = (item.name || '').trim();
        const description = this._cleanHtml(item.description || '').substring(0, 500);
        const content = this._cleanHtml(item.description || '');
        let sourceUrl = item.url || url;
        // Ensure source_url is always absolute
        if (sourceUrl && !sourceUrl.startsWith('http')) {
            sourceUrl = `https://aides-territoires.beta.gouv.fr${sourceUrl.startsWith('/') ? '' : '/'}${sourceUrl}`;
        }
        const applyUrl = item.application_url || item.origin_url || null;

        // Map AT categories to our themes
        let theme = null;
        const categories = item.categories || [];
        if (categories.length > 0) {
            // Use the first category slug as theme
            theme = categories[0];
        }

        // ── Cahier des charges enrichment ──

        // Montant max: extract from subvention or loan fields
        let montantMax = null;
        if (item.subvention_rate_upper_bound) {
            montantMax = `${item.subvention_rate_upper_bound}%`;
        } else if (item.loan_amount) {
            montantMax = `${item.loan_amount}€`;
        } else if (item.recoverable_advance_amount) {
            montantMax = `${item.recoverable_advance_amount}€ (avance récupérable)`;
        }

        // Echelon territorial: map from AT perimeter scale
        const echelonTerritorial = this._mapPerimeter(item.perimeter);

        // Code INSEE territoire: extract from perimeter details
        let codeInseeTerritoire = null;
        if (item.perimeter) {
            // perimeter can be a string like "Strasbourg (67)" or an object
            const perimStr = typeof item.perimeter === 'string' ? item.perimeter : (item.perimeter_scale || '');
            const codeMatch = perimStr.match(/\((\d{2,5})\)/);
            if (codeMatch) codeInseeTerritoire = codeMatch[1];
        }

        // Financers (porteurs): flatten to comma-separated string
        const financers = Array.isArray(item.financers)
            // @ts-ignore
            ? item.financers.map(f => typeof f === 'string' ? f : (f?.name || '')).filter(Boolean).join(', ')
            : null;

        // Targeted audiences
        const targetedAudiences = Array.isArray(item.targeted_audiences)
            // @ts-ignore
            ? item.targeted_audiences.filter(a => typeof a === 'string')
            : [];

        return {
            title,
            description,
            content,
            source_url: sourceUrl,
            apply_url: applyUrl,
            theme,
            fetched_at: new Date(),
            // Enriched metadata for ingest-aids.js
            _territory_scope: echelonTerritorial,
            _source_last_modified: item.date_updated ? new Date(item.date_updated) : null,
            _montant_max: montantMax,
            _echelon_territorial: echelonTerritorial,
            _code_insee_territoire: codeInseeTerritoire,
            _source_donnee: 'Aides-Territoires',
            _lien_demarche: applyUrl,
            _financers: financers || null,
            _targeted_audiences: targetedAudiences,
        };
    }

    /**
     * @param {object} item
     * @returns {string}
     */
    getStableId(item) {
        return crypto.createHash('md5').update(item.source_url || '').digest('hex');
    }

    /**
     * Map Aides Territoires perimeter to our territory_scope enum.
     * @param {string|null} perimeter
     * @returns {string}
     */
    _mapPerimeter(perimeter) {
        if (!perimeter) return 'NATIONAL';
        const p = (typeof perimeter === 'string' ? perimeter : '').toLowerCase();
        if (p.includes('commune')) return 'COMMUNAL';
        if (p.includes('département') || p.includes('departement')) return 'DEPARTMENTAL';
        if (p.includes('région') || p.includes('region')) return 'REGIONAL';
        return 'NATIONAL';
    }

    /**
     * Strip HTML tags from text.
     * @param {string} html
     * @returns {string}
     */
    _cleanHtml(html) {
        return html
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }
}

import { ConnectorContractAdapter } from './ConnectorContractAdapter.js';
import { AidIngestSchema } from './validators.js';

export function createAidesTerritoiresContractConnector() {
  const legacy = new AidesTerritoiresConnector();
  return new ConnectorContractAdapter(legacy, {
    sourceId: 'aides-territoires',
    name: 'Aides Territoires Connector',
    version: '1.0.0',
    entityType: 'Aide',
    capabilities: ['BENEFIT_RULE', 'BENEFIT_PARAMETER', 'REFERENCE']
  }, {
    validator: AidIngestSchema
  });
}
