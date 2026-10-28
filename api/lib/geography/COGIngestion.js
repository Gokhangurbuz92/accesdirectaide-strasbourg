// @ts-nocheck
/**
 * Phase 9 — COG Ingestion Pipeline
 * Ingests INSEE COG data into Territory, TerritoryLabelHistory, and TerritoryRelation.
 * Implements Phase 8 ConnectorContract lifecycle and SourceRegistry integration.
 *
 * PKG-11 / D12 (first load of the official files, 2026-10-22) — four defects that kept the pipeline from ever loading a real database:
 *  - the source was registered with type 'REFERENCE_DATASET', which is not a SourceType: on PostgreSQL discover() threw and every run ended FAILED;
 *  - items were re-typed by code alone: '94' made the Corse région AND the Val-de-Marne département SPECIAL_STATUS_COLLECTIVITY (the département then lost its
 *    région link); types now follow the COG file the item comes from (a CTCD such as 69M is not a département and is not loaded by this connector);
 *  - a commune was never linked to its département, so a resolved commune had no hierarchy; communes are now PART_OF their département and municipal
 *    arrondissements PART_OF their commune;
 *  - one SELECT per item in diff() and several queries per item in persist(): now one read per type and batched inserts in transactions (idempotent through
 *    the canonical unique index; a second run creates nothing).
 */
import { ConnectorContract, SyncRunState } from '../ingestion/ConnectorContract.js';
import { registerSource, recordSyncResult } from '../ingestion/SourceRegistry.js';
import logger from '../../_utils/logger.js';

export const COG_SOURCE_ID = 'INSEE_COG';
export const BANATIC_SOURCE_ID = 'BANATIC';

// Phase 9: Configurable batch size with bounded default.
const BATCH_SIZE = Math.min(
  Math.max(parseInt(process.env.COG_BATCH_SIZE, 10) || 500, 50),
  2000
);

const COG_LOAD_ORDER = ['REGION', 'DEPARTEMENT', 'COMMUNE', 'MUNICIPAL_ARRONDISSEMENT'];
/** Each COG level is PART_OF the level named by one field of the item (the département of a commune, the commune of a municipal arrondissement). */
const COG_PARENT = {
  DEPARTEMENT: { type: 'REGION', field: 'codeRegion' },
  COMMUNE: { type: 'DEPARTEMENT', field: 'codeDepartement' },
  MUNICIPAL_ARRONDISSEMENT: { type: 'COMMUNE', field: 'codeCommune' },
};

/**
 * INSEE COG Connector — implements ConnectorContract lifecycle.
 */
export class COGConnector extends ConnectorContract {
  // @ts-ignore
  constructor(db, schemas) {
    super({
      sourceId: COG_SOURCE_ID,
      name: 'INSEE COG (Code Officiel Géographique)',
      version: '1.0.0',
      entityType: 'Territory',
      capabilities: ['REFERENCE']
    });
    this.db = db;
    this.schemas = schemas;
    this._rawData = null;
    this._cogVersion = null;
  }

  async discover() {
    await registerSource({
      sourceId: COG_SOURCE_ID,
      name: 'INSEE COG (Code Officiel Géographique)',
      type: 'CSV',
      endpoint: 'https://www.insee.fr/fr/information/2560452',
      cronSchedule: '0 3 1 2 *',
      capabilities: ['REFERENCE'],
      producerAuthority: 'INSEE',
      distributionPlatform: 'INSEE Open Data',
      organisation: 'Institut National de la Statistique et des Études Économiques',
      territory: 'FRANCE',
      licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
      licenceName: 'Licence Ouverte / Open Licence v2.0'
    });
    logger.info('[COGConnector] Source registered in SourceRegistry');
  }

  setData(data) {
    this._rawData = data;
    this._cogVersion = data.cogVersion;
  }

