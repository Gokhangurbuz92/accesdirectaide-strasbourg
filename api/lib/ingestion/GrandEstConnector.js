// @ts-nocheck
import { logger } from '../logger.js';
/**
 * GrandEstConnector — Scraper pour les aides de la Région Grand Est.
 *
 * Cible : https://www.grandest.fr/aides/
 * Technologie : Cheerio (parser HTML pur Node.js, compatible Vercel Serverless).
 * Stratégie : Récupère la page listing, parse les cartes d'aides avec des sélecteurs CSS,
 *             puis récupère chaque page de détail pour extraire le contenu complet.
 *
 * Remplace l'ancien connecteur basé sur des regex naïves.
 *
 * Résilience : Retry avec backoff, User-Agent réaliste, timeout 15s, cap 200 items.
 */

import { SourceConnector } from './SourceConnector.js';
import crypto from 'crypto';
import * as cheerio from 'cheerio';

const LISTING_URL = 'https://www.grandest.fr/aides/';
const TIMEOUT_MS = 15_000;
const MAX_ITEMS = 200;
const MAX_RETRIES = 3;
const DETAIL_DELAY_MS = 500; // Politeness delay between detail page fetches

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch HTML with retry and realistic User-Agent.
 * @param {string} url
 * @param {number} [retries]
 * @returns {Promise<string>}
 */
