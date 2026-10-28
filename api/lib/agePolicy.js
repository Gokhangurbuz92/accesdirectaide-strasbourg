/**
 * PKG-1 / K0 — age-appropriate access as DATA, without inventing any legal threshold.
 *
 * Fixed product principle (owner directive 2026-10-18): public rights INFORMATION is open to every age; minors are never excluded from it. What a person of a given age band
 * may do with an ACCOUNT (share a dossier, subscribe to non-service messages, keep a household) depends on a policy that needs legal validation (DPO): the digital-consent age,
 * the guardian-consent mechanism and the safeguarding rules are NOT decided by this code. Until a policy is configured the band 'moins-de-18' is 'POLICY_PENDING':
 * public information stays available, sensitive account features stay off, and the person is told why. The policy is replaceable by configuration (ADA_AGE_POLICY_JSON)
 * without a code change. The band is SELF-DECLARED (no identity proofing is claimed).
 */
import { AGE_BAND_KEYS } from './ageBands.js';

export const ACCOUNT_RULES = Object.freeze(['ALLOWED', 'GUARDIAN_CONSENT_REQUIRED', 'BLOCKED', 'POLICY_PENDING']);

export const DEFAULT_AGE_POLICY = Object.freeze({
  status: 'REQUIRES_LEGAL_VALIDATION',
  version: 'default-0',
  publicInformation: 'ALL_AGES',
  bands: Object.freeze({
    'moins-de-18': Object.freeze({ account: 'POLICY_PENDING' }),
    '18-24': Object.freeze({ account: 'ALLOWED' }),
    '25-59': Object.freeze({ account: 'ALLOWED' }),
    '60-et-plus': Object.freeze({ account: 'ALLOWED' }),
  }),
});

/** @param {Record<string, string | undefined>} [env] */
export function loadAgePolicy(env = process.env) {
  const raw = env.ADA_AGE_POLICY_JSON;
  if (!raw) return DEFAULT_AGE_POLICY;
  try {
    const p = JSON.parse(raw);
    if (p && p.status === 'CONFIGURED' && typeof p.version === 'string' && p.bands && typeof p.bands === 'object'
      && AGE_BAND_KEYS.every((k) => p.bands[k] && ACCOUNT_RULES.includes(p.bands[k].account) && p.bands[k].account !== 'POLICY_PENDING')) {
      return Object.freeze({ status: 'CONFIGURED', version: p.version, publicInformation: 'ALL_AGES', bands: p.bands });
    }
  } catch {
    // fall through to the safe default
  }
  return DEFAULT_AGE_POLICY;
}

/**
 * @param {string | null | undefined} band declared age band (closed vocabulary) or nothing
 * @param {{ policy?: typeof DEFAULT_AGE_POLICY | ReturnType<typeof loadAgePolicy>, guardianVerified?: boolean }} [opts]
 * @returns {{ publicInformation: true, accountFeatures: 'ALLOWED' | 'GUARDIAN_CONSENT_REQUIRED' | 'BLOCKED' | 'POLICY_PENDING', allowed: boolean, policyStatus: string }}
 */
export function evaluateAge(band, opts = {}) {
  const policy = opts.policy ?? loadAgePolicy();
  const known = typeof band === 'string' && Object.prototype.hasOwnProperty.call(policy.bands, band);
  if (!known) return { publicInformation: true, accountFeatures: 'ALLOWED', allowed: true, policyStatus: policy.status };   // no declaration: nothing is inferred
  const rule = /** @type {Record<string, {account: string}>} */ (policy.bands)[/** @type {string} */ (band)].account;
  const accountFeatures = /** @type {'ALLOWED' | 'GUARDIAN_CONSENT_REQUIRED' | 'BLOCKED' | 'POLICY_PENDING'} */ (ACCOUNT_RULES.includes(rule) ? rule : 'POLICY_PENDING');
  const allowed = accountFeatures === 'ALLOWED' || (accountFeatures === 'GUARDIAN_CONSENT_REQUIRED' && opts.guardianVerified === true);
  return { publicInformation: true, accountFeatures, allowed, policyStatus: policy.status };
}