  async fetch() {
    if (!this._rawData) {
      throw new Error('[COGConnector] No data provided — call setData() before execute()');
    }
    const items = [];
    for (const r of this._rawData.regions || []) items.push({ ...r, _cogType: 'REGION' });
    for (const d of this._rawData.departments || []) items.push({ ...d, _cogType: 'DEPARTEMENT' });
    for (const c of this._rawData.communes || []) items.push({ ...c, _cogType: 'COMMUNE' });
    for (const a of this._rawData.arrondissements || []) items.push({ ...a, _cogType: 'MUNICIPAL_ARRONDISSEMENT' });
    for (const rep of this._rawData.replacements || []) items.push({ ...rep, _cogType: 'REPLACEMENT' });
    return { items, fetchedAt: new Date(), syncRunId: '' };
  }

  // @ts-ignore
  async validate(rawItems) {
    if (rawItems.length === 0) {
      return { valid: [], rejected: [], errors: [new Error('Empty COG payload — preserving last-known-good')] };
    }
    const valid = [];
    const rejected = [];
    const errors = [];
    for (const item of rawItems) {
      if (item._cogType === 'REPLACEMENT') {
        if (!item.oldCode || !item.newCode) {
          rejected.push(item);
          errors.push(new Error('Invalid replacement: missing oldCode/newCode'));
        } else { valid.push(item); }
      } else {
        if (!item.code || !item.nom) {
          rejected.push(item);
          errors.push(new Error(`Invalid territory: missing code/nom for type ${item._cogType}`));
        } else { valid.push(item); }
      }
    }
    return { valid, rejected, errors };
  }

  async normalize(validItems) {
    return validItems.map(item => ({
      ...item,
      _sourceId: COG_SOURCE_ID,
      _sourceVersion: this._cogVersion,
      _fetchedAt: new Date().toISOString()
    }));
  }

  // @ts-ignore
  async diff(normalizedItems) {
    const { Territory } = this.schemas;
    const { eq } = await import('drizzle-orm');
    const rows = await this.db.select({ type: Territory.type, code: Territory.officialCode }).from(Territory).where(eq(Territory.authority, COG_SOURCE_ID));
    const existing = new Set(rows.map((/** @type {{ type: string, code: string }} */ r) => `${r.type}|${r.code}`));
    return normalizedItems.map(item => (item._cogType === 'REPLACEMENT'
      ? { ...item, _diffState: 'NEW' }
      : { ...item, _diffState: existing.has(`${item._cogType}|${item.code}`) ? 'UNCHANGED' : 'NEW' }));
  }

