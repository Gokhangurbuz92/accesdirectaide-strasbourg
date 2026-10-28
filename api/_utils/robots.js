const NOINDEX_VALUE = 'noindex, nofollow';

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
