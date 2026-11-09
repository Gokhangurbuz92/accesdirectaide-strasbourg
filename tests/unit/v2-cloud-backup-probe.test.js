// V2 C7 — effective bucket permissions probe (scripts/lib/backup-bucket.mjs probePermissions) against the loopback fake bucket: the producer token can
// write and read but cannot delete a fresh object while the bucket lock holds; the verifier token cannot write; neither token can list buckets.
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeS3 } from '../helpers/fake-s3.mjs';
import { bucketConfig, probePermissions, s3Client } from '../../scripts/lib/backup-bucket.mjs';

const RW = 'AKPROBEWRITER00001'; const RO = 'AKPROBEREADER00001';
let s3;
afterEach(async () => { await s3?.close(); s3 = undefined; });
const clientFor = async (id) => {
  const cfg = bucketConfig({ BACKUP_S3_ENDPOINT: s3.endpoint, BACKUP_S3_BUCKET: 'ada-probe-lab', BACKUP_S3_ACCESS_KEY_ID: id, BACKUP_S3_SECRET_ACCESS_KEY: 'lab-secret' });
  if (!cfg.ok) throw new Error(cfg.reason);
  return { cfg, client: await s3Client(cfg) };
};

describe('V2 C7 permission probe', () => {
  it('producer with an active bucket lock: list/put/read allowed, delete of the fresh probe refused, account scope refused → ok', async () => {
    s3 = await startFakeS3({ bucket: 'ada-probe-lab', keys: { [RW]: { write: true } }, lockSeconds: 30 * 86400 });
    const { cfg, client } = await clientFor(RW);
    const r = await probePermissions(client, cfg, 'producer', new Date('2026-11-09T12:00:00Z'));
    expect(r).toMatchObject({ ok: true, listObjects: 'allowed', listBuckets: 'refused', put: 'allowed', read: 'allowed', deleteFresh: 'refused', probeKey: 'probe/producer_20261109T120000Z.txt', problems: [] });
    expect(s3.objects.has('probe/producer_20261109T120000Z.txt')).toBe(true);
  });
  it('producer WITHOUT a bucket lock → BUCKET_LOCK_NOT_ENFORCED (Object Read & Write can delete)', async () => {
    s3 = await startFakeS3({ bucket: 'ada-probe-lab', keys: { [RW]: { write: true } } });
    const { cfg, client } = await clientFor(RW);
    const r = await probePermissions(client, cfg, 'producer');
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['BUCKET_LOCK_NOT_ENFORCED']);
  });
  it('verifier with a read-only token: put refused → ok; a verifier given the write token → VERIFIER_TOKEN_CAN_WRITE', async () => {
    s3 = await startFakeS3({ bucket: 'ada-probe-lab', keys: { [RW]: { write: true }, [RO]: { write: false } }, lockSeconds: 3600 });
    const ro = await clientFor(RO);
    expect(await probePermissions(ro.client, ro.cfg, 'verifier')).toMatchObject({ ok: true, put: 'refused', listBuckets: 'refused', probeKey: null });
    const rw = await clientFor(RW);
    expect((await probePermissions(rw.client, rw.cfg, 'verifier')).problems).toEqual(['VERIFIER_TOKEN_CAN_WRITE']);
  });
  it('the output names no secret', async () => {
    s3 = await startFakeS3({ bucket: 'ada-probe-lab', keys: { [RO]: { write: false } } });
    const { cfg, client } = await clientFor(RO);
    expect(JSON.stringify(await probePermissions(client, cfg, 'verifier'))).not.toContain('lab-secret');
  });
});