  async persist(diffedItems, /** @type {string | number | boolean | null | undefined} */ syncRunId) {
    const { Territory, TerritoryLabelHistory, TerritoryRelation } = this.schemas;
    const { eq, and } = await import('drizzle-orm');
    const validFrom = new Date(`${this._cogVersion}-01-01`);
    const idsOf = async (/** @type {string} */ type) => new Map((await this.db.select({ id: Territory.id, code: Territory.officialCode }).from(Territory)
      .where(and(eq(Territory.authority, COG_SOURCE_ID), eq(Territory.type, type)))).map((/** @type {{ id: string, code: string }} */ r) => [r.code, r.id]));

    // parents first, so that every child finds its parent's id
    for (const type of COG_LOAD_ORDER) {
      const items = diffedItems.filter(i => i._diffState === 'NEW' && i._cogType === type);
      if (items.length === 0) continue;
      const parent = COG_PARENT[type];
      const parentIds = parent ? await idsOf(parent.type) : null;
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        await this.db.transaction(async (/** @type {any} */ tx) => {
          const inserted = await tx.insert(Territory).values(batch.map(item => ({
            authority: COG_SOURCE_ID, type, officialCode: item.code, status: 'CURRENT', sourceId: COG_SOURCE_ID, sourceVersion: this._cogVersion
          }))).onConflictDoNothing().returning({ id: Territory.id, code: Territory.officialCode });
          const idByCode = new Map(inserted.map((/** @type {{ id: string, code: string }} */ r) => [r.code, r.id]));
          const created = batch.filter(item => idByCode.has(item.code));
          if (created.length === 0) return;
          await tx.insert(TerritoryLabelHistory).values(created.map(item => ({
            territoryId: idByCode.get(item.code), name: item.nom, validFrom, sourceId: COG_SOURCE_ID, sourceVersion: this._cogVersion
          })));
          const links = parentIds ? created.filter(item => parentIds.has(item[parent.field])) : [];
          if (links.length > 0) {
            await tx.insert(TerritoryRelation).values(links.map(item => ({
              sourceId: idByCode.get(item.code), targetId: parentIds.get(item[parent.field]), type: 'PART_OF',
              sourceRefId: COG_SOURCE_ID, sourceVersion: this._cogVersion
            })));
          }
        });
      }
    }
    for (const item of diffedItems) {
      if (item._diffState === 'NEW' && item._cogType === 'REPLACEMENT') await this._processReplacement(item);
    }
  }

  async _processReplacement(/** @type {{ newCode: string | number | boolean | null | undefined, oldCode: string | number | boolean | null | undefined }} */ item) {
    const { Territory, TerritoryRelation } = this.schemas;
    const { eq, and } = await import('drizzle-orm');
    const oldT = await this.db.select().from(Territory)
      .where(and(eq(Territory.authority, COG_SOURCE_ID), eq(Territory.type, 'COMMUNE'), eq(Territory.officialCode, item.oldCode)))
      .limit(1);
    const newT = await this.db.select().from(Territory)
      .where(and(eq(Territory.authority, COG_SOURCE_ID), eq(Territory.type, 'COMMUNE'), eq(Territory.officialCode, item.newCode)))
      .limit(1);
    if (oldT.length > 0 && newT.length > 0) {
      await this.db.update(Territory).set({ status: 'HISTORICAL', validTo: new Date(`${this._cogVersion}-01-01`) })
        .where(eq(Territory.id, oldT[0].id));
      await this.db.insert(TerritoryRelation).values({
        sourceId: oldT[0].id, targetId: newT[0].id, type: 'REPLACED_BY',
        validFrom: new Date(`${this._cogVersion}-01-01`),
        sourceRefId: COG_SOURCE_ID, sourceVersion: this._cogVersion
      });
    }
  }

  // @ts-ignore
  async verify(persistedItems) {
    return { verified: persistedItems.length, failed: 0 };
  }

  async report(/** @type {string | number | boolean | null | undefined} */ syncRunId, /** @type {string | number | boolean | null | undefined} */ state, stats) {
    await recordSyncResult(COG_SOURCE_ID, state === SyncRunState.COMPLETE);
    logger.info('[COGConnector] Sync complete:', { state, ...stats });
  }
}

/**
 * BANATIC EPCI Connector — implements ConnectorContract lifecycle.
 */
export class BANATICConnector extends ConnectorContract {
  // @ts-ignore
  constructor(db, schemas) {
    super({
      sourceId: BANATIC_SOURCE_ID,
      name: 'BANATIC (Base Nationale sur les Intercommunalités)',
      version: '1.0.0',
      entityType: 'Territory',
      capabilities: ['REFERENCE']
    });
    this.db = db;
    this.schemas = schemas;
    this._rawData = null;
    this._cogVersion = null;
  }

  async discover() {
    await registerSource({
      sourceId: BANATIC_SOURCE_ID,
      name: 'BANATIC (Base Nationale sur les Intercommunalités)',
      type: 'CSV',
      endpoint: 'https://www.banatic.interieur.gouv.fr/',
      cronSchedule: '0 3 1 3 *',
      capabilities: ['REFERENCE'],
      producerAuthority: 'DGCL',
      distributionPlatform: 'DGCL Open Data',
      organisation: 'Direction Générale des Collectivités Locales',
      territory: 'FRANCE',
      licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
      licenceName: 'Licence Ouverte / Open Licence v2.0'
    });
    logger.info('[BANATICConnector] Source registered in SourceRegistry');
  }

  setData(data) {
    this._rawData = data;
    this._cogVersion = data.cogVersion;
  }

