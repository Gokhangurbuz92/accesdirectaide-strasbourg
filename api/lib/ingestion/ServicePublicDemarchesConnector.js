// @ts-nocheck
import { logger } from '../logger.js';
import { SourceConnector } from './SourceConnector.js';
import crypto from 'crypto';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Default dataset URL — DILA "Fiches pratiques particuliers" from data.gouv.fr.
 * Override with env var SERVICE_PUBLIC_DEMARCHES_DATASET_URL.
 *
 * The dataset provides thousands of "fiches pratiques" covering administrative
 * procedures for French citizens (démarches, droits, formulaires).
 *
 * Source: https://www.data.gouv.fr/fr/datasets/service-public-fr-guide-vos-droits-et-demarches-particuliers/
 * License: Licence Ouverte v2.0 — Attribution "Service-Public.gouv.fr / DILA"
 */
const DEFAULT_DATASET_URL =
    'https://www.data.gouv.fr/fr/datasets/r/0ed10f28-d197-4324-97b3-037f625095ac';

const MAX_ITEMS = 10000; // Safety cap
const FETCH_TIMEOUT_MS = 45_000; // 45s (Vercel limit is 50s)

const MODULE_DIR = path.dirname(
    fileURLToPath(import.meta.url)
);

const DEFAULT_REPO_ROOT = path.resolve(
    MODULE_DIR,
    '../../..'
);

const DEFAULT_LOCAL_SNAPSHOT_PATH = path.join(
    DEFAULT_REPO_ROOT,
    'data',
    'strasbourg',
    'service-public-demarches.snapshot.json'
);

const LOCAL_SNAPSHOT_SCHEMA =
    'ADA_SERVICE_PUBLIC_DEMARCHES_SNAPSHOT_V1';

const MODE_LOCAL_SNAPSHOT = 'local-snapshot';
const MODE_LIVE = 'live';

function requireNonEmptyString(/** @type {unknown} */ value, /** @type {string} */ code) {
    if (
        typeof value !== 'string' ||
        value.trim().length === 0
    ) {
        throw new Error(code);
    }

    return value.trim();
}

function validateSnapshotProvenance(/** @type {{ freshnessStatus: string | number | boolean | null | undefined, sourceKind: string | number | boolean | null | undefined, sourceOwner: string | number | boolean | null | undefined, sourceSha256: string | number | boolean | null | undefined, sourceUrl: string | number | boolean | null | undefined, verifiedAt: string | number | boolean | null | undefined }} */ provenance) {
    if (
        !provenance ||
        typeof provenance !== 'object' ||
        Array.isArray(provenance)
    ) {
        throw new Error(
            'SERVICE_PUBLIC_SNAPSHOT_PROVENANCE_MISSING'
        );
    }

    const sourceOwner = requireNonEmptyString(
        provenance.sourceOwner,
        'SERVICE_PUBLIC_SNAPSHOT_SOURCE_OWNER_MISSING'
    );

    const sourceUrl = requireNonEmptyString(
        provenance.sourceUrl,
        'SERVICE_PUBLIC_SNAPSHOT_SOURCE_URL_MISSING'
    );

    const sourceKind = requireNonEmptyString(
        provenance.sourceKind,
        'SERVICE_PUBLIC_SNAPSHOT_SOURCE_KIND_MISSING'
    );

    const verifiedAt = requireNonEmptyString(
        provenance.verifiedAt,
        'SERVICE_PUBLIC_SNAPSHOT_VERIFIED_AT_MISSING'
    );

    const freshnessStatus = requireNonEmptyString(
        provenance.freshnessStatus,
        'SERVICE_PUBLIC_SNAPSHOT_FRESHNESS_MISSING'
    );

    const sourceSha256 = requireNonEmptyString(
        provenance.sourceSha256,
        'SERVICE_PUBLIC_SNAPSHOT_SOURCE_SHA256_MISSING'
    );

    let parsedUrl;

    try {
        parsedUrl = new URL(sourceUrl);
    } catch {
        throw new Error(
            'SERVICE_PUBLIC_SNAPSHOT_SOURCE_URL_INVALID'
        );
    }

    if (
        parsedUrl.protocol !== 'https:' &&
        parsedUrl.protocol !== 'http:'
    ) {
        throw new Error(
            'SERVICE_PUBLIC_SNAPSHOT_SOURCE_URL_INVALID'
        );
    }

    if (
        Number.isNaN(
            Date.parse(verifiedAt)
        )
    ) {
        throw new Error(
            'SERVICE_PUBLIC_SNAPSHOT_VERIFIED_AT_INVALID'
        );
    }

    if (
        freshnessStatus !== 'VERIFIED_CURRENT'
    ) {
        throw new Error(
            'SERVICE_PUBLIC_SNAPSHOT_NOT_VERIFIED_CURRENT'
        );
    }

    if (
        !/^[a-f0-9]{64}$/i.test(
            sourceSha256
        )
    ) {
        throw new Error(
            'SERVICE_PUBLIC_SNAPSHOT_SOURCE_SHA256_INVALID'
        );
    }

    return {
        sourceOwner,
        sourceUrl,
        sourceKind,
        verifiedAt,
        freshnessStatus,
        sourceSha256: sourceSha256.toLowerCase(),
    };
}

