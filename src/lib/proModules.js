// @ts-check
/**
 * G3 (19/11/2026) — the professional console follows what the server serves. GET /api/pro/me carries `modules` (api/_utils/pro-modules.js: one boolean per
 * module, from the surface and capability gates). A module the server does not serve is shown « pas encore ouvert » — never as an outage — and its screens
 * are not loaded. When the answer has no `modules` (an older server), every module counts as open: the server still refuses what is closed.
 */

/** console screen prefix → module (the longest matching prefix wins; « /pro/dossier » is not « /pro/dossiers ») */
export const PRO_SCREEN_MODULES = Object.freeze({
  '/pro/dossiers': 'cases',
  '/pro/orientations': 'referrals',
  '/pro/selections': 'selections',
  '/pro/dossier': 'dossiers',
  '/pro/attestation': 'dossiers',
  '/pro/rdv': 'agenda',
  '/pro/appointments': 'agenda',
  '/pro/messages': 'messages',
  '/pro/visio': 'video',
  '/pro/team': 'team',
  '/pro/structure': 'structure',
  '/pro/reports': 'reports',
  '/pro/regional': 'regional',
  '/pro/audit': 'audit',
  '/pro/offres-emploi': 'employment',   // X05 (expansion)
  '/pro/accompagnement': 'assist',   // G14-AID: mode accompagnant (helper code)
});
const PREFIXES = Object.keys(PRO_SCREEN_MODULES).sort((a, b) => b.length - a.length);

/** @param {string} pathname @returns {string | null} */
export function moduleOfScreen(pathname) {
  const p = String(pathname || '').toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '');
  const key = PREFIXES.find((x) => p === x || p.startsWith(`${x}/`));
  return key ? PRO_SCREEN_MODULES[/** @type {keyof typeof PRO_SCREEN_MODULES} */ (key)] : null;
}

/** @param {Record<string, boolean> | null | undefined} modules from /api/pro/me @param {string | null} name */
export function moduleOpen(modules, name) {
  if (!name || !modules || typeof modules !== 'object') return true;
  return modules[name] !== false;
}

/** a refusal of a closed function (surface or capability gate), as opposed to an outage @param {any} err an ApiError (status, payload) or a response body */
export function isNotOpenRefusal(err) {
  const code = err?.payload?.code || err?.payload?.error || err?.code || err?.error;
  return err?.status === 503 && ['CAPABILITY_NOT_OPEN', 'PUBLIC_BETA_RESTRICTED'].includes(String(code || ''));
}
