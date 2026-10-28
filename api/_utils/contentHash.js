import crypto from 'crypto';

/**
 * Build a stable JSON string by sorting object keys recursively.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }

  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const input = /** @type {Record<string, unknown>} */ (value);
    /** @type {Record<string, unknown>} */
    const output = {};
    for (const key of Object.keys(input).sort()) {
      output[key] = sortJson(input[key]);
    }
    return output;
  }

  return value;
}

/**
 * Compute a deterministic sha256 hash for arbitrary JSON-compatible payloads.
 *
 * @param {unknown} payload
 * @returns {string}
 */
export function computeContentHash(payload) {
  const normalized = sortJson(payload);
  const serialized = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Compute sha256 for raw string-like content.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function computeRawContentHash(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex');
}
