/**
 * Restricted public beta (owner directive 29/10/2026), browser side. The server enforces the restriction (api/_utils/public-beta.js);
 * this only explains it: the screens below would need an account, a booking, a document or a form, so they show a French notice instead.
 */
const RESTRICTED = ['/admin', '/pro', '/login', '/auth', '/compte', '/appointments', '/rdv', '/share', '/passport', '/institution', '/r',
  '/contact', '/demande-aide', '/proposer-une-structure', '/orientation', '/diagnostic', '/assistant', '/mon-assistant',
  '/adminaides', '/adminstructures', '/adminappointments', '/admindemarches', '/sentry-test', '/__sentry_test'];

/** @param {string} pathname */
export function isBetaRestrictedPath(pathname) {
  const p = String(pathname || '/').toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return RESTRICTED.some((x) => p === x || p.startsWith(`${x}/`));
}

/**
 * The links a beta visitor can follow: a link to a closed screen (assistant, simulator, contact…) is not offered at all, rather than leading to the notice.
 * @template T @param {T[]} links @param {boolean} beta @param {(link: T) => string} pathOf
 */
export function openLinks(links, beta, pathOf) {
  return beta ? links.filter((l) => !isBetaRestrictedPath(pathOf(l))) : links;
}
