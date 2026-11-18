/**
 * FA-D8 — the exact list of features that may process health data (HDS, CSP L1111-8) and the proof that NONE of them can open for real users in a
 * production configuration without a valid HDS attestation — whatever else is opened (every surface, every capability listed, beta lifted) and whatever
 * encryption is in place (encryption is not an input of the gate: the ANS FAQ states that encrypting does not remove the certification obligation).
 * The list is pinned: adding or removing an HDS-bound capability must update this test and the HDS dossier (CONTROL/master/completion/fa_d8_dossiers/).
 */
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, capabilityState, ROUTE_CAPABILITIES } from '../../api/_utils/capabilities.js';
import { SURFACES } from '../../api/_utils/public-beta.js';

const HDS_BOUND = ['citizen.orientation_records', 'citizen.vault', 'citizen.shared_dossier', 'pro.case_management', 'pro.referrals', 'pro.siao_interop', 'partner.referral_adapter'];
const ALL = Object.keys(CAPABILITIES).join(',');
const everythingOpen = { ADA_BETA_OPEN_SURFACES: Object.keys(SURFACES).join(','), ADA_BETA_ACCOUNTS_SCOPE: 'full', ADA_CAPABILITIES_OPEN: ALL,
  ADA_DATA_ENCRYPTION: 'on', ADA_ENCRYPTION_KEY: '0'.repeat(64) };
const VALID = `HDS1:lab-synthetic:FA8-SYNTHETIC-NOT-A-CERT:2099-12-31:${'0'.repeat(64)}`;

describe('FA-D8 HDS-bound features stay closed in production', () => {
  it('the HDS-bound list is exactly the pinned one (requiresHds)', () => {
    expect(Object.entries(CAPABILITIES).filter(([, c]) => c.requiresHds).map(([n]) => n).sort()).toEqual([...HDS_BOUND].sort());
    expect(CAPABILITIES['pro.case_management'].hdsDependsOnStructure).toBe(true);
  });
  it('production and preview, beta on or off, everything listed and encrypted: closed without a valid, unexpired attestation', () => {
    for (const VERCEL_ENV of ['production', 'preview']) {
      for (const beta of [{ ADA_PUBLIC_BETA_RESTRICTED: '1' }, {}]) {
        for (const token of [undefined, '', 'HDS1:x', `HDS1:lab:CERT-1:2020-01-01:${'0'.repeat(64)}`, `HDS1:lab:CERT-1:2026-02-30:${'0'.repeat(64)}`]) {
          const env = { VERCEL_ENV, ...beta, ...everythingOpen, ...(token === undefined ? {} : { ADA_HDS_CERTIFIED_HOSTING: token }) };
          for (const name of HDS_BOUND) expect(capabilityState(name, env).open, `${VERCEL_ENV} ${JSON.stringify(beta)} ${token} ${name}`).toBe(false);
        }
      }
    }
  });
  it('an unknown structure category never waives HDS for case notes; only a reviewed NOT_ESSMS classification does', () => {
    const env = { VERCEL_ENV: 'production', ...everythingOpen };
    for (const structureCategory of [undefined, 'UNKNOWN', 'ESSMS', 'HEALTH']) expect(capabilityState('pro.case_management', env, { structureCategory }).reason).toBe('HDS_HOSTING_NOT_ATTESTED');
    expect(capabilityState('pro.case_management', env, { structureCategory: 'NOT_ESSMS' }).open).toBe(true);
  });
  it('the gate is the attestation, not the code path: with a (synthetic) valid token they open — so the token is the only lock to guard', () => {
    const env = { VERCEL_ENV: 'production', ...everythingOpen, ADA_HDS_CERTIFIED_HOSTING: VALID };
    for (const name of HDS_BOUND) expect(capabilityState(name, env).open, name).toBe(true);
  });
  it('every HDS-bound capability guards at least one route (no unguarded health-data route)', () => {
    const guarded = new Set(Object.values(ROUTE_CAPABILITIES).flat());
    for (const name of HDS_BOUND) expect(guarded.has(name), name).toBe(true);
  });
});
