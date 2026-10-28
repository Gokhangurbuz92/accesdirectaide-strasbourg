/**
 * Restricted public beta (owner directive 29/10/2026): with ADA_PUBLIC_BETA_RESTRICTED=1 the API serves ONLY the public, read-only information routes.
 * Accounts (citizen, professional, institution, administration), appointments, case files, uploads, sharing, messaging, contact forms, the assistant and
 * every cron are refused server-side, so no personal data can be collected while the legal, hosting and operational acceptance is pending.
 * This is an allowlist: a route that is not listed here is refused.
 */

const EXACT = new Set([
  'health', 'health/live', 'health/ready', 'healthz', 'status',
  'robots.txt', 'robots', 'sitemap.xml', 'sitemap',
  'public/page', 'taxonomy', 'search', 'glossaire',
  // read by the shell on every page: answers « not signed in » and creates nothing
  'auth/me',
]);
const PREFIX = ['aides', 'aids', 'structures', 'demarches', 'actualites', 'guides', 'tools', 'dispositifs', 'ressources'];
const READ_METHODS = new Set(['GET', 'HEAD']);

export const PUBLIC_BETA_MESSAGE =
  'Bêta publique : cette fonction n’est pas encore ouverte. Pendant la bêta, Accès Direct Aide permet seulement de consulter les aides, les démarches '
  + 'et les structures vérifiées ; aucun compte, rendez-vous ni document ne peut être créé.';

/** @param {Record<string, string | undefined>} [envVars] */
export function isPublicBetaRestricted(envVars = process.env) {
  return ['1', 'true'].includes(String(envVars.ADA_PUBLIC_BETA_RESTRICTED || '').trim().toLowerCase());
}

/**
 * @param {string} method
 * @param {string} path normalized API path without the « /api/ » prefix and without leading or trailing slashes
 */
export function isAllowedInPublicBeta(method, path) {
  if (!READ_METHODS.has(String(method || '').toUpperCase())) return false;
  const p = String(path || '');
  if (EXACT.has(p)) return true;
  return PREFIX.some((x) => p === x || p.startsWith(`${x}/`));
}
