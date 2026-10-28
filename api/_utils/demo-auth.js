// @ts-nocheck
/**
 * Demo Auth — RETIRED (owner LAB audit, 2026-10-24).
 *
 * This module used to return a « super_admin » or « pro » demo identity for any request carrying ?demo=admin / ?demo=pro when NODE_ENV was 'development' —
 * and the local LAB runs in 'development'. Nothing imported it, but an authentication bypass kept in the code base is one import away from being live.
 * The exports stay (same signatures) and can no longer produce an identity: there is no demo login; use a named LAB administrator
 * (scripts/lab-local.mjs admin-create) or the synthetic test fixtures.
 */

/**
 * @param {import('../_utils/http-types').ApiRequest} _req
 * @returns {null} never a demo identity
 */
export function getDemoUser(_req) {
  return null;
}

/**
 * @param {import('../_utils/http-types').ApiRequest} _req
 * @returns {false}
 */
export function isDemoRequest(_req) {
  return false;
}
