/**
 * @param {unknown} value
 * @returns {string | null}
 */
function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function extractSourceHost(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const host = String(parsed.hostname || '').trim().toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/**
 * @param {{
 *  verifiedAt?: unknown,
 *  fetchedAt?: unknown,
 *  sourceUrl?: unknown,
 * }} input
 * @returns {{
 *  verifiedAt: string | null,
 *  fetchedAt: string | null,
 *  sourceUrl: string | null,
 *  sourceHost: string | null,
 * }}
 */
export function buildProvenance(input = {}) {
  const rawSourceUrl = typeof input.sourceUrl === 'string' ? input.sourceUrl.trim() : '';
  const sourceUrl = rawSourceUrl || null;

  return {
    verifiedAt: toIsoString(input.verifiedAt),
    fetchedAt: toIsoString(input.fetchedAt),
    sourceUrl,
    sourceHost: extractSourceHost(sourceUrl),
  };
}
