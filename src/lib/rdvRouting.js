/**
 * @param {unknown} value
 * @param {string=} fallback
 */
export function normalizeNextPath(value, fallback = '/') {
  if (typeof value !== 'string') return fallback;

  const trimmed = value.trim();
  if (!trimmed) return fallback;

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }

  if (!decoded.startsWith('/')) return fallback;
  if (decoded.startsWith('//')) return fallback;
  if (decoded.includes('\\')) return fallback;
  if (Array.from(decoded).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  })) return fallback;

  return decoded;
}

/**
 * @param {string} path
 * @param {string | null | undefined} nextPath
 */
export function appendNext(path, nextPath) {
  const safeNext = normalizeNextPath(nextPath || '', '');
  if (!safeNext) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}next=${encodeURIComponent(safeNext)}`;
}

/**
 * Adds non-sensitive journey context to a local RDV path.
 * Unknown/empty context values are ignored.
 *
 * @param {string} path
 * @param {{
 *   nextPath?: string | null,
 *   aideSlug?: string | null,
 *   origin?: string | null,
 * }=} options
 */
export function appendRdvJourneyContext(path, options = {}) {
  let result = appendNext(path, options.nextPath);

  const aideSlug = String(options.aideSlug || '').trim();
  if (aideSlug) {
    const separator = result.includes('?') ? '&' : '?';
    result = `${result}${separator}aide=${encodeURIComponent(aideSlug)}`;
  }

  const origin = String(options.origin || '').trim().toLowerCase();
  if (/^[a-z0-9_-]{1,32}$/.test(origin)) {
    const separator = result.includes('?') ? '&' : '?';
    result = `${result}${separator}origin=${encodeURIComponent(origin)}`;
  }

  return result;
}

/**
 * @param {{ id?: string | null, slug?: string | null } | null | undefined} structure
 * @param {{
 *   nextPath?: string | null,
 *   aideSlug?: string | null,
 *   origin?: string | null,
 * }=} options
 */
export function buildPublicRdvPath(structure, options = {}) {
  const slug = String(structure?.slug || '').trim();
  if (slug) {
    return appendRdvJourneyContext(`/rdv/${encodeURIComponent(slug)}/booking`, options);
  }

  const id = String(structure?.id || '').trim();
  if (!id) return appendRdvJourneyContext('/annuaire', options);

  const encodedId = encodeURIComponent(id);
  return appendRdvJourneyContext(`/rdv/${encodedId}/booking?structureId=${encodedId}`, options);
}
