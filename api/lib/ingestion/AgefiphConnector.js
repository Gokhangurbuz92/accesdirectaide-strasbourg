// @ts-nocheck

import { SourceConnector } from './SourceConnector.js';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const taxonomy = require('../../data/taxonomy.json');

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class AgefiphConnector extends SourceConnector {
    constructor() {
        super('AGEFIPH', 'https://www.agefiph.fr');
    }

    async getDetailUrls() {
        const listingUrl = 'https://www.agefiph.fr/aides-financieres?mode=aucun';
        const html = await this.fetch(listingUrl);
        const urls = new Set();

        // Match both old (/aides-handicap/) and new (/aides-financieres/) URL patterns
        const regex = /href=["'](\/aides-(?:financieres|handicap)\/aide[^"']+)["']/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const url = this.resolveUrl(match[1], listingUrl);
            if (!url.includes('depot-demande') && !url.includes('suivi-demande')) {
                urls.add(url);
            }
        }
        return Array.from(urls);
    }

    async fetch(url) {
        const response = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
            },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    }

    /**
   * @param {string} html
   * @param {string | undefined} [url]
   */
    async parse(html, url) {
        const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const title = titleMatch ? this.cleanText(titleMatch[1]) : 'Sans titre';

        let content = '';
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
            content = this.cleanText(bodyMatch[1]).substring(0, 5000);
        }

        let applyUrl = null;
        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
            const href = match[1];
            const text = match[2].toLowerCase();
            if (text.includes('déposer') || text.includes('demande') || text.includes('contact')) {
                if (!href.startsWith('#')) {
                    applyUrl = this.resolveUrl(href, url);
                    break;
                }
            }
        }

        let theme = 'handicap'; // Agefiph = aides spécifiques au handicap
        const lowerContent = (title + ' ' + content).toLowerCase();
        for (const cat of taxonomy) {
            if (cat.keywords.some(k => lowerContent.includes(k))) {
                theme = cat.slug;
                break;
            }
        }

        return {
            title,
            description: content.substring(0, 200) + '...',
            content,
            source_url: url,
            apply_url: applyUrl,
            theme,
            fetched_at: new Date()
        };
    }

    /**
   * @param {{ source_url: crypto.BinaryLike; }} item
   */
    getStableId(item) {
        return crypto.createHash('md5').update(item.source_url).digest('hex');
    }

    /**
   * @param {string} html
   */
    cleanText(html) {
        return html
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // @ts-ignore
    resolveUrl(href, base) {
        try {
            return new URL(href, base).toString();
        } catch (e) {
            return href;
        }
    }
}

import { ConnectorContractAdapter } from './ConnectorContractAdapter.js';
import { AidIngestSchema } from './validators.js';

export function createAgefiphContractConnector() {
  const legacy = new AgefiphConnector();
  return new ConnectorContractAdapter(legacy, {
    sourceId: 'agefiph',
    name: 'Agefiph Connector',
    version: '1.0.0',
    entityType: 'Aide',
    capabilities: ['BENEFIT_RULE', 'BENEFIT_PARAMETER']
  }, {
    validator: AidIngestSchema
  });
}
