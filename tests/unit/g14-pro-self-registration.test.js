/**
 * G14 (owner decision 23/11/2026: ADA Pro opens without a pilot structure) — the structure's own sign-up is a request checked by ADA before anything opens.
 * Unit level (no database: a database access fails the test): the refusals that happen before any lookup, the SIRET check, the rule deciding which
 * structure's members may receive an MFA enrolment invitation, and the statuses that never carry a session. The database paths (records, duplicates,
 * « Vérifier et activer », « Refuser ») are in tests/integration/g14-pro-self-registration-db.test.js.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mail = { calls: 0 };
vi.mock('../../api/_utils/mailer.js', async (importOriginal) => ({ ...(await importOriginal()), sendMail: vi.fn(async () => { mail.calls += 1; return { outcome: 'TEST_RECORDED' }; }) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })), getClientIp: () => '127.0.0.1' }));
// any database access is a failure here: the refusals below must come before it
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('database touched'); } }) }));

const { validSiret } = await import('../../api/_utils/siret.js');
const datainclusion = await import('../../api/_services/verification/datainclusion.js');
const { mfaInvitationAllowedFor } = await import('../../api/_services/pro-mfa-invitation.js');
const { PRO_SESSION_STATUSES, PRO_PENDING_VERIFICATION_STATUS } = await import('../../api/_utils/auth.js');
const reg = await import('../../api/_handlers/pro/auth/register.js');

const mk = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader() {} });
const VALID = { structureName: 'Association Synthétique', siret: '73282932000074', email: 'g14-unit@example.test', password: 'Synthetic-QA-pass-0001', termsAccepted: true };
const call = async (body) => { const r = mk(); await reg.default({ method: 'POST', url: '/api/pro/auth/register', headers: { host: 'localhost' }, body }, r); return r; };

afterEach(() => { vi.unstubAllEnvs(); mail.calls = 0; });

describe('SIRET check (shared with the verification chain)', () => {
  it('accepts 14 digits with a valid Luhn key (spaces ignored), La Poste by its own rule; refuses the rest', () => {
    expect(validSiret('73282932000074')).toBe('73282932000074');
    expect(validSiret('732 829 320 00074')).toBe('73282932000074');
    expect(validSiret('35600000000010')).toBe('35600000000010');   // La Poste: sum of the digits a multiple of 5
    for (const bad of ['73282932000075', '1234567890123', '123456789012345', '', null, 'abcdefghijklmn']) expect(validSiret(bad), String(bad)).toBeNull();
  });
  it('the data·inclusion importer uses the same function (moved, not copied)', () => {
    expect(datainclusion.validSiret).toBe(validSiret);
  });
});

describe('POST /api/pro/auth/register — refusals before any lookup', () => {
  it('Production with sign-up opened but no professional terms in force: 503 PRO_TERMS_NOT_IN_FORCE, nothing read or sent', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('ADA_PRO_SELF_REGISTRATION', 'open'); vi.stubEnv('VITE_LEGAL_DOCS_APPROVED_VERSION', '');
    const r = await call(VALID);
    expect(r.statusCode).toBe(503); expect(r.body.code).toBe('PRO_TERMS_NOT_IN_FORCE'); expect(mail.calls).toBe(0);
  });
  it('the terms must be accepted (only the boolean true counts)', async () => {
    for (const termsAccepted of [undefined, false, 'true', 1]) {
      const r = await call({ ...VALID, termsAccepted });
      expect(r.statusCode, String(termsAccepted)).toBe(400); expect(r.body.code).toBe('PRO_TERMS_ACCEPTANCE_REQUIRED');
    }
  });
  it('a SIRET is required and must be well formed', async () => {
    expect((await call({ ...VALID, siret: undefined })).statusCode).toBe(400);
    for (const siret of ['73282932000075', '7328293200007', 'SIRET73282932000074']) {
      const r = await call({ ...VALID, siret });
      expect(r.statusCode, siret).toBe(400); expect(r.body.code).toBe('SIRET_INVALID');
    }
  });
  it('the structure name is bounded (2–200 characters after spaces are collapsed)', async () => {
    for (const structureName of ['A', '   B   ', 'x'.repeat(reg.STRUCTURE_NAME_MAX + 1)]) {
      const r = await call({ ...VALID, structureName });
      expect(r.statusCode, structureName.length).toBe(400); expect(r.body.code).toBe('STRUCTURE_NAME_INVALID');
    }
    expect(reg.STRUCTURE_NAME_MIN).toBe(2); expect(reg.STRUCTURE_NAME_MAX).toBe(200);
  });
  it('the answer of an accepted request says « demande reçue » and carries no session', () => {
    expect(reg.PRO_REGISTRATION_RECEIVED.message).toMatch(/^Demande reçue — votre structure sera vérifiée sur une source officielle avant l’ouverture de votre espace/);
    expect(reg.PRO_REGISTRATION_RECEIVED).not.toHaveProperty('token');
  });
});

describe('who may receive an MFA enrolment invitation', () => {
  const S = (statut, verification_status, id = 's-1') => ({ id, statut, verification_status });
  it('a member of another structure only when it is active AND verified', () => {
    expect(mfaInvitationAllowedFor(S('actif', 'VERIFIED'), 'platform')).toBe(true);
    for (const s of [S('brouillon', null), S('actif', null), S('actif', 'REJECTED'), S('brouillon', 'VERIFIED'), S('suspendu', 'VERIFIED'), null]) {
      expect(mfaInvitationAllowedFor(s, 'platform'), JSON.stringify(s)).toBe(false);
    }
    expect(mfaInvitationAllowedFor(S('brouillon', null), null), 'the admin realm has no structure').toBe(false);
  });
  it('the sender\'s own structure is unchanged (the SUPERADMIN\'s platform structure, a structure administrator\'s own members)', () => {
    expect(mfaInvitationAllowedFor(S('brouillon', null, 'platform'), 'platform')).toBe(true);
  });
  it('a pending self-registered account is never a session status', () => {
    expect(PRO_PENDING_VERIFICATION_STATUS).toBe('pending_verification');
    expect(PRO_SESSION_STATUSES).not.toContain(PRO_PENDING_VERIFICATION_STATUS);
    expect(reg.PENDING_VERIFICATION_STATUS).toBe(PRO_PENDING_VERIFICATION_STATUS);
  });
});
