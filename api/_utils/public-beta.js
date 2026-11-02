/**
 * Restricted public beta (owner directive 29/10/2026): with ADA_PUBLIC_BETA_RESTRICTED=1 the API serves ONLY the public, read-only information routes.
 * Accounts (citizen, professional, institution, administration), appointments, case files, uploads, sharing, messaging, contact forms, the assistant and
 * every cron are refused server-side, so no personal data can be collected while the legal, hosting and operational acceptance is pending.
 * This is an allowlist: a route that is not listed here is refused.
 */

const EXACT = new Set([
  'health', 'health/live', 'health/ready', 'healthz', 'status',
  'robots.txt', 'robots', 'sitemap.xml', 'sitemap',
  'public/page', 'taxonomy', 'search', 'search-pro', 'glossaire',
  // read by the shell on every page: answers « not signed in » and creates nothing
  'auth/me',
]);
// R32: « translations » serves the checked translations of the same public records (read-only, same D-5 rule)
const PREFIX = ['aides', 'aids', 'structures', 'demarches', 'actualites', 'guides', 'tools', 'dispositifs', 'ressources', 'translations'];
const READ_METHODS = new Set(['GET', 'HEAD']);
// the two citizen searches take their query in a POST body; they read and write nothing (no account, no history)
const READ_ONLY_POST = new Set(['search', 'search-pro']);

export const PUBLIC_BETA_MESSAGE =
  'Bêta publique : cette fonction n’est pas encore ouverte. Pendant la bêta, Accès Direct Aide permet seulement de consulter les aides, les démarches '
  + 'et les structures vérifiées ; aucun compte, rendez-vous ni document ne peut être créé.';

/** @param {Record<string, string | undefined>} [envVars] */
export function isPublicBetaRestricted(envVars = process.env) {
  return ['1', 'true'].includes(String(envVars.ADA_PUBLIC_BETA_RESTRICTED || '').trim().toLowerCase());
}

/**
 * R35 (owner decision 02/11/2026, « connect and activate what is built, one capability at a time »): ADA_BETA_OPEN_SURFACES opens named surfaces while
 * the beta stays on for everything else, e.g. ADA_BETA_OPEN_SURFACES=appointments,communications. Fail-closed: unset = nothing opened, an unknown name
 * opens nothing, there is no wildcard (lifting the whole beta stays a separate, deliberate change of ADA_PUBLIC_BETA_RESTRICTED). An opened surface only
 * passes this gate: authentication, MFA, roles, organisation isolation, CSRF, consent and every per-feature approval (VIDEO_PRODUCTION_APPROVED,
 * GDPR_PURGE_ENABLED…) still apply to its routes. A route belongs to ONE surface (longest prefix wins); a route of no surface stays closed.
 */
export const SURFACES = {
  accounts: ['auth', 'citizen', 'login-pro-guard'],
  pro: ['pro'],
  institution: ['institution'],
  appointments: ['rdv', 'pro/slots', 'pro/availability', 'pro/timeoff', 'pro/rdv', 'pro/appointments', 'pro/outlook', 'auth/callback/outlook'],
  video: ['pro/appointments/visio'],
  communications: ['messages', 'secure-messages', 'contact', 'support', 'feedback', 'reports', 'public/suggest-structure', 'public/sms-notify', 'assistant/feedback', 'pro/messages', 'pro/notifications'],
  documents: ['citizen/coffre', 'citizen/dossier', 'pro/dossier', 'share', 'public/dossier-revoke', 'public/dossier-grants', 'public/passport', 'download', 'pdf'],
  diagnostic: ['diagnostic', 'drees', 'assistant', 'public/falc', 'public/assistant', 'tts'],
  admin: ['admin'],
  jobs: ['cron', 'monitor'],
};
const SURFACE_PREFIXES = Object.entries(SURFACES).flatMap(([name, list]) => list.map((prefix) => ({ name, prefix }))).sort((a, b) => b.prefix.length - a.prefix.length);

/** the surface a route belongs to, or null @param {string} path */
export function surfaceOf(path) {
  const p = String(path || '');
  return SURFACE_PREFIXES.find((x) => p === x.prefix || p.startsWith(`${x.prefix}/`))?.name || null;
}

/** the surfaces opened during the beta @param {Record<string, string | undefined>} [envVars] @returns {Set<string>} */
export function openSurfaces(envVars = process.env) {
  return new Set(String(envVars.ADA_BETA_OPEN_SURFACES || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => Object.prototype.hasOwnProperty.call(SURFACES, x)));
}

/**
 * @param {string} method
 * @param {string} path normalized API path without the « /api/ » prefix and without leading or trailing slashes
 * @param {Record<string, string | undefined>} [envVars]
 */
export function isAllowedInPublicBeta(method, path, envVars = process.env) {
  const p = String(path || '');
  if (String(method || '').toUpperCase() === 'POST' && READ_ONLY_POST.has(p)) return true;
  const surface = surfaceOf(p);
  if (surface && openSurfaces(envVars).has(surface)) return true;
  if (!READ_METHODS.has(String(method || '').toUpperCase())) return false;
  if (EXACT.has(p)) return true;
  return PREFIX.some((x) => p === x || p.startsWith(`${x}/`));
}
