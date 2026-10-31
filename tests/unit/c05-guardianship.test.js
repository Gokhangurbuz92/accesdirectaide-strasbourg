/**
 * C05 (R30) — the minor ↔ legal guardian link, on synthetic accounts. Nothing decides how a guardianship is proven: by default no strong method
 * is allowed, so no link can reach VERIFIED_STRONG and the minor's sensitive account features stay off; public information never depends on it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  transition, loadGuardianPolicy, declareGuardian, listGuardianships, confirmAsGuardian, requestStrongVerification, revokeGuardianship,
  recordStrongVerification, NEUTRAL_DECLARE, MAX_ACTIVE_GUARDIANS,
} from '../../api/_services/guardianship.js';
import { evaluateAge } from '../../api/lib/agePolicy.js';

const CONFIGURED = { strongMethods: ['PROFESSIONAL_ATTESTATION'], scopes: ['household', 'shares'], configured: true };
const PENDING = loadGuardianPolicy({});

/** synthetic accounts in memory (no real person) */
function memoryStore(policy = PENDING) {
  const users = { minor: { email: 'camille.minor@example.test', band: 'moins-de-18', verified: true, name: 'Camille' },
    parent: { email: 'parent.one@example.test', band: '25-59', verified: true, name: 'Parent Un' },
    parent2: { email: 'parent.two@example.test', band: '25-59', verified: false, name: null },
    parent3: { email: 'parent.three@example.test', band: '25-59', verified: true, name: null },
    teen: { email: 'teen.other@example.test', band: 'moins-de-18', verified: true, name: null },
    nob: { email: 'no.band@example.test', band: null, verified: true, name: null } };
  const rel = []; const audits = []; let n = 0;
  return { rel, audits,
    policy: () => policy,
    ageBandOf: async (id) => users[id]?.band ?? null,
    findUserByEmail: async (e) => { const k = Object.keys(users).find((u) => users[u].email === e); return k ? { id: k } : null; },
    emailVerified: async (id) => Boolean(users[id]?.verified),
    displayNames: async (ids) => Object.fromEntries(ids.map((i) => [i, users[i]?.name || null])),
    relationshipsOf: async (id) => rel.filter((r) => r.minorId === id || r.guardianId === id),
    relationship: async (id) => rel.find((r) => r.id === id) || null,
    insertRelationship: async (row) => { const r = { id: `g${(n += 1)}`, createdAt: new Date('2026-10-31T10:00:00Z'), ...row }; rel.push(r); return [r]; },
    updateRelationship: async (id, patch) => { Object.assign(rel.find((r) => r.id === id), patch); },
    audit: async (minorId, purpose, decision) => { audits.push({ minorId, purpose, decision }); },
  };
}