async function fetchHtml(url, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
                },
            });
            clearTimeout(timer);

            if (!response.ok) {
                if (response.status === 404) {
                    const err = new Error('Resource not found');
                    err.code = 'RESOURCE_NOT_FOUND';
                    throw err; // DO NOT RETRY 404s
                }
                const err = new Error(`HTTP ${response.status} ${response.statusText}`);
                err.code = (response.status === 429 || response.status >= 500) ? 'TRANSIENT' : 'UNKNOWN';
                throw err;
            }
            return await response.text();
        } catch (err) {
            // Stop retrying immediately if it's a 404 or a non-transient error
            if (err.code === 'RESOURCE_NOT_FOUND') {
                throw err;
            }
            if (attempt === retries - 1) throw err;
            const delay = 1000 * Math.pow(2, attempt);
            // @ts-ignore
            logger.warn(`[GrandEst] Retry ${attempt + 1}/${retries} after ${delay}ms: ${err.message}`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw new Error('[GrandEst] All retries exhausted');
}

/**
 * Clean text: strip HTML tags, normalize whitespace.
 * @param {string} text
 * @returns {string}
 */
function cleanText(text) {
    return (text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

export class GrandEstConnector extends SourceConnector {
    constructor() {
        super('Grand Est', 'https://www.grandest.fr');
        /** @type {Map<string, object>} */
        this._cache = new Map();
    }

    /**
     * Fetches the listing page and extracts aide URLs using Cheerio CSS selectors.
     * The Grand Est site uses WordPress with card-based listing.
     *
     * HTML structure (verified Feb 2026):
     * <a href="https://www.grandest.fr/vos-aides-regionales/..." class="card aide">
     *   <div class="img">...</div>
     *   <div class="txt new_txt">
     *     <div class="img-info upper">
     *       <span class="h5 flag is--dark">En ligne</span>
     *       <span class="h5 flag is--corail">Appels à projets</span>
     *     </div>
     *     <h3>Titre de l'aide</h3>
     *     <p class="intro">Description courte...</p>
     *   </div>
     * </a>
     *
     * @returns {Promise<string[]>}
     */
    async getDetailUrls() {
        this._cache.clear();
        logger.info(`[GrandEst] Fetching listing: ${LISTING_URL}`);

        const html = await fetchHtml(LISTING_URL);
        const $ = cheerio.load(html);
        const urls = new Set();

        // Extract aide card links (two URL patterns on the site)
        $('a.card.aide').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;

            // Only accept grandest.fr aide/appel URLs
            if (
                href.includes('/vos-aides-regionales/') ||
                href.includes('/appel-a-projet/')
            ) {
                urls.add(href.startsWith('http') ? href : `https://www.grandest.fr${href}`);
            }
        });

        // Fallback: if Cheerio finds no .card.aide, try regex (backward compat)
        if (urls.size === 0) {
            logger.warn('[GrandEst] No cards found via Cheerio, falling back to regex');
            const regex = /href=["']((?:https?:\/\/www\.grandest\.fr)?\/+(?:vos-aides-regionales|appel-a-projet)\/[^"']+)["']/gi;
            let match;
            while ((match = regex.exec(html)) !== null) {
                const resolvedUrl = match[1].startsWith('http')
                    ? match[1]
                    : `https://www.grandest.fr${match[1]}`;
                urls.add(resolvedUrl);
            }
        }

        // Also extract quick metadata from cards for items we can cache
        $('a.card.aide').each((_, el) => {
            const $el = $(el);
            const href = $el.attr('href');
            if (!href) return;

            const fullUrl = href.startsWith('http') ? href : `https://www.grandest.fr${href}`;
            if (!urls.has(fullUrl)) return;

            // Quick card-level metadata (enriched later by detail page)
            const title = cleanText($el.find('h3').first().text() || $el.find('.txt h3, .new_txt h3').first().text());
            const intro = cleanText($el.find('p.intro, .txt p').first().text());
            const status = cleanText($el.find('.flag.is--dark').first().text());
            const type = cleanText($el.find('.flag.is--corail, .flag.is--vert').first().text());

            if (title) {
                this._cache.set(fullUrl, {
                    title: title || 'Aide Grand Est',
                    description: intro || '',
                    status: status || '',
                    type: type || '',
                });
            }
        });

        // Cap items
        const allUrls = Array.from(urls).slice(0, MAX_ITEMS);
        logger.info(`[GrandEst] Found ${urls.size} aide URLs (capped to ${allUrls.length}), ${this._cache.size} with card metadata`);
        return allUrls;
    }

    /**
     * Fetches a detail page HTML.
     * @param {string} url
     * @returns {Promise<string>}
     */
    async fetch(url) {
        // Politeness delay to avoid overwhelming the server
        await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
        return fetchHtml(url);
    }

    /**
     * Parses a detail page into the normalized aide format using Cheerio.
     * @param {string} html
     * @param {string} url
     * @returns {Promise<object>}
     */
    async parse(html, url) {
        const $ = cheerio.load(html);

        // Title: try h1 first, then card cache
        const cached = this._cache.get(url) || {};
        const title = cleanText($('h1').first().text()) || cached.title || 'Aide Grand Est';

        // Content: look for main content area
        let content = '';
        const contentSelectors = [
            '.entry-content',
            '.content-single',
            'article .content',
            '.ar-pageload main .content',
            'main',
        ];

        for (const selector of contentSelectors) {
            const found = $(selector).first();
            if (found.length) {
                content = cleanText(found.html() || '');
                if (content.length > 100) break; // Found meaningful content
            }
        }

        // Fallback: try body content (truncated)
        if (!content || content.length < 50) {
            content = cleanText($('body').html() || '').substring(0, 5000);
        }

        // Description: first 500 chars of content
        const description = cached.description || content.substring(0, 500);

        // Apply URL: look for links containing action words
        /**
       * @type {string | null}
       */
        let applyUrl = null;
        $('a[href]').each((_, el) => {
            if (applyUrl) return; // Already found
            const $a = $(el);
            const text = ($a.text() || '').toLowerCase();
            const href = $a.attr('href') || '';

            // Skip internal nav, anchors, and asset links
            if (href.startsWith('#') || href.includes('wp-content') || href.includes('.pdf')) return;

            if (
                text.includes('demande') ||
                text.includes('dossier') ||
                text.includes('candidater') ||
                text.includes('téléservice') ||
                text.includes('formulaire') ||
                text.includes('postuler')
            ) {
                try {
                    applyUrl = new URL(href, url).toString();
                } catch {
                    applyUrl = href;
                }
            }
        });

        // Theme mapping from taxonomy (backward compat with existing connector)
        let theme = null;
        try {
            const { createRequire } = await import('module');
            const require = createRequire(import.meta.url);
            const taxonomy = require('../../data/taxonomy.json');
            const lowerContent = (title + ' ' + description).toLowerCase();

            for (const cat of taxonomy) {
                if (cat.keywords && cat.keywords.some((k) => lowerContent.includes(k))) {
                    theme = cat.slug;
                    break;
                }
            }
        } catch {
            // taxonomy.json not available — skip theme mapping
        }

        return {
            title,
            description: description.substring(0, 500) + (description.length > 500 ? '...' : ''),
            content: content.substring(0, 10000),
            source_url: url,
            apply_url: applyUrl,
            theme,
            fetched_at: new Date(),
            // ── Phase 1 enrichment fields ──
            _echelon_territorial: 'REGIONAL',
            _code_insee_territoire: '44', // Code INSEE Grand Est
            _source_donnee: 'Scraping GrandEst',
            _lien_demarche: applyUrl,
            _montant_max: null, // Not available via scraping
            _territory_scope: 'REGIONAL',
            _source_last_modified: null,
        };
    }

    /**
     * @param {object} item
     * @returns {string}
     */
    getStableId(item) {
        return crypto.createHash('md5').update(item.source_url || '').digest('hex');
    }
}

import { ConnectorContractAdapter } from './ConnectorContractAdapter.js';
import { AidIngestSchema } from './validators.js';

export function createGrandEstContractConnector() {
  const legacy = new GrandEstConnector();
  return new ConnectorContractAdapter(legacy, {
    sourceId: 'grand-est',
    name: 'GrandEst Connector',
    version: '1.0.0',
    entityType: 'Aide',
    capabilities: ['BENEFIT_RULE', 'BENEFIT_PARAMETER']
  }, {
    validator: AidIngestSchema
  });
}