/**
 * Category mapping from Service-Public themes to ADA categories.
 */
const THEME_TO_CATEGORY = {
    'logement': 'logement',
    'social-sante': 'sante',
    'social - santé': 'sante',
    'travail': 'emploi',
    'famille': 'famille',
    'argent': 'argent',
    'justice': 'droits',
    'papiers-citoyennete': 'papiers',
    'papiers - citoyenneté': 'papiers',
    'transports': 'mobilite',
    'loisirs': 'loisirs',
    'etrangers': 'etranger',
    'étranger en france': 'etranger',
    'étrangers en france': 'etranger',
    'formation': 'formation',
    'associations': 'administratif',
    'creation-entreprise': 'emploi',
};

function mapCategory(/** @type {string | number | boolean | null | undefined} */ themes) {
    if (!themes) return 'administratif';
    const raw = Array.isArray(themes) ? themes : [themes];
    for (const t of raw) {
        const key = String(t).toLowerCase().trim();
        // @ts-ignore
        if (THEME_TO_CATEGORY[key]) return THEME_TO_CATEGORY[key];
        // Partial match
        for (const [pattern, cat] of Object.entries(THEME_TO_CATEGORY)) {
            if (key.includes(pattern)) return cat;
        }
    }
    return 'administratif';
}

/**
 * @param {string} html
 */
