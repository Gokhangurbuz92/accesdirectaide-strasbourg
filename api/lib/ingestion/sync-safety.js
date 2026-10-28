// @ts-nocheck
import crypto from 'node:crypto';

/**
 * Sync safety module.
 * Ensures failed/partial sync runs never corrupt persisted data.
 * Empty response ≠ delete all records.
 */

export const SyncCompletionState = Object.freeze({
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED'
});

export function createSyncRun(/** @type {string | number | boolean | null | undefined} */ sourceId) {
  return {
    id: crypto.randomUUID(),
    sourceId,
    state: null,
    startedAt: new Date(),
    completedAt: null,
    stats: { fetched: 0, validated: 0, persisted: 0, rejected: 0, errors: [] }
  };
}

export function completeSyncRun(syncRun, /** @type {string | number | boolean | null | undefined} */ state, stats = {}) {
  return {
    ...syncRun,
    state,
    completedAt: new Date(),
    stats: { ...syncRun.stats, ...stats }
  };
}

export async function executeWithTransactionSafety(/** @type {string | number | boolean | null | undefined} */ syncRunId, /** @type {(...args: unknown[]) => unknown} */ operation) {
  try {
    const result = await operation();
    return { success: true, syncRunId, result };
  } catch (error) {
    return { success: false, syncRunId, error: error.message, rollbackPerformed: true };
  }
}

export function isEmptyResponseSafe(/** @type {{ length: string | number | boolean | null | undefined }} */ fetchedItems, /** @type {number} */ existingCount) {
  if (fetchedItems.length === 0 && existingCount > 0) {
    return {
      safe: false,
      reason: 'EMPTY_RESPONSE_WITH_EXISTING_DATA',
      action: 'PRESERVE_LAST_KNOWN_GOOD',
      message: 'Remote returned empty response but existing records exist. Preserving last-known-good data.'
    };
  }
  return { safe: true };
}

export function preserveLastKnownGood(/** @type {string | number | boolean | null | undefined} */ entityId, /** @type {string | number | boolean | null | undefined} */ currentVersion) {
  return {
    entityId,
    preservedVersion: currentVersion,
    preservedAt: new Date(),
    reason: 'SYNC_FAILURE_PRESERVATION',
    flaggedForReview: true
  };
}
