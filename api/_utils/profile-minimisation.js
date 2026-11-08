/**
 * Release B (owner directions 08/11/2026, D2 V2 minimisation): in the NARROW citizen-account scope (V2) the optional profile fields « ageBand » and
 * « departement » are neither collected nor stored — the required adult declaration stays the only age element, and geographic searches stay
 * user-chosen and non-persistent. Fail-closed, like the phone (api/_utils/phone-collection.js):
 *   - Production, Preview and the restricted beta: CLOSED unless the full accounts scope is opened (ADA_BETA_ACCOUNTS_SCOPE=full, a later decision);
 *   - development / test without the beta (the LAB runs the full product): open.
 * Closed means: a value sent to PUT /api/citizen/profile is not stored (null — erasing a value stored earlier — stays possible), GET returns the
 * collection state so the screen does not offer the fields. Nothing else of the profile changes.
 */
import { accountsScope, isPublicBetaRestricted } from './public-beta.js';

export const MINIMISED_PROFILE_FIELDS = Object.freeze(['ageBand', 'departement']);

/** @param {Record<string, string | undefined>} [env] */
export function optionalProfileFieldsOpen(env = process.env) {
  const vercel = String(env.VERCEL_ENV ?? '').trim().toLowerCase();
  const enforced = vercel === 'production' || vercel === 'preview' || isPublicBetaRestricted(env);
  if (!enforced) return true;
  return accountsScope(env) === 'full';
}
