/**
 * Restricted public beta (owner directive 29/10/2026), browser side. The server enforces the restriction (api/_utils/public-beta.js);
 * this only explains it: the screens below would need an account, a booking, a document or a form, so they show a French notice instead.
 */
const RESTRICTED = ['/admin', '/pro', '/login', '/auth', '/compte', '/appointments', '/rdv', '/share', '/passport', '/institution', '/r',
  '/contact', '/demande-aide', '/proposer-une-structure', '/orientation', '/diagnostic', '/assistant', '/mon-assistant',
  '/adminaides', '/adminstructures', '/adminappointments', '/admindemarches', '/sentry-test', '/__sentry_test'];

/** @param {string} pathname */
export function isBetaRestrictedPath(pathname) {
  const p = String(pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  return RESTRICTED.some((x) => p === x || p.startsWith(`${x}/`));
}
