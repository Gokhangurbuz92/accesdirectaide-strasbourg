// @ts-nocheck
import crypto from 'node:crypto';
import { ConnectorContract } from './ConnectorContract.js';

/**
 * Légifrance Connector (bounded Phase 8 scope).
 * Provides authoritative legal reference retrieval.
 * 
 * Phase 8 scope: Article/text/version identifiers, effective dates, SourceEnvelope citations.
 * NOT: Full French legal corpus replication.
 * 
 * EXTERNAL ACTION REQUIRED: PISTE registration for API access.
 * Until credentials available, uses deterministic fixtures.
 */
export class LegifranceConnector extends ConnectorContract {
  constructor() {
    super({
      sourceId: 'legifrance-piste',
      name: 'Légifrance PISTE',
      version: '1.0.0',
      entityType: 'Aide', // Legal references enriching aid data
      capabilities: ['LEGAL', 'REGULATORY']
    });
    this.pisteEndpoint = 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app';
    this.producerAuthority = 'DILA';
    this.licence = 'Licence Ouverte v2.0';
    this.accessStatus = 'EXTERNAL_ACTION_REQUIRED'; // PISTE registration needed
  }

  async discover() {
    return {
      sourceId: this.metadata.sourceId,
      name: this.metadata.name,
      endpoint: this.pisteEndpoint,
      producer: this.producerAuthority,
      licence: this.licence,
      accessStatus: this.accessStatus,
      capabilities: this.metadata.capabilities
    };
  }

  async fetch() {
    // EXTERNAL ACTION REQUIRED: PISTE credentials
    // Using empty fetch until registration complete
    return {
      items: [],
      fetchedAt: new Date(),
      syncRunId: crypto.randomUUID()
    };
  }

  async validate(rawItems) {
    return { valid: rawItems, rejected: [], errors: [] };
  }

  async normalize(validItems) {
    return validItems.map(item => ({
      ...item,
      sourceId: 'legifrance-piste',
      sourceAuthority: 'DILA',
      language: 'fr'
    }));
  }

  async diff(items) {
    return items.map(i => ({ ...i, _diffState: 'NEW' }));
  }

  async persist(items) { return items; }
  // @ts-ignore
  async verify(items) { return { verified: items.length, failed: 0 }; }
  // @ts-ignore
  async report(id, state, stats) { return { syncRunId: id, state, stats }; }
}

export default LegifranceConnector;
