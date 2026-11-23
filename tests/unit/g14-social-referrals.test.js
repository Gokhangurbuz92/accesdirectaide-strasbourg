// G14-PS — social referral (non-HDS): closed lists, no free text, structure classification (ESSMS / FINESS / health refused, unknown refused), the
// capability and surface gates (closed by default, separate from the HDS `pro.referrals`), the migration's CHECKs mirror the code lists.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  CITIZEN_POST_FIELDS, PRO_POST_FIELDS, SOCIAL_DECLINE_CODES, SOCIAL_REASONS, SOCIAL_REASON_CODES, assertReasonsNotSensitive, socialReferralRequestRefusal,
  socialReferralStructureClass,
} from '../../api/lib/social-referral-policy.js';
import { CAPABILITIES, capabilitiesOfRoute, capabilityState } from '../../api/_utils/capabilities.js';
import { surfaceOf, isAllowedInPublicBeta } from '../../api/_utils/public-beta.js';
import { hashCode, newClaimCode } from '../../api/_services/social-referrals.js';
import { isBetaRestrictedPath } from '../../src/lib/publicBeta.js';
import { RETENTION_POLICY, stepApprovalProblem } from '../../api/_services/retention-policy.js';

const ok = { statut: 'actif', verification_status: 'VERIFIED', numero_finess: null, type_finess: null };

describe('closed lists', () => {
  it('reasons exclude every sensitive group (same exclusions as the limited Mon Parcours)', () => {
    expect(SOCIAL_REASON_CODES).toEqual(['HOUSING', 'EMPLOYMENT', 'TRAINING', 'INCOME_BUDGET', 'ENERGY', 'ADMIN_PROCEDURES', 'ACCESS_TO_RIGHTS', 'MOBILITY', 'DIGITAL', 'FOOD']);
    for (const banned of ['HEALTH', 'DISABILITY', 'LEGAL', 'JUSTICE', 'RESIDENCE', 'VIOLENCE', 'CHILD_PROTECTION', 'GUARDIANSHIP', 'SPECIALISED_SUPPORT', 'EMERGENCY_HOUSING']) {
      expect(SOCIAL_REASON_CODES).not.toContain(banned);
    }
    expect(assertReasonsNotSensitive()).toBe(true);
    expect(() => assertReasonsNotSensitive({ X: 'Suivi en psychiatrie' })).toThrow(/sensitive/);
  });
  it('the migration CHECKs carry exactly the code lists', () => {
    const sql = fs.readFileSync('drizzle/0061_g14_ps_social_referrals.sql', 'utf8');
    expect(sql).toContain(`ARRAY[${SOCIAL_REASON_CODES.map((c) => `'${c}'`).join(', ')}]::text[]`);
    expect(sql).toContain(`IN (${SOCIAL_DECLINE_CODES.map((c) => `'${c}'`).join(', ')})`);
    expect(sql).not.toMatch(/"(message|note|text|comment|body|document|file)\w*"\s+text/i);
  });
  it('no action of either side accepts a free-text or file field', () => {
    for (const fields of [...Object.values(PRO_POST_FIELDS), ...Object.values(CITIZEN_POST_FIELDS)]) {
      for (const f of fields) expect(['action', 'id', 'toStructureId', 'reasonCodes', 'idempotencyKey', 'responseCode', 'email', 'password', 'decision', 'shareEmail', 'sharePhone', 'code']).toContain(f);
    }
  });
});