  async fetch() {
    if (!this._rawData) throw new Error('[BANATICConnector] No data — call setData()');
    return { items: this._rawData.epcis || [], fetchedAt: new Date(), syncRunId: '' };
  }

  // @ts-ignore
  async validate(rawItems) {
    if (rawItems.length === 0) {
      return { valid: [], rejected: [], errors: [new Error('Empty BANATIC payload — preserving last-known-good')] };
    }
    const valid = [];
    const rejected = [];
    const errors = [];
    for (const epci of rawItems) {
      if (!epci.siren || !epci.nom) {
        rejected.push(epci);
        errors.push(new Error('Invalid EPCI: missing siren/nom'));
      } else { valid.push(epci); }
    }
    return { valid, rejected, errors };
  }

  async normalize(validItems) {
    return validItems.map(item => ({ ...item, _sourceId: BANATIC_SOURCE_ID, _sourceVersion: this._cogVersion }));
  }

  // @ts-ignore
  async diff(normalizedItems) {
    const { Territory } = this.schemas;
    const { eq, and } = await import('drizzle-orm');
    const diffed = [];
    for (const epci of normalizedItems) {
      const existing = await this.db.select().from(Territory)
        .where(and(eq(Territory.authority, BANATIC_SOURCE_ID), eq(Territory.type, 'EPCI'), eq(Territory.officialCode, epci.siren)))
        .limit(1);
      diffed.push({ ...epci, _diffState: existing.length === 0 ? 'NEW' : 'UNCHANGED' });
    }
    return diffed;
  }

  async persist(diffedItems, /** @type {string | number | boolean | null | undefined} */ syncRunId) {
    const { Territory, TerritoryLabelHistory, TerritoryRelation } = this.schemas;
    const { eq, and } = await import('drizzle-orm');

    for (let i = 0; i < diffedItems.length; i += BATCH_SIZE) {
      const batch = diffedItems.slice(i, i + BATCH_SIZE);
      for (const epci of batch) {
        if (epci._diffState !== 'NEW') continue;
        await this.db.insert(Territory).values({
          authority: BANATIC_SOURCE_ID, type: 'EPCI', officialCode: epci.siren,
          status: 'CURRENT', sourceId: BANATIC_SOURCE_ID, sourceVersion: this._cogVersion
        });
        const inserted = (await this.db.select().from(Territory)
          .where(and(eq(Territory.authority, BANATIC_SOURCE_ID), eq(Territory.type, 'EPCI'), eq(Territory.officialCode, epci.siren)))
          .limit(1))[0];
        await this.db.insert(TerritoryLabelHistory).values({
          territoryId: inserted.id, name: epci.nom,
          validFrom: new Date(`${this._cogVersion}-01-01`),
          sourceId: BANATIC_SOURCE_ID, sourceVersion: this._cogVersion
        });
        if (epci.membres) {
          for (const membre of epci.membres) {
            const commune = await this.db.select().from(Territory)
              .where(and(eq(Territory.authority, COG_SOURCE_ID), eq(Territory.type, 'COMMUNE'), eq(Territory.officialCode, membre.codeInsee)))
              .limit(1);
            if (commune.length > 0) {
              const rel = {
                sourceId: commune[0].id, targetId: inserted.id, type: 'MEMBER_OF',
                sourceRefId: BANATIC_SOURCE_ID, sourceVersion: this._cogVersion
              };
              await this.db.insert(TerritoryRelation).values(rel);
            }
          }
        }
      }
    }
  }

  // @ts-ignore
  async verify(persistedItems) {
    return { verified: persistedItems.length, failed: 0 };
  }

  async report(/** @type {string | number | boolean | null | undefined} */ syncRunId, /** @type {string | number | boolean | null | undefined} */ state, stats) {
    await recordSyncResult(BANATIC_SOURCE_ID, state === SyncRunState.COMPLETE);
    logger.info('[BANATICConnector] Sync complete:', { state, ...stats });
  }
}

export const INSEE_EPCI_SOURCE_ID = 'INSEE_EPCI';