describe('C05 guardian state machine', () => {
  it('follows declared → confirmed → strong check → verified, and anything can be revoked', () => {
    expect(transition('DECLARED', 'CONFIRM', { policy: PENDING })).toEqual({ ok: true, next: 'EMAIL_VERIFIED' });
    expect(transition('EMAIL_VERIFIED', 'REQUIRE_STRONG', { policy: CONFIGURED })).toEqual({ ok: true, next: 'STRONGER_VERIFICATION_REQUIRED' });
    expect(transition('STRONGER_VERIFICATION_REQUIRED', 'STRONG_PASSED', { policy: CONFIGURED, method: 'PROFESSIONAL_ATTESTATION' })).toEqual({ ok: true, next: 'VERIFIED_STRONG' });
    for (const s of ['DECLARED', 'EMAIL_VERIFIED', 'STRONGER_VERIFICATION_REQUIRED', 'VERIFIED_STRONG']) expect(transition(s, 'REVOKE', { policy: PENDING }).next).toBe('REVOKED');
    expect(transition('REVOKED', 'CONFIRM', { policy: PENDING })).toEqual({ ok: false, code: 'ALREADY_REVOKED' });
  });
  it('without a configured policy no link can be verified; a method the policy does not name is refused; no step can be skipped', () => {
    expect(PENDING).toMatchObject({ configured: false, strongMethods: [] });
    expect(transition('EMAIL_VERIFIED', 'REQUIRE_STRONG', { policy: PENDING })).toEqual({ ok: false, code: 'POLICY_PENDING' });
    expect(transition('STRONGER_VERIFICATION_REQUIRED', 'STRONG_PASSED', { policy: PENDING, method: 'PROFESSIONAL_ATTESTATION' }).code).toBe('POLICY_PENDING');
    expect(transition('STRONGER_VERIFICATION_REQUIRED', 'STRONG_PASSED', { policy: CONFIGURED, method: 'IDENTITY_DOCUMENT_CHECK' }).code).toBe('METHOD_NOT_ALLOWED');
    expect(transition('DECLARED', 'STRONG_PASSED', { policy: CONFIGURED, method: 'PROFESSIONAL_ATTESTATION' }).code).toBe('INVALID_STATE');
  });
  it('the policy is read only from a CONFIGURED age policy, and unknown methods are dropped', () => {
    const env = { ADA_AGE_POLICY_JSON: JSON.stringify({ status: 'CONFIGURED', version: 'dpo-1', guardianVerification: { strongMethods: ['PROFESSIONAL_ATTESTATION', 'SELFIE'], scopes: ['household'] } }) };
    expect(loadGuardianPolicy(env)).toEqual({ configured: true, strongMethods: ['PROFESSIONAL_ATTESTATION'], scopes: ['household'] });
    expect(loadGuardianPolicy({ ADA_AGE_POLICY_JSON: JSON.stringify({ status: 'DRAFT', guardianVerification: { strongMethods: ['PROFESSIONAL_ATTESTATION'] } }) }).configured).toBe(false);
    expect(loadGuardianPolicy({ ADA_AGE_POLICY_JSON: '{broken' }).configured).toBe(false);
  });
});