function cleanHtml(html) {
    if (!html) return '';
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

/**
 * Connector for Service-Public.fr "Fiches pratiques" dataset (DILA).
 *
 * Auto-detects JSON vs XML based on Content-Type:
 *  - JSON (array of objects): direct parse
 *  - XML: basic regex parse for <Publication> elements
 *
 * Each fiche becomes a Démarche with:
 *  slug, titre, description_courte, lien_officiel, source_url, categorie, audiences
 */
export class ServicePublicDemarchesConnector extends SourceConnector {
    constructor(options = {}) {
        super(
            'service-public',
            'https://www.service-public.fr'
        );

        /** @type {Map<string, object>} */
        this._cache = new Map();

        this._datasetUrl =
            options.datasetUrl ||
            process.env.SERVICE_PUBLIC_DEMARCHES_DATASET_URL ||
            DEFAULT_DATASET_URL;

        this._mode =
            options.mode ||
            process.env.SERVICE_PUBLIC_DEMARCHES_MODE ||
            MODE_LOCAL_SNAPSHOT;

        this._snapshotPath =
            options.snapshotPath ||
            DEFAULT_LOCAL_SNAPSHOT_PATH;

        this._fetchImpl =
            options.fetchImpl ||
            globalThis.fetch;

        if (
            this._mode !== MODE_LOCAL_SNAPSHOT &&
            this._mode !== MODE_LIVE
        ) {
            throw new Error(
                `SERVICE_PUBLIC_MODE_UNSUPPORTED:${this._mode}`
            );
        }
    }

    async _loadLocalSnapshot() {
        let raw;

        try {
            raw = await readFile(
                this._snapshotPath,
                'utf8'
            );
        } catch (error) {
            if (
                error &&
                error.code === 'ENOENT'
            ) {
                throw new Error(
                    'SERVICE_PUBLIC_LOCAL_SNAPSHOT_MISSING'
                );
            }

            throw new Error(
                `SERVICE_PUBLIC_LOCAL_SNAPSHOT_READ_FAILED:${error.message}`
            );
        }

        let snapshot;

        try {
            snapshot = JSON.parse(raw);
        } catch {
            throw new Error(
                'SERVICE_PUBLIC_LOCAL_SNAPSHOT_MALFORMED'
            );
        }

        if (
            !snapshot ||
            typeof snapshot !== 'object' ||
            Array.isArray(snapshot) ||
            snapshot.schema !== LOCAL_SNAPSHOT_SCHEMA
        ) {
            throw new Error(
                'SERVICE_PUBLIC_LOCAL_SNAPSHOT_SCHEMA_UNSUPPORTED'
            );
        }

        if (!Array.isArray(snapshot.items)) {
            throw new Error(
                'SERVICE_PUBLIC_LOCAL_SNAPSHOT_ITEMS_INVALID'
            );
        }

        const provenance =
            validateSnapshotProvenance(
                snapshot.provenance
            );

        const items = snapshot.items.map(
            (/** @type {{ id: string | number | boolean | null | undefined, slug: string | number | boolean | null | undefined, titre: string | number | boolean | null | undefined }} */ item, /** @type {string | number | boolean | null | undefined} */ index) => {
                if (
                    !item ||
                    typeof item !== 'object' ||
                    Array.isArray(item)
                ) {
                    throw new Error(
                        `SERVICE_PUBLIC_LOCAL_SNAPSHOT_ITEM_INVALID:${index}`
                    );
                }

                const stableKey = String(
                    item.id ||
                    item.slug ||
                    ''
                ).trim();

                const title = String(
                    item.titre ||
                    ''
                ).trim();

                if (!stableKey) {
                    throw new Error(
                        `SERVICE_PUBLIC_LOCAL_SNAPSHOT_ITEM_KEY_MISSING:${index}`
                    );
                }

                if (title.length < 5) {
                    throw new Error(
                        `SERVICE_PUBLIC_LOCAL_SNAPSHOT_ITEM_TITLE_INVALID:${index}`
                    );
                }

                return {
                    ...item,

                    _ws2_snapshot_provenance:
                        provenance,

                    _ws2_launch_eligible:
                        true,
                };
            }
        );

        return {
            schema: snapshot.schema,
            provenance,
            items,
        };
    }

    _cacheItems(items, options = {}) {
        let filtered = items.filter(
            (/** @type {{ audience: string | number | boolean | null | undefined, titre: string | number | boolean | null | undefined }} */ item) => {
                if (
                    !item.titre ||
                    String(
                        item.titre
                    ).trim().length < 5
                ) {
                    return false;
                }

                if (
                    item.audience &&
                    !String(
                        item.audience
                    )
                        .toLowerCase()
                        .includes(
                            'particulier'
                        )
                ) {
                    return false;
                }

                return true;
            }
        );

        if (filtered.length > MAX_ITEMS) {
            filtered = filtered.slice(
                0,
                MAX_ITEMS
            );
        }

        for (const item of filtered) {
            let key =
                item.id ||
                item.slug;

            if (
                !key &&
                options.requireStableKey
            ) {
                throw new Error(
                    'SERVICE_PUBLIC_LOCAL_SNAPSHOT_STABLE_KEY_REQUIRED'
                );
            }

            if (!key) {
                key = crypto.randomUUID();
            }

            const virtualUrl =
                `${this.baseUrl}/particuliers/vosdroits/${key}`;

            this._cache.set(
                virtualUrl,
                item
            );
        }

        return Array.from(
            this._cache.keys()
        );
    }

    async _getLocalSnapshotDetailUrls() {
        /*
         * IMPORTANT:
         * This path performs filesystem reads only.
         * It never invokes this._fetchImpl and never falls back
         * to the live data.gouv connector.
         */
        const snapshot =
            await this._loadLocalSnapshot();

        const urls = this._cacheItems(
            snapshot.items,
            {
                requireStableKey: true,
            }
        );

        logger.info(
            `[ServicePublic] Loaded ${urls.length} fiches from verified local snapshot`
        );

        return urls;
    }

    /**
     * Fetches the dataset (JSON or XML) and returns virtual URLs.
     * @returns {Promise<string[]>}
     */
    async getDetailUrls() {
        this._cache.clear();

        if (
            this._mode === MODE_LOCAL_SNAPSHOT
        ) {
            return this._getLocalSnapshotDetailUrls();
        }

        if (this._mode !== MODE_LIVE) {
            throw new Error(
                `SERVICE_PUBLIC_MODE_UNSUPPORTED:${this._mode}`
            );
        }

        if (
            typeof this._fetchImpl !== 'function'
        ) {
            throw new Error(
                'SERVICE_PUBLIC_LIVE_FETCH_UNAVAILABLE'
            );
        }

        logger.info(
            `[ServicePublic] Fetching dataset from: ${this._datasetUrl}`
        );

        const response =
            await this._fetchImpl(
                this._datasetUrl,
                {
                    headers: {
                        Accept:
                            'application/json, application/xml, text/xml, application/zip'
                    },
                    signal:
                        AbortSignal.timeout(
                            FETCH_TIMEOUT_MS
                        ),
                    redirect: 'follow',
                }
            );

        if (!response.ok) {
            throw new Error(`Service-Public dataset HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();

        let items;
        if (contentType.includes('zip') || contentType.includes('octet-stream')) {
            // ZIP archive — extract XML files and parse them
            items = await this._parseZip(response);
        } else {
            const body = await response.text();
            if (contentType.includes('json') || body.trimStart().startsWith('[') || body.trimStart().startsWith('{')) {
                items = this._parseJSON(body);
            } else {
                items = this._parseXML(body);
            }
        }

        logger.info(`[ServicePublic] Parsed ${items.length} fiches from dataset`);

        // Filter: keep only "Particuliers" scope if available, and only fiches with titles
        let filtered = items.filter(item => {
            if (!item.titre || String(item.titre).trim().length < 5) return false;
            // If audience/scope is specified, keep only Particuliers
            if (item.audience && !String(item.audience).toLowerCase().includes('particulier')) return false;
            return true;
        });

        // Safety cap
        if (filtered.length > MAX_ITEMS) {
            filtered = filtered.slice(0, MAX_ITEMS);
        }

        for (const item of filtered) {
            const key = item.id || item.slug || crypto.randomUUID();
            const virtualUrl = `${this.baseUrl}/particuliers/vosdroits/${key}`;
            this._cache.set(virtualUrl, item);
        }

        logger.info(`[ServicePublic] After filtering: ${this._cache.size} fiches (Particuliers scope)`);
        return Array.from(this._cache.keys());
    }

    /**
     * @param {string} url
     * @returns {Promise<string>}
     */
    async fetch(url) {
        const item = this._cache.get(url);
        if (!item) throw new Error(`No cached item for ${url}`);
        return JSON.stringify(item);
    }

    /**
     * @param {string} json
     * @param {string} url
     * @returns {Promise<object>}
     */
    async parse(json, url) {
        const item = JSON.parse(json);
        return {
            titre: (item.titre || '').trim(),
            description_courte: cleanHtml(item.description || item.introduction || item.texte || '').substring(0, 300),
            contenu_detaille: cleanHtml(item.texte || item.description || ''),
            pour_qui: item.pour_qui || item.beneficiaires || null,
            lien_officiel: item.url || item.lien_officiel || url,
            source_url: item.url || url,
            source_url_exact: item.url || url,
            source_host: 'service-public.fr',
            categorie: mapCategory(item.theme || item.themes || item.categorie),
            audiences: item.audiences || ['Particuliers'],
            territory_scope: 'NATIONAL',
            external_id: item.id || null,
            source_api: 'service-public-dila',
            fetched_at: new Date(),
        };
    }

    /**
     * @param {object} item
     * @returns {string}
     */
    getStableId(item) {
        return crypto.createHash('md5').update(item.source_url || item.titre || '').digest('hex');
    }

    // -----------------------------------------------------------------------
    // Parsers
    // -----------------------------------------------------------------------

    /**
     * Parse a ZIP response containing XML files.
     * Extracts all .xml files, concatenates their contents, and parses them.
     * @param {Response} response
     * @returns {Promise<object[]>}
     */
    async _parseZip(response) {
        try {
            const buffer = await response.arrayBuffer();
            logger.info(`[ServicePublic] ZIP downloaded: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB`);

            const zip = await JSZip.loadAsync(buffer);
            const xmlFiles = Object.keys(zip.files)
                .filter(name => name.endsWith('.xml') && !zip.files[name].dir)
                .sort((a, b) => (zip.files[b].uncompressedSize || 0) - (zip.files[a].uncompressedSize || 0))
                .slice(0, 500); // Safety cap to stay within Vercel memory

            logger.info(`[ServicePublic] ZIP contains ${xmlFiles.length} XML files`);

            const allItems = [];
            for (const fileName of xmlFiles) {
                try {
                    const xmlContent = await zip.files[fileName].async('string');
                    const items = this._parseXML(xmlContent);
                    allItems.push(...items);
                } catch (err) {
                    logger.warn(`[ServicePublic] Failed to parse ${fileName}: ${err.message}`);
                }
            }

            logger.info(`[ServicePublic] Parsed ${allItems.length} fiches from ${xmlFiles.length} XML files`);
            return allItems;
        } catch (err) {
            logger.error('[ServicePublic] ZIP parse error:', err.message);
            return [];
        }
    }

    /**
     * Parse JSON dataset. Handles both array format and {results:[]} format.
     * @param {string} body
     * @returns {object[]}
     */
    _parseJSON(body) {
        try {
            const data = JSON.parse(body);
            if (Array.isArray(data)) return data;
            if (data.results && Array.isArray(data.results)) return data.results;
            // Single object with nested data
            if (data.data && Array.isArray(data.data)) return data.data;
            // Object with fiches
            if (data.fiches && Array.isArray(data.fiches)) return data.fiches;
            // If it's a paginated response
            if (data.next && data.results) return data.results;
            // Wrap single item
            if (data.titre || data.title || data.id) return [data];
            logger.warn('[ServicePublic] Unexpected JSON structure, keys:', Object.keys(data).slice(0, 10));
            return [];
        } catch (e) {
            logger.error('[ServicePublic] JSON parse error:', e.message);
            return [];
        }
    }

    /**
     * Parse XML dataset. Extracts <Publication> or <Fiche> elements.
     * Basic regex-based parser (no XML library dependency).
     * @param {string} body
     * @returns {object[]}
     */
    _parseXML(body) {
        const items = [];

        // Try to match <Publication> or <Fiche> or <Dossier> elements
        const patterns = [
            /<Publication[^>]*>([\s\S]*?)<\/Publication>/gi,
            /<Fiche[^>]*>([\s\S]*?)<\/Fiche>/gi,
            /<FichePratique[^>]*>([\s\S]*?)<\/FichePratique>/gi,
        ];

        for (const regex of patterns) {
            let match;
            while ((match = regex.exec(body)) !== null) {
                const block = match[1] || match[0];
                const item = this._extractFromXmlBlock(block, match[0]);
                if (item.titre) {
                    items.push(item);
                }
            }
            if (items.length > 0) break; // Use first matching pattern
        }

        // If no structured elements found, try flat tag extraction
        if (items.length === 0) {
            logger.warn('[ServicePublic] No structured XML elements found, trying flat extraction');
            const titles = body.match(/<dc:title>(.*?)<\/dc:title>/gi) || [];
            for (const titleTag of titles) {
                const titre = titleTag.replace(/<\/?dc:title>/gi, '').trim();
                if (titre.length >= 5) {
                    items.push({ titre, id: crypto.randomUUID() });
                }
            }
        }

        return items;
    }

    /**
     * @param {string} block
     * @param {string} fullMatch
     * @returns {object}
     */
    _extractFromXmlBlock(block, fullMatch) {
        const get = (/** @type {string} */ tag) => {
            const m = block.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'is'));
            return m ? cleanHtml(m[1]) : null;
        };
        const getAttr = (/** @type {string} */ attr) => {
            const m = fullMatch.match(new RegExp(`${attr}="([^"]*)"`, 'i'));
            return m ? m[1] : null;
        };

        return {
            id: getAttr('ID') || getAttr('id') || get('Identifiant') || crypto.randomUUID(),
            titre: get('dc:title') || get('titre') || get('Titre') || get('title') || '',
            description: get('dc:description') || get('Introduction') || get('Texte') || get('Resume') || '',
            texte: get('Texte') || get('Corps') || '',
            url: get('FilAriane')
                ? `https://www.service-public.fr/particuliers/vosdroits/${getAttr('ID') || ''}`
                : null,
            theme: get('Theme') || get('dc:subject') || null,
            audience: get('Audience') || getAttr('audience') || 'Particuliers',
            pour_qui: get('Beneficiaires') || null,
        };
    }
}

import { ConnectorContractAdapter } from './ConnectorContractAdapter.js';

export function createServicePublicDemarchesContractConnector() {
  const legacy = new ServicePublicDemarchesConnector();
  return new ConnectorContractAdapter(legacy, {
    sourceId: 'service-public-demarches',
    name: 'Service Public Demarches Connector',
    version: '1.0.0',
    entityType: 'Demarche',
    capabilities: ['PROCEDURAL', 'LEGAL', 'REFERENCE']
  });
}