/**
 * PKG-11 / D12 — EPCI and their member communes as published by INSEE (« Intercommunalité et Métropole », composition communale au 1er janvier; EPCI codes
 * are SIREN numbers). Same namespace as the COG territories (authority INSEE_COG, type EPCI, the nature in metadata); each member commune is MEMBER_OF its
 * EPCI. Load after the COG communes: a member that is not a current COG commune is reported, never invented.
 */
export class INSEEEPCIConnector extends ConnectorContract {
  // @ts-ignore
  constructor(db, schemas) {
    super({
      sourceId: INSEE_EPCI_SOURCE_ID,
      name: 'Insee — Intercommunalité et Métropole (composition communale)',
      version: '1.0.0',
      entityType: 'Territory',
      capabilities: ['REFERENCE']
    });
    this.db = db;
    this.schemas = schemas;
    this._rawData = null;
    this._cogVersion = null;
    this.missingMembers = [];
  }

  async discover() {
    await registerSource({
      sourceId: INSEE_EPCI_SOURCE_ID,
      name: 'Insee — Intercommunalité et Métropole (composition communale)',
      type: 'CSV',
      endpoint: 'https://www.insee.fr/fr/information/2510634',
      cronSchedule: null,
      capabilities: ['REFERENCE'],
      producerAuthority: 'INSEE',
      distributionPlatform: 'INSEE Open Data',
      organisation: 'Institut National de la Statistique et des Études Économiques',
      territory: 'FRANCE',
      licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
      licenceName: 'Licence Ouverte / Open Licence v2.0'
    });
  }

  setData(data) {
    this._rawData = data;
    this._cogVersion = data.cogVersion;
  }

  async fetch() {
    if (!this._rawData) throw new Error('[INSEEEPCIConnector] No data — call setData()');
    return { items: this._rawData.epcis || [], fetchedAt: new Date(), syncRunId: '' };
  }

  // @ts-ignore
  async validate(rawItems) {
    const valid = [];
    const rejected = [];
    const errors = [];
    for (const epci of rawItems) {
      if (!/^\d{9}$/.test(String(epci.code || '')) || !epci.nom || !Array.isArray(epci.membres)) {
        rejected.push(epci);
        errors.push(new Error('Invalid EPCI: code (SIREN), nom and membres are required'));
      } else { valid.push(epci); }
    }
    return { valid, rejected, errors };
  }

  async normalize(validItems) {
    return validItems.map(item => ({ ...item, _sourceId: INSEE_EPCI_SOURCE_ID, _sourceVersion: this._cogVersion }));
  }

  // @ts-ignore
  async diff(normalizedItems) {
    const { Territory } = this.schemas;
    const { eq, and } = await import('drizzle-orm');
    const rows = await this.db.select({ code: Territory.officialCode }).from(Territory)
      .where(and(eq(Territory.authority, COG_SOURCE_ID), eq(Territory.type, 'EPCI')));
    const existing = new Set(rows.map((/** @type {{ code: string }} */ r) => r.code));
    return normalizedItems.map(item => ({ ...item, _diffState: existing.has(item.code) ? 'UNCHANGED' : 'NEW' }));
  }

