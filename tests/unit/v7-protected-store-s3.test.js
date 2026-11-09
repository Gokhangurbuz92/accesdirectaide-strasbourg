// V7 preparation — ProtectedStore « certified-s3 » driver (HDS host with an S3-compatible API) against a loopback fake bucket.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { startFakeS3 } from '../helpers/fake-s3.mjs';
import { certifiedS3Config, createCertifiedS3Store, CERTIFIED_S3_KEY_PREFIX } from '../../api/lib/protected-store/certified-s3.js';
import { createProtectedStore, driverOfKey, protectedStoreState } from '../../api/lib/protected-store/index.js';

let s3;
const W = { id: 'AKHDSWRITER000001', secret: crypto.randomBytes(20).toString('hex') };
const R = { id: 'AKHDSREADER000001', secret: crypto.randomBytes(20).toString('hex') };
const env = (extra = {}) => ({ ADA_PROTECTED_STORE: 'certified-s3', ADA_PROTECTED_STORE_S3_ENDPOINT: s3.endpoint, ADA_PROTECTED_STORE_S3_BUCKET: 'ada-hds-lab',
  ADA_PROTECTED_STORE_S3_ACCESS_KEY_ID: W.id, ADA_PROTECTED_STORE_S3_SECRET_ACCESS_KEY: W.secret, ...extra });

beforeAll(async () => { s3 = await startFakeS3({ bucket: 'ada-hds-lab', keys: { [W.id]: { write: true }, [R.id]: { write: false } } }); });
afterAll(async () => { await s3.close(); });

describe('certified-s3 configuration', () => {
  it('requires https outside the LAB loopback, a bucket and a credential; never echoes a value', () => {
    expect(certifiedS3Config(env()).ok).toBe(true);
    expect(certifiedS3Config(env({ VERCEL_ENV: 'production' }))).toMatchObject({ ok: false, reason: 'CERTIFIED_S3_ENDPOINT_NOT_HTTPS' });
    expect(certifiedS3Config(env({ ADA_PROTECTED_STORE_S3_ENDPOINT: 'https://s3.eu-west-3.amazonaws.com/x' }))).toMatchObject({ ok: false, reason: 'CERTIFIED_S3_ENDPOINT_INVALID' });
    expect(certifiedS3Config(env({ ADA_PROTECTED_STORE_S3_SECRET_ACCESS_KEY: '' }))).toMatchObject({ ok: false, reason: 'CERTIFIED_S3_CREDENTIAL_MISSING' });
    expect(JSON.stringify(certifiedS3Config(env({ ADA_PROTECTED_STORE_S3_BUCKET: 'BAD' })))).not.toContain(W.secret);
  });
});

describe('certified-s3 store', () => {
  it('stores sealed bytes under a random id, reads them back with the digest checked, deletes idempotently', async () => {
    const st = createCertifiedS3Store(env());
    const bytes = crypto.randomBytes(5000);
    const key = await st.upload(bytes);
    expect(key).toMatch(/^phs2\/[0-9a-f-]{36}$/);
    const stored = [...s3.objects.keys()];
    expect(stored).toEqual([`objects/${key.slice(CERTIFIED_S3_KEY_PREFIX.length)}`]);   // no name, type or person id in the object key
    expect((await st.download(key)).equals(bytes)).toBe(true);
    await st.delete(key);
    await st.delete(key);
    await expect(st.download(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('refuses a corrupted object, an invalid key and a write with a read-only credential', async () => {
    const st = createCertifiedS3Store(env());
    const key = await st.upload(Buffer.from('sealed'));
    const k = `objects/${key.slice(5)}`; const o = s3.objects.get(k);
    s3.objects.set(k, { ...o, body: Buffer.from('changed') });
    await expect(st.download(key)).rejects.toMatchObject({ code: 'GET_DIGEST_MISMATCH' });
    await expect(st.download('phs2/../../etc')).rejects.toMatchObject({ code: 'INVALID_KEY' });
    const ro = createCertifiedS3Store(env({ ADA_PROTECTED_STORE_S3_ACCESS_KEY_ID: R.id, ADA_PROTECTED_STORE_S3_SECRET_ACCESS_KEY: R.secret }));
    await expect(ro.upload(Buffer.from('x'))).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
});

describe('ProtectedStore selection with certified-s3', () => {
  it('keys go back to the driver that wrote them', () => {
    expect(driverOfKey('phs1/x')).toBe('certified');
    expect(driverOfKey('phs2/x')).toBe('certified-s3');
    expect(driverOfKey('vault/abc')).toBe('lab');
  });
  it('in production nothing is served without the HDS attestation, whatever the S3 configuration', () => {
    expect(protectedStoreState(env({ VERCEL_ENV: 'production', ADA_PROTECTED_STORE_S3_ENDPOINT: 'https://s3.eu-west-3.amazonaws.com' }))).toMatchObject({ ok: false, hdsCertified: false });
  });
  it('round trip through the ProtectedStore boundary; a phs1 key is refused by the S3 driver; erasure works', async () => {
    const ps = createProtectedStore({ env: env() });
    const key = await ps.upload(Buffer.from('sealed-blob'));
    expect(driverOfKey(key)).toBe('certified-s3');
    expect((await ps.download(key)).toString()).toBe('sealed-blob');
    await expect(ps.download(`phs1/${crypto.randomUUID()}`)).rejects.toMatchObject({ reason: 'KEY_OF_ANOTHER_DRIVER' });
    await ps.delete(key);
    expect([...s3.objects.keys()].some((k) => k.endsWith(key.slice(5)))).toBe(false);
  });
});
