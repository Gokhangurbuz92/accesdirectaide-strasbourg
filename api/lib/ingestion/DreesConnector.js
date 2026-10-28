// @ts-nocheck
import { SourceConnector } from './SourceConnector.js';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * DREES / Service-Public Connector — National social programs.
 *
 * Loads a comprehensive catalogue of ~30+ national social aides
 * from a curated JSON file (api/data/drees-aides.json).
 *
 * Each aide has a stable ID, detailed description, official source URL,
 * and a theme matching the platform's taxonomy.
 */

const DREES_AIDES = require('../../data/drees-aides.json');

export class DreesConnector extends SourceConnector {
    constructor() {
        super('drees', 'https://data.drees.solidarites-sante.gouv.fr');
        /** @type {Map<string, object>} */
        this._cache = new Map();
    }

    async getDetailUrls() {
        this._cache.clear();
        for (const aide of DREES_AIDES) {
            this._cache.set(aide.source_url, aide);
        }
        return Array.from(this._cache.keys());
    }

    async fetch(url) {
        const item = this._cache.get(url);
        if (!item) throw new Error(`No cached item for ${url}`);
        return JSON.stringify(item);
    }

    /**
   * @param {string} json
   * @param {string | undefined} [url]
   */
    async parse(json, url) {
        const item = JSON.parse(json);
        return {
            title: item.title,
            description: item.description,
            content: item.content,
            source_url: item.source_url,
            apply_url: item.apply_url,
            theme: item.theme,
            fetched_at: new Date(),
            _territory_scope: item.territory_scope || 'NATIONAL',
        };
    }

    getStableId(item) {
        return crypto.createHash('md5').update(item.source_url || '').digest('hex');
    }
}

import { ConnectorContractAdapter } from './ConnectorContractAdapter.js';

export function createDreesContractConnector() {
  const legacy = new DreesConnector();
  return new ConnectorContractAdapter(legacy, {
    sourceId: 'drees',
    name: 'DREES Connector',
    version: '1.0.0',
    entityType: 'Structure',
    capabilities: ['STATISTICAL', 'REFERENCE']
  });
}
