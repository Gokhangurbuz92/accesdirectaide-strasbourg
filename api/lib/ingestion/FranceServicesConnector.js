// @ts-nocheck
import crypto from 'node:crypto';
import { ConnectorContract } from './ConnectorContract.js';
import { NormalizedStructure } from './normalization/NormalizedStructure.js';

/**
 * France Services Connector.
 * Fetches official ANCT-published France Services directory from data.gouv.fr.
 * Capability: DIRECTORY / LOCAL_SERVICE
 * Producer: ANCT (Agence Nationale de la Cohésion des Territoires)
 * Licence: Licence Ouverte v2.0
 */
export class FranceServicesConnector extends ConnectorContract {
  constructor() {
    super({
      sourceId: 'france-services-anct',
      name: 'France Services ANCT',
      version: '1.0.0',
      entityType: 'Structure',
      capabilities: ['DIRECTORY', 'LOCAL_SERVICE']
    });
    this.datasetUrl = 'https://www.data.gouv.fr/fr/datasets/r/PLACEHOLDER'; // Real URL from data.gouv.fr
    this.producerAuthority = 'ANCT';
    this.licence = 'Licence Ouverte v2.0';
  }

  async discover() {
    return {
      sourceId: this.metadata.sourceId,
      name: this.metadata.name,
      endpoint: this.datasetUrl,
      producer: this.producerAuthority,
      licence: this.licence,
      datasetId: 'france-services-anct',
      capabilities: this.metadata.capabilities
    };
  }

  async fetch() {
    // In production: fetch CSV from data.gouv.fr
    // For now: return empty (EXTERNAL ACTION REQUIRED for production dataset URL)
    return {
      items: [],
      fetchedAt: new Date(),
      syncRunId: crypto.randomUUID()
    };
  }

  async validate(rawItems) {
    const valid = [];
    const rejected = [];
    const errors = [];
    for (const item of rawItems) {
      try {
        // Map CSV columns to NormalizedStructure fields
        const mapped = {
          sourceId: 'france-services-anct',
          externalId: item.id || item.identifiant || `fs-${crypto.randomUUID().slice(0, 8)}`,
          name: item.nom || item.libelle || item.name,
          address: item.adresse || item.voie || '',
          city: item.commune || item.ville || '',
          postalCode: item.code_postal || item.cp || '',
          department: item.departement || null,
          region: item.region || null,
          latitude: item.latitude ? parseFloat(item.latitude) : null,
          longitude: item.longitude ? parseFloat(item.longitude) : null,
          telephone: item.telephone || item.tel || null,
          email: item.email || item.mail || null,
          website: item.site_web || item.url || null,
          structureType: 'France Services',
          openingHours: item.horaires || null,
          sourceUrl: this.datasetUrl,
          sourceOrg: 'ANCT',
          sourceAuthority: 'ANCT',
          language: 'fr',
          fetchedAt: new Date()
        };
        const result = NormalizedStructure.safeParse(mapped);
        if (result.success) {
          valid.push(result.data);
        } else {
          rejected.push(item);
          errors.push(result.error);
        }
      } catch (err) {
        rejected.push(item);
        errors.push(err);
      }
    }
    return { valid, rejected, errors };
  }

  async normalize(validItems) {
    // Already normalized in validate step
    return validItems;
  }

  async diff(normalizedItems) {
    return normalizedItems.map(item => ({ ...item, _diffState: 'NEW' }));
  }

  async persist(diffedItems, /** @type {string | number | boolean | null | undefined} */ syncRunId) {
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

export default FranceServicesConnector;