describe('C05 guardian link on synthetic accounts', () => {
  it('declaring answers the same whatever the address (no account enumeration), and links only an adult account', async () => {
    const s = memoryStore();
    for (const e of ['parent.one@example.test', 'nobody@example.test', 'teen.other@example.test', 'no.band@example.test', 'camille.minor@example.test']) {
      expect(await declareGuardian('minor', { guardianEmail: e }, s)).toEqual({ ok: true, status: 202, message: NEUTRAL_DECLARE });
    }
    expect(s.rel.map((r) => r.guardianId)).toEqual(['parent']);
    expect(s.audits).toEqual([{ minorId: 'minor', purpose: 'GUARDIAN_LINK_DECLARED', decision: true }]);
    expect((await declareGuardian('parent', { guardianEmail: 'parent.two@example.test' }, s)).code).toBe('NOT_A_MINOR');
    expect((await declareGuardian('minor', { guardianEmail: 'pas-une-adresse' }, s)).code).toBe('INVALID_EMAIL');
  });
  it('at most two active guardians; a revoked link frees its place', async () => {
    const s = memoryStore();
    await declareGuardian('minor', { guardianEmail: 'parent.one@example.test' }, s);
    await declareGuardian('minor', { guardianEmail: 'parent.two@example.test' }, s);
    expect((await declareGuardian('minor', { guardianEmail: 'parent.three@example.test' }, s)).code).toBe('TOO_MANY_GUARDIANS');
    expect(MAX_ACTIVE_GUARDIANS).toBe(2);
    await revokeGuardianship('minor', 'g2', s);
    expect((await declareGuardian('minor', { guardianEmail: 'parent.three@example.test' }, s)).status).toBe(202);
  });
  it('only the named guardian confirms, with a verified e-mail; the minor sees the link and no e-mail of the other person', async () => {
    const s = memoryStore();
    await declareGuardian('minor', { guardianEmail: 'parent.one@example.test' }, s);
    expect((await confirmAsGuardian('minor', 'g1', s)).status).toBe(404);   // the minor cannot confirm for the guardian
    expect((await confirmAsGuardian('parent', 'g1', s)).guardianship).toEqual({ id: 'g1', status: 'EMAIL_VERIFIED' });
    const seen = await listGuardianships('minor', s);
    expect(seen.guardianships).toEqual([{ id: 'g1', role: 'minor', status: 'EMAIL_VERIFIED', scopes: [], other: 'Parent Un', createdAt: new Date('2026-10-31T10:00:00Z') }]);
    expect(JSON.stringify(seen)).not.toMatch(/@example\.test/);
    expect(seen.policy).toEqual({ strongVerification: 'POLICY_PENDING' });
    await declareGuardian('minor', { guardianEmail: 'parent.two@example.test' }, s);
    expect((await confirmAsGuardian('parent2', 'g2', s)).code).toBe('EMAIL_NOT_VERIFIED');
  });
  it('by default the strong check cannot even be asked: the age gate stays closed', async () => {
    const s = memoryStore();
    await declareGuardian('minor', { guardianEmail: 'parent.one@example.test' }, s);
    await confirmAsGuardian('parent', 'g1', s);
    expect((await requestStrongVerification('parent', 'g1', s)).code).toBe('POLICY_PENDING');
    expect((await recordStrongVerification({ verifierId: 'pro-1', isVerifier: true }, 'g1', { method: 'PROFESSIONAL_ATTESTATION' }, s)).code).toBe('INVALID_STATE');
    expect(evaluateAge('moins-de-18', { guardianVerified: false }).allowed).toBe(false);
  });
  it('with a DPO-configured policy: a verifier records an allowed method, the scopes apply, the gate opens; a revocation closes it again', async () => {
    const s = memoryStore(CONFIGURED);
    await declareGuardian('minor', { guardianEmail: 'parent.one@example.test' }, s);
    await confirmAsGuardian('parent', 'g1', s);
    expect((await requestStrongVerification('parent', 'g1', s)).guardianship.status).toBe('STRONGER_VERIFICATION_REQUIRED');
    expect((await recordStrongVerification({ verifierId: 'parent', isVerifier: false }, 'g1', { method: 'PROFESSIONAL_ATTESTATION' }, s)).status).toBe(403);
    expect((await recordStrongVerification({ verifierId: 'pro-1', isVerifier: true }, 'g1', { method: 'IDENTITY_DOCUMENT_CHECK' }, s)).code).toBe('METHOD_NOT_ALLOWED');
    expect((await recordStrongVerification({ verifierId: 'pro-1', isVerifier: true }, 'g1', { method: 'PROFESSIONAL_ATTESTATION' }, s)).guardianship.status).toBe('VERIFIED_STRONG');
    expect(s.rel[0].scopes).toEqual(['household', 'shares']);
    const policy = { status: 'CONFIGURED', version: 't', publicInformation: 'ALL_AGES', bands: { 'moins-de-18': { account: 'GUARDIAN_CONSENT_REQUIRED' }, '18-24': { account: 'ALLOWED' }, '25-59': { account: 'ALLOWED' }, '60-et-plus': { account: 'ALLOWED' } } };
    expect(evaluateAge('moins-de-18', { policy, guardianVerified: true }).allowed).toBe(true);
    expect((await revokeGuardianship('minor', 'g1', s)).guardianship.status).toBe('REVOKED');
    expect(s.rel[0].scopes).toEqual([]);
    expect(s.audits.map((a) => a.purpose)).toEqual(['GUARDIAN_LINK_DECLARED', 'GUARDIAN_LINK_EMAIL_VERIFIED', 'GUARDIAN_LINK_STRONGER_VERIFICATION_REQUIRED', 'GUARDIAN_LINK_VERIFIED_STRONG:PROFESSIONAL_ATTESTATION', 'GUARDIAN_LINK_REVOKED']);
    expect(s.audits.at(-1).decision).toBe(false);
  });
  it('the route exists for accounts only (closed in the public beta like every account route)', () => {
    expect(fs.readFileSync('api/routes.js', 'utf8')).toMatch(/path: 'citizen\/guardians'/);
    expect(fs.readFileSync('api/_utils/public-beta.js', 'utf8')).not.toMatch(/'citizen/);
  });
});
