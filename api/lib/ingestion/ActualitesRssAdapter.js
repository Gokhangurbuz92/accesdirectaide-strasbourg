// @ts-nocheck
import crypto from 'node:crypto';
import { ConnectorContract } from './ConnectorContract.js';

export class ActualitesRssContractAdapter extends ConnectorContract {
  constructor() {
    super({
      sourceId: 'actualites-rss',
      name: 'Actualités RSS Connector',
      version: '1.0.0',
      entityType: 'Actualite',
      capabilities: ['REFERENCE']
    });
  }
  // Stub lifecycle — actual logic remains in cron handler
  async discover() { return { sourceId: 'actualites-rss', name: 'RSS/Atom feeds', endpoint: 'multiple' }; }
  async fetch() { return { items: [], fetchedAt: new Date(), syncRunId: crypto.randomUUID() }; }
  async validate(items) { return { valid: items, rejected: [], errors: [] }; }
  async normalize(items) { return items; }
  // @ts-ignore
  async diff(items) { return items.map(i => ({ ...i, _diffState: 'NEW' })); }
  async persist(items) { return items; }
  // @ts-ignore
  async verify(items) { return { verified: items.length, failed: 0 }; }
  // @ts-ignore
  async report(id, state, stats) { return { syncRunId: id, state, stats }; }
}
