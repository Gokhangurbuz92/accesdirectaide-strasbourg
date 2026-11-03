/**
 * R40 security — the router (api/index.js) resolves the request path with the WHATWG URL parser, which removes dot segments written literally or
 * percent-encoded. A security decision taken on the RAW path (second-factor routes, double-submit exemptions) could therefore disagree with the route
 * actually served. Session helpers refuse such a request instead: an ordinary client never sends a dot segment or a backslash in an API path.
 */

/**
 * true when the path part of a request URL holds a dot segment (any percent-encoding) or a backslash — i.e. the router would serve another path.
 * @param {unknown} url raw request URL (path and optional query)
 * @returns {boolean}
 */
export function isNonCanonicalPath(url) {
  const raw = String(url ?? '').split(/[?#]/)[0];
  if (/[\\\t\r\n]/.test(raw)) return true;
  return raw.split('/').some((segment) => {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { return /%2e/i.test(segment); }
    return decoded === '.' || decoded === '..' || decoded.includes('\\');
  });
}

/**
 * the path the router serves for a request URL (dot segments resolved), without the query.
 * @param {unknown} url
 * @returns {string}
 */
export function resolvedPathname(url) {
  try { return new URL(String(url ?? ''), 'http://localhost').pathname; } catch { return ''; }
}