describe('request contract (before any database access)', () => {
  const post = (side, body) => socialReferralRequestRefusal(side, { method: 'POST', body });
  it('refuses free text, documents and unknown fields by NAME only', () => {
    const r = post('pro', { action: 'propose', toStructureId: 's2', reasonCodes: ['HOUSING'], message: 'Monsieur X est suivi en psychiatrie' });
    expect(r).toMatchObject({ status: 400, code: 'FIELD_NOT_ALLOWED' });
    expect(r.message).toContain('message'); expect(r.message).not.toContain('psychiatrie');
    expect(post('pro', { action: 'decline', id: 'r1', responseCode: 'NO_CAPACITY', note: 'x' })).toMatchObject({ code: 'FIELD_NOT_ALLOWED' });
    expect(post('pro', { action: 'propose', toStructureId: 's2', reasonCodes: ['HOUSING'], file: 'data:application/pdf;base64,AAA' })).toMatchObject({ code: 'FIELD_NOT_ALLOWED' });
    expect(post('citizen', { action: 'decide', id: 'r1', decision: 'accept', comment: 'x' })).toMatchObject({ code: 'FIELD_NOT_ALLOWED' });
  });
  it('reasons: 1 to 3 codes of the list, no duplicates', () => {
    expect(post('pro', { action: 'propose', toStructureId: 's2', reasonCodes: ['HOUSING', 'FOOD'] })).toBeNull();
    expect(post('pro', { action: 'propose', toStructureId: 's2', reasonCodes: [] })).toMatchObject({ code: 'INVALID_REASON' });
    expect(post('pro', { action: 'propose', toStructureId: 's2', reasonCodes: ['HEALTH'] })).toMatchObject({ code: 'INVALID_REASON' });
    expect(post('pro', { action: 'propose', toStructureId: 's2', reasonCodes: ['HOUSING', 'HOUSING'] })).toMatchObject({ code: 'INVALID_REASON' });
    expect(post('pro', { action: 'propose', toStructureId: 's2', reasonCodes: ['HOUSING', 'FOOD', 'DIGITAL', 'ENERGY'] })).toMatchObject({ code: 'INVALID_REASON' });
    expect(post('pro', { action: 'propose', toStructureId: 's2', reasonCodes: 'HOUSING' })).toMatchObject({ code: 'INVALID_REASON' });
  });
  it('decline motive from the closed list; decisions and code shapes', () => {
    expect(post('pro', { action: 'decline', id: 'r1', responseCode: 'OTHER' })).toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(post('pro', { action: 'decline', id: 'r1', responseCode: 'NO_CAPACITY' })).toBeNull();
    expect(post('citizen', { action: 'decide', id: 'r1', decision: 'maybe' })).toMatchObject({ code: 'INVALID_DECISION' });
    expect(post('citizen', { action: 'decide', id: 'r1', decision: 'accept', shareEmail: 'yes' })).toMatchObject({ code: 'INVALID_SHARE' });
    expect(post('citizen', { action: 'claim', code: 'abcde-fghjk' })).toBeNull();
    expect(post('citizen', { action: 'claim', code: 'AB' })).toMatchObject({ code: 'INVALID_CODE' });
    expect(socialReferralRequestRefusal('citizen', { method: 'GET', query: { q: 'x' } })).toMatchObject({ code: 'FIELD_NOT_ALLOWED' });
    expect(post('pro', { action: 'assisted_consent', id: 'r1', email: 'a@b.fr', decision: 'accept' })).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 403 });
  });
  it('the one-time code: 10 characters of the unambiguous alphabet, only its hash is stored, case / dash insensitive', () => {
    const c = newClaimCode();
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(hashCode(c)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode(c.toLowerCase().replace('-', ' '))).toBe(hashCode(c));
  });
});

describe('structure classification (only NOT_ESSMS may send or receive)', () => {
  it.each([
    ['CCAS', 'NOT_ESSMS'], ["CCAS (centre communal d'action sociale)", 'NOT_ESSMS'], ['Association', 'NOT_ESSMS'], ['Espace France Services', 'NOT_ESSMS'],
    ['Mission locale (jeunes de 16 à 25 ans)', 'NOT_ESSMS'], ['Bailleur social', 'NOT_ESSMS'], ['Centre Social', 'NOT_ESSMS'], ['Mairie', 'NOT_ESSMS'],
    ['Établissement d’hébergement pour personnes âgées dépendantes (EHPAD)', 'ESSMS_OR_HEALTH'], ['Service de soins infirmiers à domicile (SSIAD)', 'ESSMS_OR_HEALTH'],
    ['Centre de santé', 'ESSMS_OR_HEALTH'], ['MDPH', 'ESSMS_OR_HEALTH'], ['CPAM', 'ESSMS_OR_HEALTH'], ['Service mandataire judiciaire (MJPM)', 'ESSMS_OR_HEALTH'],
    ['Centre d’accueil de demandeurs d’asile (CADA)', 'ESSMS_OR_HEALTH'], ['PMI (protection maternelle et infantile)', 'ESSMS_OR_HEALTH'],
    ['Centre de soins, d’accompagnement et de prévention en addictologie (CSAPA)', 'ESSMS_OR_HEALTH'], ["Bureau d'aide aux victimes", 'ESSMS_OR_HEALTH'],
    ['Organisation', 'UNKNOWN'], [null, 'UNKNOWN'], ['Siège administratif', 'UNKNOWN'],
  ])('%s → %s', (kind, expected) => {
    expect(socialReferralStructureClass({ ...ok, type_structure: kind, nom: 'Structure test' }).category).toBe(expected);
  });
  it('a FINESS registration always refuses, whatever the kind', () => {
    expect(socialReferralStructureClass({ ...ok, type_structure: 'Association', numero_finess: '670000000' })).toEqual({ category: 'ESSMS_OR_HEALTH', reason: 'FINESS_REGISTERED' });
    expect(socialReferralStructureClass({ ...ok, type_structure: 'Association', type_finess: '354' }).category).toBe('ESSMS_OR_HEALTH');
  });
  it('a sensitive name refuses; unverified or inactive is ineligible', () => {
    expect(socialReferralStructureClass({ ...ok, type_structure: 'Association', nom: 'Association des malvoyants' }).category).toBe('ESSMS_OR_HEALTH');
    expect(socialReferralStructureClass({ ...ok, type_structure: 'CCAS', verification_status: 'UNVERIFIED' })).toEqual({ category: 'INELIGIBLE', reason: 'NOT_VERIFIED_ACTIVE' });
    expect(socialReferralStructureClass({ ...ok, type_structure: 'CCAS', statut: 'suspendu' }).category).toBe('INELIGIBLE');
    expect(socialReferralStructureClass(null).category).toBe('INELIGIBLE');
  });
});

