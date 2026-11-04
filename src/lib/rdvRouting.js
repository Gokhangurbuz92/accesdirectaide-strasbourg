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

const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
/**
 * R43 — the account journey `/rdv/<slug>/booking` that replaces the legacy slot screen `/rdv/<slug>/creneaux` (and its landing / services steps).
 * Always a same-origin path built from a validated slug (anything else → the directory `/structures`): never a URL, a host, `//` or a backslash, so it
 * cannot be an open redirect. Kept context: serviceId (validated id), mode (IN_PERSON | VIDEO), a safe `next`, the journey's aide / origin. An `appointment`
 * of the legacy screen opens « Mes rendez-vous » (where the person's appointments are managed). The booking page's own login gate still applies.
 * @param {string | null | undefined} slug @param {string | null | undefined} search
 * @returns {string}
 */
export function legacyCreneauxBookingPath(slug, search) {
  const safeSlug = String(slug || '').trim();
  if (!SAFE_SLUG.test(safeSlug)) return '/structures';
  const query = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (String(query.get('appointment') || '').trim()) return '/compte/rendez-vous';
  const out = new URLSearchParams();
  const serviceId = String(query.get('serviceId') || '').trim();
  if (SAFE_ID.test(serviceId)) out.set('serviceId', serviceId);
  const mode = String(query.get('mode') || '').trim().toUpperCase();
  if (mode === 'IN_PERSON' || mode === 'VIDEO') out.set('mode', mode);
  const next = normalizeNextPath(query.get('next') || '', '');
  if (next) out.set('next', next);
  const aide = String(query.get('aide') || '').trim();
  if (/^[a-z0-9-]{1,160}$/.test(aide)) out.set('aide', aide);
  const origin = String(query.get('origin') || '').trim().toLowerCase();
  if (/^[a-z0-9_-]{1,32}$/.test(origin)) out.set('origin', origin);
  const suffix = out.toString();
  return `/rdv/${encodeURIComponent(safeSlug)}/booking${suffix ? `?${suffix}` : ''}`;
}
