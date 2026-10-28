// @ts-nocheck
import crypto from 'node:crypto';
import { ConnectorContract, SyncRunState } from './ConnectorContract.js';

/**
 * Adapter that wraps existing SourceConnector-based connectors
 * to conform to the Phase 8 ConnectorContract interface.
 * 
 * This is the compatibility layer for incremental migration.
 * It does NOT rewrite connector logic — it delegates to the original.
 */
export class ConnectorContractAdapter extends ConnectorContract {
  /**
   * @param {import('./SourceConnector.js').SourceConnector} legacyConnector
   * @param {object} metadata - ConnectorContract metadata
   * @param {object} options - Additional adapter options
   * @param {Function} [options.validator] - Zod schema for validation
   * @param {Function} [options.normalizer] - Transform function raw → normalized
   */
  constructor(legacyConnector, metadata, options = {}) {
    super(metadata);
    this.legacy = legacyConnector;
    this.validator = options.validator || null;
    this.normalizer = options.normalizer || null;
  }

  async discover() {
    return {
      sourceId: this.metadata.sourceId,
      name: this.metadata.name,
      endpoint: this.legacy.baseUrl || 'unknown'
    };
  }

  async fetch() {
    // Delegate to legacy connector's fetch pattern
    // Some connectors might implement getDetailUrls, some might just do one big fetch.
    let items = [];
    if (typeof this.legacy.getDetailUrls === 'function') {
      const urls = await this.legacy.getDetailUrls();
      for (const url of urls) {
        try {
          const html = await this.legacy.fetch(url);
          const parsed = await this.legacy.parse(html, url);
          if (parsed) items.push(parsed);
        } catch (err) {
          // Log but continue — partial fetch is acceptable
          console.warn(`[${this.metadata.sourceId}] fetch error for ${url}:`, err.message);
        }
      }
    } else if (typeof this.legacy.fetchAll === 'function') {
      items = await this.legacy.fetchAll();
    } else {
      // Basic fallback
      try {
        const raw = await this.legacy.fetch();
        const parsed = await this.legacy.parse(raw);
        if (Array.isArray(parsed)) items = parsed;
        else if (parsed) items.push(parsed);
      } catch (err) {
        console.warn(`[${this.metadata.sourceId}] fetch error:`, err.message);
      }
    }
    
    return {
      items,
      fetchedAt: new Date(),
      syncRunId: crypto.randomUUID()
    };
  }

  async validate(rawItems) {
    if (!this.validator) {
      return { valid: rawItems, rejected: [], errors: [] };
    }
    const valid = [];
    const rejected = [];
    const errors = [];
    for (const item of rawItems) {
      const result = this.validator.safeParse(item);
      if (result.success) {
        valid.push(result.data);
      } else {
        rejected.push(item);
        errors.push(result.error);
      }
    }
    return { valid, rejected, errors };
  }

  async normalize(validItems) {
    if (!this.normalizer) return validItems;
    // @ts-ignore
    return validItems.map(item => this.normalizer(item));
  }

  async diff(normalizedItems) {
    // Default: tag all as NEW (full diff engine integrated in Gate E)
    return normalizedItems.map(item => ({ ...item, _diffState: 'NEW' }));
  }

  /**
* @param {any} diffedItems
* @param {any} syncRunId
*/
  async persist(diffedItems, syncRunId) {
    // Delegate to IngestionPipelineCore when integrated
    // For now, return items as-is (persistence handled by existing pipeline)
    return diffedItems;
  }

  // @ts-ignore
  async verify(persistedItems) {
    return { verified: persistedItems.length, failed: 0 };
  }

  // @ts-ignore
  async report(syncRunId, state, stats) {
    return { syncRunId, state, stats, reportedAt: new Date() };
  }
}
