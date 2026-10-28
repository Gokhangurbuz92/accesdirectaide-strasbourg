/**
 * @param {string} value
 * @returns {string}
 */
function toAscii(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalize free text into a stable slug.
 *
 * Rules:
 * - lowercase
 * - trim
 * - remove accents
 * - replace spaces/punctuation by single "-"
 * - collapse duplicate "-"
 * - trim leading/trailing "-"
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeSlug(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return '';

  const ascii = toAscii(text);
  return ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/**
 * @param {unknown} slug
 * @returns {boolean}
 */
export function isValidSlug(slug) {
  if (typeof slug !== 'string') return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

/**
 * Normalize a raw value and return null when invalid/empty.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function ensureSlugOrNull(raw) {
  const normalized = normalizeSlug(raw);
  if (!normalized) return null;
  return isValidSlug(normalized) ? normalized : null;
}
