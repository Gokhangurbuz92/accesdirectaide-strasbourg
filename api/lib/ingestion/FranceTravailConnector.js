// @ts-nocheck
import crypto from 'node:crypto';
import { ConnectorContract } from './ConnectorContract.js';

/**
 * France Travail Public Data Connector.
 * EXTERNAL ACTION REQUIRED: Registration on francetravail.io for API key.
 */
export class FranceTravailConnector extends ConnectorContract {
  constructor() {
    super({
      sourceId: 'france-travail-offres',
      name: 'France Travail Public Data',
      version: '1.0.0',
      entityType: 'Aide',
      capabilities: ['REFERENCE']
    });
    this.apiEndpoint = 'https://api.francetravail.io/partenaire';
    this.producerAuthority = 'France Travail';
    this.licence = 'Licence Ouverte v2.0';
    this.accessStatus = 'EXTERNAL_ACTION_REQUIRED';
  }

  async discover() {
    return {
      sourceId: this.metadata.sourceId,
      name: this.metadata.name,
      endpoint: this.apiEndpoint,
      producer: this.producerAuthority,
      licence: this.licence,
      accessStatus: this.accessStatus,
      capabilities: this.metadata.capabilities
    };
  }

  async fetch() {
    return { items: [], fetchedAt: new Date(), syncRunId: crypto.randomUUID() };
  }
  async validate(items) { return { valid: items, rejected: [], errors: [] }; }
  async normalize(items) {
    return items.map(item => ({ ...item, sourceId: 'france-travail-offres', sourceAuthority: 'France Travail', language: 'fr' }));
  }
  // @ts-ignore
  async diff(items) { return items.map(i => ({ ...i, _diffState: 'NEW' })); }
  async persist(items) { return items; }
  // @ts-ignore
  async verify(items) { return { verified: items.length, failed: 0 }; }
  // @ts-ignore
  async report(id, state, stats) { return { syncRunId: id, state, stats }; }
}

export default FranceTravailConnector;
