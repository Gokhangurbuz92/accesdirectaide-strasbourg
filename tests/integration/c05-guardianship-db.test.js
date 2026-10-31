/**
 * C05 (R30) on REAL PostgreSQL — the minor ↔ legal guardian link with the production store (drizzle) and the real age gate (ageGate):
 * synthetic accounts only; skipped without DATABASE_URL. By default (no DPO policy) the link never opens the gate; with a configured policy a verifier's
 * allowed method opens it and a revocation closes it again; every step is in the append-only consent ledger.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const id = (k) => `c05-${k}-${TS}`;
const CONFIGURED = JSON.stringify({ status: 'CONFIGURED', version: 'test-dpo', bands: { 'moins-de-18': { account: 'GUARDIAN_CONSENT_REQUIRED' }, '18-24': { account: 'ALLOWED' }, '25-59': { account: 'ALLOWED' }, '60-et-plus': { account: 'ALLOWED' } },
  guardianVerification: { strongMethods: ['PROFESSIONAL_ATTESTATION'], scopes: ['household'] } });

describe.skipIf(!hasDatabase)('C05 guardian link (real DB)', () => {
  let db, schema, g, account;
  const users = [['minor', 'moins-de-18', true], ['parent', '25-59', true]];
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    g = await import('../../api/_services/guardianship.js');
    account = await import('../../api/_services/citizen-account.js');
    for (const [k, band, verified] of users) {
      await db.insert(schema.CitizenUser).values({ id: id(k), email: `${id(k)}@example.test`, passwordHash: 'synthetic-not-a-hash', emailVerifiedAt: verified ? new Date() : null });
      await db.insert(schema.CitizenProfile).values({ userId: id(k), ageBand: band, displayName: k === 'parent' ? 'Parent synthétique' : 'Mineur synthétique' });
    }
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    const ids = users.map(([k]) => id(k));
    await db.delete(schema.GuardianRelationship).where(inArray(schema.GuardianRelationship.minorId, ids));
    await db.delete(schema.ConsentLog).where(inArray(schema.ConsentLog.subject_id, ids));
    await db.delete(schema.CitizenProfile).where(inArray(schema.CitizenProfile.userId, ids));
    await db.delete(schema.CitizenUser).where(inArray(schema.CitizenUser.id, ids));
  });
  const store = (env) => g.drizzleGuardianStore(db, schema, account.appendConsent, env);

  it('default policy: declared and confirmed, but the strong check cannot be asked and the gate stays closed', async () => {
    const s = store({});
    expect(await g.declareGuardian(id('minor'), { guardianEmail: `${id('parent')}@example.test` }, s)).toMatchObject({ ok: true, status: 202 });
    expect(await g.declareGuardian(id('minor'), { guardianEmail: `nobody-${TS}@example.test` }, s)).toMatchObject({ ok: true, status: 202 });   // same answer
    const [rel] = await db.select().from(schema.GuardianRelationship).where(eq(schema.GuardianRelationship.minorId, id('minor')));
    expect(rel).toMatchObject({ guardianId: id('parent'), status: 'DECLARED' });
    expect((await g.confirmAsGuardian(id('parent'), rel.id, s)).guardianship.status).toBe('EMAIL_VERIFIED');
    expect((await g.requestStrongVerification(id('parent'), rel.id, s)).code).toBe('POLICY_PENDING');
    expect((await account.ageGate(id('minor'), db))).toMatchObject({ accountFeatures: 'POLICY_PENDING', allowed: false });
    const seen = await g.listGuardianships(id('minor'), s);
    expect(seen.guardianships[0]).toMatchObject({ role: 'minor', status: 'EMAIL_VERIFIED', other: 'Parent synthétique' });
    expect(JSON.stringify(seen)).not.toMatch(/@example\.test/);
  });

  it('configured policy: an allowed method opens the gate; a revocation closes it; the ledger keeps every step', async () => {
    const prev = process.env.ADA_AGE_POLICY_JSON; process.env.ADA_AGE_POLICY_JSON = CONFIGURED;
    try {
      const s = store(process.env);
      const [rel] = await db.select().from(schema.GuardianRelationship).where(eq(schema.GuardianRelationship.minorId, id('minor')));
      expect((await g.requestStrongVerification(id('parent'), rel.id, s)).guardianship.status).toBe('STRONGER_VERIFICATION_REQUIRED');
      expect((await g.recordStrongVerification({ verifierId: 'pro-synthetic', isVerifier: true }, rel.id, { method: 'IDENTITY_DOCUMENT_CHECK' }, s)).code).toBe('METHOD_NOT_ALLOWED');
      expect((await g.recordStrongVerification({ verifierId: 'pro-synthetic', isVerifier: true }, rel.id, { method: 'PROFESSIONAL_ATTESTATION' }, s)).guardianship.status).toBe('VERIFIED_STRONG');
      expect(await account.ageGate(id('minor'), db)).toMatchObject({ accountFeatures: 'GUARDIAN_CONSENT_REQUIRED', allowed: true });
      expect((await g.revokeGuardianship(id('minor'), rel.id, s)).guardianship.status).toBe('REVOKED');
      expect(await account.ageGate(id('minor'), db)).toMatchObject({ allowed: false });
      const ledger = await db.select().from(schema.ConsentLog).where(eq(schema.ConsentLog.subject_id, id('minor')));
      expect(ledger.map((l) => l.purpose).sort()).toEqual(['GUARDIAN_LINK_DECLARED', 'GUARDIAN_LINK_EMAIL_VERIFIED', 'GUARDIAN_LINK_REVOKED', 'GUARDIAN_LINK_STRONGER_VERIFICATION_REQUIRED', 'GUARDIAN_LINK_VERIFIED_STRONG:PROFESSIONAL_ATTESTATION']);
      expect(ledger.every((l) => l.guardian_involved === true)).toBe(true);
    } finally { if (prev === undefined) delete process.env.ADA_AGE_POLICY_JSON; else process.env.ADA_AGE_POLICY_JSON = prev; }
  });
});