describe('gates', () => {
  const beta = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
  it('a separate, non-HDS capability on its own surface; the HDS referral is unchanged', () => {
    expect(CAPABILITIES['pro.referrals_social']).toMatchObject({ aipd: 'out', requiresHds: false, surface: 'social_referrals' });
    expect(CAPABILITIES['pro.referrals']).toMatchObject({ requiresHds: true });
    expect(capabilitiesOfRoute('pro/social-referrals')).toEqual(['pro.referrals_social']);
    expect(capabilitiesOfRoute('citizen/social-referrals')).toEqual(['pro.referrals_social']);
    expect(capabilitiesOfRoute('pro/referrals')).toEqual(['pro.referrals']);
    expect(surfaceOf('pro/social-referrals')).toBe('social_referrals');
    expect(surfaceOf('citizen/social-referrals')).toBe('social_referrals');
  });
  it('closed by default; opening needs the surface AND the capability; no HDS token needed', () => {
    expect(capabilityState('pro.referrals_social', beta)).toMatchObject({ open: false, reason: 'SURFACE_CLOSED' });
    expect(capabilityState('pro.referrals_social', { ...beta, ADA_BETA_OPEN_SURFACES: 'social_referrals' })).toMatchObject({ open: false, reason: 'NOT_LISTED_IN_ADA_CAPABILITIES_OPEN' });
    expect(capabilityState('pro.referrals_social', { ...beta, ADA_BETA_OPEN_SURFACES: 'social_referrals', ADA_CAPABILITIES_OPEN: 'pro.referrals_social' })).toEqual({ open: true, reason: null });
    expect(capabilityState('pro.referrals', { ...beta, ADA_BETA_OPEN_SURFACES: 'pro', ADA_CAPABILITIES_OPEN: 'pro.referrals' })).toMatchObject({ open: false, reason: 'HDS_HOSTING_NOT_ATTESTED' });
    expect(capabilityState('pro.referrals_social', { VERCEL_ENV: 'production' })).toMatchObject({ open: false });
    expect(isAllowedInPublicBeta('GET', 'pro/social-referrals', { ...beta, ADA_BETA_OPEN_SURFACES: 'pro,accounts' })).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'citizen/social-referrals', { ...beta, ADA_BETA_OPEN_SURFACES: 'accounts', ADA_BETA_ACCOUNTS_SCOPE: 'full' })).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'pro/social-referrals', { ...beta, ADA_BETA_OPEN_SURFACES: 'social_referrals' })).toBe(true);
  });
  it('the screens follow ONLY their surface', () => {
    expect(isBetaRestrictedPath('/compte/orientations-sociales', ['accounts'], { accountsScope: 'full', proSelfRegistration: false })).toBe(true);
    expect(isBetaRestrictedPath('/pro/orientations-sociales', ['pro'])).toBe(true);
    expect(isBetaRestrictedPath('/pro/orientations-sociales', ['pro', 'social_referrals'])).toBe(false);
    expect(isBetaRestrictedPath('/passeport-social', [])).toBe(false);   // browser-only: nothing to restrict server-side (VITE_PASSEPORT_SOCIAL gates the page)
  });
});

describe('retention proposal', () => {
  it('12 months after closure, recorded as decided but never executable while the duration awaits the owner', () => {
    expect(RETENTION_POLICY.durations.SOCIAL_REFERRAL_CLOSED_DAYS).toMatchObject({ days: 365, pendingApproval: expect.any(String) });
    expect(RETENTION_POLICY.decidedSteps.socialReferralsClosedDeleted).toMatchObject({ decidedOn: '2026-11-23' });
    expect(stepApprovalProblem(RETENTION_POLICY, { id: 'socialReferralsClosedDeleted', durationKey: 'SOCIAL_REFERRAL_CLOSED_DAYS' })).toBe('DURATION_PENDING_APPROVAL');
    expect(SOCIAL_REASONS.HOUSING).toMatch(/Logement/);
  });
});
