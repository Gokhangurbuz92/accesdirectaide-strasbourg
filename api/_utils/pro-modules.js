/**
 * G3 (19/11/2026, SD Track 2/3 gap A(a)) — which modules of the professional console this deployment serves, for the console's own screens.
 *
 * Opening `pro` alone (pro.account + pro.structure_admin, inside the AIPD, no HDS) leaves case management, referrals, the shared dossier, the agenda and
 * messaging closed by their surface or capability gate. The console used to show them anyway and to say « File de travail indisponible » (an outage) on
 * the 503. GET /api/pro/me (already read by every console page) now carries `modules`: one boolean per module, computed by the SAME two gates the router
 * applies to the module's main route — the restricted-beta surface gate (api/_utils/public-beta.js) and the capability gate (api/_utils/capabilities.js).
 * No personal data, no extra request, never a secret or an environment value: only « open » / « not open ». The server stays the only real protection.
 */
import { isAllowedInPublicBeta, isPublicBetaRestricted } from './public-beta.js';
import { closedCapabilityOfRoute } from './capabilities.js';

/** module → the route whose gates decide it (the route the module's screen reads first) */
export const PRO_MODULE_ROUTES = Object.freeze({
  cases: 'pro/cases',
  referrals: 'pro/referrals',
  selections: 'pro/selections',
  dossiers: 'pro/dossier',
  agenda: 'pro/appointments',
  outlook: 'pro/outlook',
  video: 'pro/appointments/visio',
  messages: 'pro/messages',
  team: 'pro/team',
  structure: 'pro/structure',
  reports: 'pro/reports',
  regional: 'pro/regional-stats',
  audit: 'pro/audit',
  // X05 (expansion): the employer's job listings — closed unless the « employment » surface AND « community.employment » are open
  employment: 'pro/employment',
});

/** is this route served here (both gates, as api/index.js and api/routes.js apply them to a GET) @param {string} path @param {Record<string, string | undefined>} [envVars] */
export function proRouteServed(path, envVars = process.env) {
  if (isPublicBetaRestricted(envVars) && !isAllowedInPublicBeta('GET', path, envVars)) return false;
  return closedCapabilityOfRoute(path, envVars) === null;
}

/** @param {Record<string, string | undefined>} [envVars] @returns {Record<string, boolean>} */
export function proModuleStates(envVars = process.env) {
  return Object.fromEntries(Object.entries(PRO_MODULE_ROUTES).map(([name, path]) => [name, proRouteServed(path, envVars)]));
}
