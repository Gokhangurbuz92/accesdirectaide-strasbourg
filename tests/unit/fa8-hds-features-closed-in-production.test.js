/**
 * FA-D8 — the exact list of features that may process health data (HDS, CSP L1111-8) and the proof that NONE of them can open for real users in a
 * production configuration without a valid HDS attestation — whatever else is opened (every surface, every capability listed, beta lifted) and whatever
 * encryption is in place (encryption is not an input of the gate: the ANS FAQ states that encrypting does not remove the certification obligation).
 * The list is pinned: adding or removing an HDS-bound capability must update this test and the HDS dossier (CONTROL/master/completion/fa_d8_dossiers/).
 */
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, capabilityState, ROUTE_CAPABILITIES } from '../../api/_utils/capabilities.js';
import { SURFACES } from '../../api/_utils/public-beta.js';
import { HDS_PAYLOAD_CAPABILITIES, HDS_SERVICE_CAPABILITIES } from '../../api/_utils/hds-gateway.js';
import { generateTicketKeyPair } from '../../api/lib/hds-ticket.js';

const HDS_BOUND = ['citizen.orientation_records', 'citizen.vault', 'citizen.shared_dossier', 'pro.case_management', 'pro.referrals', 'pro.siao_interop', 'partner.referral_adapter',
  'messaging.conversations', 'messaging.attachments'];   // R3: conversations HDS unless NOT_ESSMS + ordinary service; attachments always
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
    // G14-R3 / R4: the capabilities served by the HDS service, or whose payload lives there, need MORE than the token (the approved, allow-listed gateway; a ported module)
    const gated = [...HDS_SERVICE_CAPABILITIES, ...HDS_PAYLOAD_CAPABILITIES];
    // G14-R4: messaging.conversations is stored in Neon — the token never opens it (hdsWaiverOnly: only NOT_ESSMS + ordinary, P29)
    for (const name of HDS_BOUND.filter((n) => !gated.includes(n) && n !== 'messaging.conversations')) expect(capabilityState(name, env).open, name).toBe(true);
    expect(capabilityState('messaging.conversations', env)).toEqual({ open: false, reason: 'STORED_OUTSIDE_HDS' });
    expect(capabilityState('messaging.conversations', env, { structureCategory: 'NOT_ESSMS' }).open).toBe(true);
    for (const name of gated) expect(capabilityState(name, env).open, name).toBe(false);
  });
  it('G14-R3 / R4: the vault, shared dossiers, attachments and the referral payload open only with the gateway, a token of the SAME certified provider, and ported modules', () => {
    const gateway = { HDS_SERVICE_URL: 'https://ada-hds-strasbourg.osc-fr1.scalingo.io', HDS_PRODUCTION_APPROVED: 'true', HDS_TICKET_KID: 'k1', HDS_TICKET_PRIVATE_KEY: generateTicketKeyPair().privateKeyB64 };
    const env = { VERCEL_ENV: 'production', ...everythingOpen, ...gateway, ADA_HDS_CERTIFIED_HOSTING: VALID.replace('lab-synthetic', 'scalingo') };
    expect(capabilityState('citizen.vault', env).open).toBe(true);
    for (const name of ['citizen.shared_dossier', 'messaging.attachments', 'pro.referrals', 'partner.referral_adapter', 'citizen.orientation_records']) expect(capabilityState(name, env).open, name).toBe(true);
    for (const name of ['citizen.shared_dossier', 'pro.referrals', 'partner.referral_adapter']) expect(capabilityState(name, { ...env, HDS_PRODUCTION_APPROVED: '' }).reason, name).toBe('HDS_PRODUCTION_NOT_APPROVED');
    expect(capabilityState('citizen.vault', { ...env, ADA_HDS_CERTIFIED_HOSTING: VALID }).reason).toBe('HDS_ATTESTATION_PROVIDER_MISMATCH');
    for (const [k, reason] of [['HDS_PRODUCTION_APPROVED', 'HDS_PRODUCTION_NOT_APPROVED'], ['HDS_SERVICE_URL', 'HDS_SERVICE_URL_ABSENT'], ['HDS_TICKET_PRIVATE_KEY', 'HDS_TICKET_KEY_INVALID'], ['HDS_TICKET_KID', 'HDS_TICKET_KID_INVALID']]) {
      expect(capabilityState('citizen.vault', { ...env, [k]: '' }).reason, k).toBe(reason);
    }
    expect(capabilityState('citizen.vault', { ...env, HDS_SERVICE_URL: 'https://hds.example.com' }).reason).toBe('HDS_HOST_NOT_ON_CERTIFIED_ALLOWLIST');
    expect(capabilityState('citizen.vault', { ...env, HDS_SERVICE_URL: 'http://ada-hds-strasbourg.osc-fr1.scalingo.io' }).reason).toBe('HDS_SERVICE_URL_NOT_HTTPS');
  });
  it('every HDS-bound capability guards at least one route (no unguarded health-data route)', () => {
    const guarded = new Set(Object.values(ROUTE_CAPABILITIES).flat());
    for (const name of HDS_BOUND) expect(guarded.has(name), name).toBe(true);
  });
});