  async persist(diffedItems, /** @type {string | number | boolean | null | undefined} */ syncRunId) {
    const { Territory, TerritoryLabelHistory, TerritoryRelation } = this.schemas;
    const { eq, and } = await import('drizzle-orm');
    const validFrom = new Date(`${this._cogVersion}-01-01`);
    const communeIds = new Map((await this.db.select({ id: Territory.id, code: Territory.officialCode }).from(Territory)
      .where(and(eq(Territory.authority, COG_SOURCE_ID), eq(Territory.type, 'COMMUNE')))).map((/** @type {{ id: string, code: string }} */ r) => [r.code, r.id]));
    const items = diffedItems.filter(i => i._diffState === 'NEW');
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      await this.db.transaction(async (/** @type {any} */ tx) => {
        const inserted = await tx.insert(Territory).values(batch.map(epci => ({
          authority: COG_SOURCE_ID, type: 'EPCI', officialCode: epci.code, status: 'CURRENT',
          sourceId: INSEE_EPCI_SOURCE_ID, sourceVersion: this._cogVersion, metadata: epci.nature ? { nature: epci.nature } : null
        }))).onConflictDoNothing().returning({ id: Territory.id, code: Territory.officialCode });
        const idByCode = new Map(inserted.map((/** @type {{ id: string, code: string }} */ r) => [r.code, r.id]));
        const created = batch.filter(epci => idByCode.has(epci.code));
        if (created.length === 0) return;
        await tx.insert(TerritoryLabelHistory).values(created.map(epci => ({
          territoryId: idByCode.get(epci.code), name: epci.nom, validFrom, sourceId: INSEE_EPCI_SOURCE_ID, sourceVersion: this._cogVersion
        })));
        const links = [];
        for (const epci of created) {
          for (const member of epci.membres) {
            if (communeIds.has(member)) {
              links.push({ sourceId: communeIds.get(member), targetId: idByCode.get(epci.code), type: 'MEMBER_OF', sourceRefId: INSEE_EPCI_SOURCE_ID, sourceVersion: this._cogVersion });
            } else {
              this.missingMembers.push(`${epci.code}:${member}`);
            }
          }
        }
        for (let j = 0; j < links.length; j += BATCH_SIZE) await tx.insert(TerritoryRelation).values(links.slice(j, j + BATCH_SIZE));
      });
    }
  }

  // @ts-ignore
  async verify(persistedItems) {
    if (this.missingMembers.length > 0) throw new Error(`EPCI members that are not current COG communes: ${this.missingMembers.slice(0, 5).join(', ')}`);
    return { verified: persistedItems.length, failed: 0 };
  }

  async report(/** @type {string | number | boolean | null | undefined} */ syncRunId, /** @type {string | number | boolean | null | undefined} */ state, stats) {
    await recordSyncResult(INSEE_EPCI_SOURCE_ID, state === SyncRunState.COMPLETE);
    logger.info('[INSEEEPCIConnector] Sync complete:', { state, ...stats });
  }
}

// Legacy exports for backward compatibility with existing test imports
export async function ingestRegions(/** @type {string | number | boolean | null | undefined} */ regions, /** @type {string | number | boolean | null | undefined} */ db, /** @type {string | number | boolean | null | undefined} */ schemas, /** @type {string | number | boolean | null | undefined} */ cogVersion) {
  const connector = new COGConnector(db, schemas);
  connector.setData({ regions, departments: [], communes: [], replacements: [], cogVersion });
  return connector.execute();
}

export async function ingestDepartments(/** @type {string | number | boolean | null | undefined} */ departments, /** @type {string | number | boolean | null | undefined} */ db, /** @type {string | number | boolean | null | undefined} */ schemas, /** @type {string | number | boolean | null | undefined} */ cogVersion) {
  const connector = new COGConnector(db, schemas);
  connector.setData({ regions: [], departments, communes: [], replacements: [], cogVersion });
  return connector.execute();
}

export async function ingestEPCIMemberships(/** @type {string | number | boolean | null | undefined} */ epcis, /** @type {string | number | boolean | null | undefined} */ db, /** @type {string | number | boolean | null | undefined} */ schemas, /** @type {string | number | boolean | null | undefined} */ cogVersion) {
  const connector = new BANATICConnector(db, schemas);
  connector.setData({ epcis, cogVersion });
  return connector.execute();
}

export async function processReplacements(/** @type {string | number | boolean | null | undefined} */ replacements, /** @type {string | number | boolean | null | undefined} */ db, /** @type {string | number | boolean | null | undefined} */ schemas, /** @type {string | number | boolean | null | undefined} */ cogVersion) {
  const connector = new COGConnector(db, schemas);
  connector.setData({ regions: [], departments: [], communes: [], replacements, cogVersion });
  return connector.execute();
}

export default { COGConnector, BANATICConnector, INSEEEPCIConnector, ingestRegions, ingestDepartments, ingestEPCIMemberships, processReplacements };
