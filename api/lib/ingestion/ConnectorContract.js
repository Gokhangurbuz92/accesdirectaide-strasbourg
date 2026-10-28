// @ts-nocheck
import crypto from 'node:crypto';
import { z } from 'zod';

/**
 * Canonical Phase 8 Connector Contract.
 * All connectors must implement this lifecycle.
 * 
 * Lifecycle: discover() → fetch() → validate() → normalize() → diff() → persist() → verify() → report()
 */

export const SyncRunState = Object.freeze({
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED'
});

export const ConnectorMetadataSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  entityType: z.enum(['Aide', 'Demarche', 'Structure', 'Actualite', 'Territory']),
  capabilities: z.array(z.enum(['LEGAL', 'REGULATORY', 'BENEFIT_RULE', 'BENEFIT_PARAMETER', 'PROCEDURAL', 'DIRECTORY', 'STATISTICAL', 'REFERENCE', 'OPEN_DATA_CATALOG', 'LOCAL_SERVICE'])).min(1)
});

export class ConnectorContract {
  /**
   * @param {z.infer<typeof ConnectorMetadataSchema>} metadata
   */
  constructor(metadata) {
    this.metadata = ConnectorMetadataSchema.parse(metadata);
  }

  /** Return source metadata for registration */
  async discover() {
    throw new Error(`${this.constructor.name}.discover() not implemented`);
  }

  /** Fetch raw data from external source. Returns { items: any[], fetchedAt: Date, syncRunId: string } */
  async fetch() {
    throw new Error(`${this.constructor.name}.fetch() not implemented`);
  }

  /** Validate raw items against schema. Returns { valid: any[], rejected: any[], errors: Error[] } */
  async validate(/** @type {number} */ rawItems) {
    throw new Error(`${this.constructor.name}.validate() not implemented`);
  }

  /** Normalize validated items to domain model. Returns normalized items with SourceEnvelope */
  async normalize(/** @type {number} */ validItems) {
    throw new Error(`${this.constructor.name}.normalize() not implemented`);
  }

  /**
   * Compute diff against existing data. Returns items tagged with diffState
   * @param {void} normalizedItems
   */
  async diff(normalizedItems) {
    throw new Error(`${this.constructor.name}.diff() not implemented`);
  }

  /** Persist new/updated items transactionally. Empty response must NOT delete existing data */
  async persist(/** @type {number} */ diffedItems, syncRunId) {
    throw new Error(`${this.constructor.name}.persist() not implemented`);
  }

  /** Post-persist verification. Returns { verified: number, failed: number } */
  async verify(/** @type {number} */ persistedItems) {
    throw new Error(`${this.constructor.name}.verify() not implemented`);
  }

  /**
* Create SyncRun + ImportLog records. Returns { syncRunId, state, stats }
* @param {string} state
* @param {{ fetched: number; validated: number; rejected: number; created: number; updated: number; unchanged: number; removed: number; conflicting: number; errors: never[]; }} stats
*/
  async report(/** @type {string} */ syncRunId, state, stats) {
    throw new Error(`${this.constructor.name}.report() not implemented`);
  }

  /** Full lifecycle execution with safety guarantees */
  async execute() {
    const syncRunId = crypto.randomUUID();
    let state = SyncRunState.FAILED;
    const stats = { fetched: 0, validated: 0, rejected: 0, created: 0, updated: 0, unchanged: 0, removed: 0, conflicting: 0, errors: [] };

    try {
      // 1. Discover
      await this.discover();

      // 2. Fetch
      const fetchResult = await this.fetch();
      stats.fetched = fetchResult.items.length;

      // SAFETY: Empty response must NOT delete existing records
      if (fetchResult.items.length === 0) {
        state = SyncRunState.PARTIAL;
        stats.errors.push('Empty response from source — preserving last-known-good');
        await this.report(syncRunId, state, stats);
        return { syncRunId, state, stats };
      }

      // 3. Validate
      const validateResult = await this.validate(fetchResult.items);
      stats.validated = validateResult.valid.length;
      stats.rejected = validateResult.rejected.length;

      // 4. Normalize
      const normalized = await this.normalize(validateResult.valid);

      // 5. Diff
      const diffed = await this.diff(normalized);
      for (const item of diffed) {
        if (item._diffState === 'NEW') stats.created++;
        else if (item._diffState === 'UPDATED') stats.updated++;
        else if (item._diffState === 'UNCHANGED') stats.unchanged++;
        else if (item._diffState === 'REMOVED') stats.removed++;
        else if (item._diffState === 'CONFLICTING') stats.conflicting++;
      }

      // 6. Persist (only non-UNCHANGED)
      const toPersist = diffed.filter(/** @type {{ _diffState: string; }} */ (/** @type {{ _diffState: string; }} */ i) => i._diffState !== 'UNCHANGED');
      await this.persist(toPersist, syncRunId);

      // 7. Verify
      await this.verify(toPersist);

      state = stats.rejected > 0 || stats.errors.length > 0 ? SyncRunState.PARTIAL : SyncRunState.COMPLETE;
    } catch (error) {
      state = SyncRunState.FAILED;
      // @ts-ignore
      stats.errors.push(error.message);
    }

    // 8. Report
    await this.report(syncRunId, state, stats);
    return { syncRunId, state, stats };
  }
}
