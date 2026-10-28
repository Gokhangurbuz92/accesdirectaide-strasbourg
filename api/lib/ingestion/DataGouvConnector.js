// @ts-nocheck
import crypto from 'node:crypto';
import { ConnectorContract } from './ConnectorContract.js';

/**
 * data.gouv.fr Connector.
 * Distribution/catalog platform — NOT an authority itself.
 * Preserves original producer authority, dataset publisher, resource URL.
 */
export class DataGouvConnector extends ConnectorContract {
  constructor() {
    super({
      sourceId: 'data-gouv-datasets',
      name: 'data.gouv.fr Datasets',
      version: '1.0.0',
      entityType: 'Aide',
      capabilities: ['OPEN_DATA_CATALOG', 'REFERENCE']
    });
    this.apiEndpoint = 'https://www.data.gouv.fr/api/1';
    this.distributionPlatform = 'data.gouv.fr';
    this.licence = 'Licence Ouverte v2.0';
  }

  async discover() {
    return {
      sourceId: this.metadata.sourceId,
      name: this.metadata.name,
      endpoint: this.apiEndpoint,
      distributionPlatform: this.distributionPlatform,
      licence: this.licence,
      note: 'data.gouv.fr is a distribution platform. Authority belongs to the underlying producer.',
      capabilities: this.metadata.capabilities
    };
  }

  async fetch() {
    return { items: [], fetchedAt: new Date(), syncRunId: crypto.randomUUID() };
  }

  async validate(items) { return { valid: items, rejected: [], errors: [] }; }
  async normalize(items) {
    return items.map(item => ({
      ...item,
      sourceId: 'data-gouv-datasets',
      // Preserve original producer authority separately
      producerAuthority: item.organization?.name || item.publisher || 'UNKNOWN',
      distributionPlatform: 'data.gouv.fr',
      datasetId: item.id || null,
      resourceUrl: item.url || null,
      language: 'fr'
    }));
  }
  // @ts-ignore
  async diff(items) { return items.map(i => ({ ...i, _diffState: 'NEW' })); }
  async persist(items) { return items; }
  // @ts-ignore
  async verify(items) { return { verified: items.length, failed: 0 }; }
  // @ts-ignore
  async report(id, state, stats) { return { syncRunId: id, state, stats }; }
}

export default DataGouvConnector;
