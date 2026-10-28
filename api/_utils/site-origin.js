const PRODUCTION_ORIGIN = 'https://www.accesdirectaide.fr';

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeHeaderValue(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value) && typeof value[0] === 'string') {
    const first = value[0].trim();
    return first || null;
  }
  return null;
}

/**
 * @param {import('./http-types').ApiRequest} req
 * @param {string} name
 * @returns {string | null}
 */
function getHeader(req, name) {
  if (!req?.headers) return null;
  return normalizeHeaderValue(req.headers[name.toLowerCase()] ?? req.headers[name]);
}

/**
 * @param {string | null} protoHeader
 * @returns {'http' | 'https'}
 */
function resolveProtocol(protoHeader) {
  const protoRaw = String(protoHeader || '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  return protoRaw === 'http' ? 'http' : 'https';
}

/**
 * @param {string | null} hostHeader
 * @returns {string}
 */
function resolveHost(hostHeader) {
  const hostRaw = String(hostHeader || '')
    .split(',')[0]
    ?.trim();
  if (!hostRaw) return 'www.accesdirectaide.fr';
  return hostRaw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Canonical origin source of truth:
 * - production: force public canonical origin
 * - preview/dev: derive from forwarded host/proto
 *
 * @param {import('./http-types').ApiRequest} req
 * @returns {string}
 */
export function getCanonicalOrigin(req) {
  if (process.env.VERCEL_ENV === 'production') {
    return PRODUCTION_ORIGIN;
  }

  const proto = resolveProtocol(getHeader(req, 'x-forwarded-proto'));
  const host = resolveHost(getHeader(req, 'x-forwarded-host') || getHeader(req, 'host'));

  return `${proto}://${host}`;
}

