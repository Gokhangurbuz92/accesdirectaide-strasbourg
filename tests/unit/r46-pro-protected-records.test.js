/**
 * R46 — protected records of the case work (case notes) behind one interface (api/_services/pro-protected-records.js): available in the LAB; in production /
 * preview refused unless a valid HDS attestation AND the explicit « main-db-certified » statement; the case service refuses BEFORE any database access.
 */
import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('the database must not be touched'); } }) }));
process.env.ADA_ENCRYPTION_KEY = process.env.ADA_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

const TOKEN = `HDS1:example-host:CERT-2026-0001:2099-12-31:${'a'.repeat(64)}`;
const { protectedRecordsState, createProProtectedRecords, ProtectedRecordsRefusedError } = await import('../../api/_services/pro-protected-records.js');

describe('R46 protected records — selection', () => {
  it('LAB (development / test): available, never claimed certified', () => {
    expect(protectedRecordsState({ VERCEL_ENV: 'development' })).toEqual({ ok: true, driver: 'main-db-sealed', reason: null, hdsCertified: false });
    expect(protectedRecordsState({})).toMatchObject({ ok: true, hdsCertified: false });
  });
  it.each([
    ['production, nothing', { VERCEL_ENV: 'production' }, 'HDS_ATTESTATION_ABSENT'],
    ['preview, nothing', { VERCEL_ENV: 'preview' }, 'HDS_ATTESTATION_ABSENT'],
    ['production, malformed token', { VERCEL_ENV: 'production', ADA_HDS_CERTIFIED_HOSTING: 'HDS1:x' }, 'HDS_ATTESTATION_MALFORMED'],
    ['production, expired token', { VERCEL_ENV: 'production', ADA_HDS_CERTIFIED_HOSTING: TOKEN.replace('2099-12-31', '2020-01-01') }, 'HDS_ATTESTATION_EXPIRED'],
    ['production, token but no host statement', { VERCEL_ENV: 'production', ADA_HDS_CERTIFIED_HOSTING: TOKEN }, 'RECORDS_HOST_NOT_DECLARED_CERTIFIED'],
    ['production, statement alone', { VERCEL_ENV: 'production', ADA_PROTECTED_RECORDS: 'main-db-certified' }, 'HDS_ATTESTATION_ABSENT'],
    ['production, a look-alike statement', { VERCEL_ENV: 'production', ADA_HDS_CERTIFIED_HOSTING: TOKEN, ADA_PROTECTED_RECORDS: 'certified' }, 'RECORDS_HOST_NOT_DECLARED_CERTIFIED'],
  ])('refused: %s', (_, env, reason) => {
    expect(protectedRecordsState(env)).toMatchObject({ ok: false, reason });
    const store = createProProtectedRecords({ env });
    expect(() => store.sealCaseNote('c1', 'x')).toThrow(ProtectedRecordsRefusedError);
    expect(() => store.openCaseNote('c1', 'v2:x')).toThrow(ProtectedRecordsRefusedError);
  });
  it('production with a valid token AND the statement: available and certified', () => {
    expect(protectedRecordsState({ VERCEL_ENV: 'production', ADA_HDS_CERTIFIED_HOSTING: TOKEN, ADA_PROTECTED_RECORDS: 'main-db-certified' })).toEqual({ ok: true, driver: 'main-db-sealed', reason: null, hdsCertified: true });
  });
  it('LAB round trip: sealed per case (another case cannot open it), never stored in clear', () => {
    const store = createProProtectedRecords({ env: {} });
    const sealed = store.sealCaseNote('case-1', 'Note interne synthétique');
    expect(sealed).toMatch(/^v2:/); expect(sealed).not.toContain('synthétique');
    expect(store.openCaseNote('case-1', sealed)).toBe('Note interne synthétique');
    expect(() => store.openCaseNote('case-2', sealed)).toThrow();
  });
});

describe('R46 protected records — the case service refuses before the database', () => {
  const old = { ...process.env };
  afterEach(() => { process.env = { ...old }; });
  it('production behaviour without a certified records host: addNote / getCase answer 503 PROTECTED_STORE_REFUSED (db untouched)', async () => {
    process.env.VERCEL_ENV = 'production';
    const cases = await import('../../api/_services/pro-cases.js');
    const ctx = { userId: 'u', structureId: 's', role: 'PRO' };
    const db = new Proxy({}, { get() { throw new Error('db touched'); } });
    expect(await cases.addNote('c1', { visibility: 'INTERNAL', body: 'Note synthétique' }, ctx, db)).toMatchObject({ ok: false, status: 503, code: 'PROTECTED_STORE_REFUSED' });
    expect(await cases.getCase('c1', ctx, db)).toMatchObject({ ok: false, status: 503, code: 'PROTECTED_STORE_REFUSED' });
  });
});
