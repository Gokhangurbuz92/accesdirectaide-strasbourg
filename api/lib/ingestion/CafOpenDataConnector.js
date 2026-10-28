// @ts-nocheck
import crypto from 'node:crypto';
import { ConnectorContract } from './ConnectorContract.js';

/**
 * CAF/CNAF Open Data Connector.
 * Capability: STATISTICAL (family benefit statistics)
 * CRITICAL: STATISTICAL capability MUST NOT qualify as ELIGIBILITY_RULE or BENEFIT_PARAMETER.
 * Producer: CNAF
 * Licence: Licence Ouverte v2.0
 */
export class CafOpenDataConnector extends ConnectorContract {
  constructor() {
    super({
      sourceId: 'caf-open-data',
      name: 'CAF/CNAF Open Data',
      version: '1.0.0',
      entityType: 'Aide',
      capabilities: ['STATISTICAL', 'REFERENCE'] // NOT BENEFIT_RULE
    });
    this.producerAuthority = 'CNAF';
    this.distributionPlatform = 'data.gouv.fr';
    this.licence = 'Licence Ouverte v2.0';
  }

  async discover() {
    return {
      sourceId: this.metadata.sourceId,
      name: this.metadata.name,
      producer: this.producerAuthority,
      distributionPlatform: this.distributionPlatform,
      licence: this.licence,
      capabilities: this.metadata.capabilities,
      note: 'STATISTICAL source — does NOT provide individual eligibility evidence'
    };
  }

  async fetch() {
    return { items: [], fetchedAt: new Date(), syncRunId: crypto.randomUUID() };
  }
  async validate(items) { return { valid: items, rejected: [], errors: [] }; }
  async normalize(items) {
    return items.map(item => ({ ...item, sourceId: 'caf-open-data', sourceAuthority: 'CNAF', language: 'fr' }));
  }
  // @ts-ignore
  async diff(items) { return items.map(i => ({ ...i, _diffState: 'NEW' })); }
  async persist(items) { return items; }
  // @ts-ignore
  async verify(items) { return { verified: items.length, failed: 0 }; }
  // @ts-ignore
  async report(id, state, stats) { return { syncRunId: id, state, stats }; }
}

export default CafOpenDataConnector;
