const NOINDEX_VALUE = 'noindex, nofollow';
const INDEXABLE = new Set(['public/page', 'sitemap.xml', 'sitemap', 'robots.txt', 'robots']);

/**
 * @param {import('./http-types').ApiResponse} res
 */
export function applyNoIndex(res) {
  res.setHeader('X-Robots-Tag', NOINDEX_VALUE);
}

/**
 * Paths are normalized by api/index.js without leading "/api/".
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isTechnicalNoIndexPath(path) {
  if (!path) return false;
  // the server-rendered record pages (/aides/<slug>… reach the API as public/page), the sitemap and robots are documents; every other answer is
  // JSON data a crawler may fetch to render a page (robots.txt allows the public read routes) but must never index as a page of its own
  if (!INDEXABLE.has(path)) return true;

  return (
    path === 'health' ||
    path === 'healthz' ||
    path === 'health/deep' ||
    path.startsWith('messages/') ||
    path.startsWith('cron/') ||
    path.startsWith('monitor/') ||
    path.startsWith('admin/')
  );
}
