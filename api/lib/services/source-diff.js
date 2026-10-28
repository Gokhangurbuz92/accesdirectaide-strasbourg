// @ts-nocheck
import crypto from 'crypto';

/**
 * @param {null | undefined} content
 */
export function computeContentHash(content) {
  if (content === null || content === undefined) return null;
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  return crypto.createHash('md5').update(str).digest('hex');
}

export function computeDiff(/** @type {string | number | boolean | null | undefined} */ entityType, /** @type {string | number | boolean | null | undefined} */ entityId, /** @type {string | number | boolean | null | undefined} */ newHash, /** @type {string | number | boolean | null | undefined} */ existingHash) {
  if (!existingHash) return 'NEW';
  if (existingHash === newHash) return 'UNCHANGED';
  return 'UPDATED';
}

/**
* @param {any[]} items
*/
export function batchComputeDiff(items) {
  return items.map(item => ({
    ...item,
    _diffState: computeDiff(item.entityType, item.entityId, item.newHash, item.existingHash)
  }));
}

/**
 * @param {null | undefined} rawOld
 * @param {null | undefined} rawNew
 * @param {null | undefined} normalizedOld
 * @param {null | undefined} normalizedNew
 */
export function classifyChange(rawOld, rawNew, normalizedOld, normalizedNew) {
  const oldRawHash = computeContentHash(rawOld);
  const newRawHash = computeContentHash(rawNew);
  const oldNormHash = computeContentHash(normalizedOld);
  const newNormHash = computeContentHash(normalizedNew);

  if (oldRawHash === newRawHash && oldNormHash === newNormHash) {
    return 'METADATA_ONLY_CHANGED';
  }

  if (oldRawHash !== newRawHash && oldNormHash === newNormHash) {
    return 'RAW_CONTENT_CHANGED';
  }

  if (oldNormHash !== newNormHash) {
    return 'NORMALIZED_FACT_CHANGED';
  }

  return 'METADATA_ONLY_CHANGED';
}

/**
 * @param {string} classification
 */
export function shouldInvalidateEmbedding(classification) {
  return classification === 'NORMALIZED_FACT_CHANGED';
}
