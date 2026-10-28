// @ts-nocheck
import logger from '../_utils/logger.js';

/**
 * DTA S8 — erasure of the encrypted document blobs of a shared dossier.
 *
 * A dossier's uploaded documents live in object storage; the row only holds their metadata (results._files[].storageKey). Deleting the SharedDiagnostic row (citizen
 * erasure, retention purge, DSR) cascades to grants, threads and messages but NOT to the blobs: before S8 the encrypted files stayed in storage after the person's data
 * was "erased". Every deletion site now takes the keys from the deleted row (`.returning({ results })`) and calls purgeDossierFiles AFTER the row is gone.
 * Blob deletion is best effort and never turns a successful erasure into a failure; a blob that cannot be deleted is logged by key (an opaque identifier, not content) so an operator can purge it.
 */

/** @param {unknown} results the `results` JSON of a SharedDiagnostic row @returns {string[]} */
export function storageKeysOf(results) {
  const files = results && typeof results === 'object' && Array.isArray(/** @type {any} */ (results)._files) ? /** @type {any} */ (results)._files : [];
  return files
    .map((/** @type {any} */ f) => (f && typeof f.storageKey === 'string' ? f.storageKey : ''))
    .filter((/** @type {string} */ k) => k.length > 0);
}

/**
 * @param {string[]} keys
 * @param {{ storage?: { delete: (key: string) => Promise<unknown> } }} [deps] test seam
 * @returns {Promise<{ requested: number, deleted: number, failed: string[] }>}
 */
export async function purgeDossierFiles(keys, deps = {}) {
  const unique = [...new Set((keys || []).filter((k) => typeof k === 'string' && k))];
  if (unique.length === 0) return { requested: 0, deleted: 0, failed: [] };
  const storage = deps.storage || (await import('../lib/storage.js')).storage;
  /** @type {string[]} */
  const failed = [];
  let deleted = 0;
  for (const key of unique) {
    try {
      await storage.delete(key);
      deleted += 1;
    } catch (error) {
      failed.push(key);
      logger.error({ storageKey: key, err: { name: error instanceof Error ? error.name : 'Error' } }, '[Dossier files] encrypted blob could not be deleted after erasure — purge manually');
    }
  }
  return { requested: unique.length, deleted, failed };
}
