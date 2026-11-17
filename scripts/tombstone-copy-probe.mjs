#!/usr/bin/env node
/**
 * D5 b — effective permissions of the tombstone-copy token, checked BEFORE it is stored in Vercel (CONTROL/v2/k3_tombstone_key_setup.sh) and usable at
 * any time. Reads the TOMBSTONE_COPY_* variables from the environment; prints ONE line of codes (never a value, never a key):
 *   TOMBSTONE_COPY_PROBE {"ok":true|false,"config":"OK"|<reason>,"put":…,"get":…,"list":…,"delete":…,"listBuckets":…,"otherBucket":…}
 * Expected (least privilege): put / get / list / delete ALLOWED on the bucket; ListBuckets and access to another bucket REFUSED.
 * Leaves nothing behind: the probe object (<prefix>probe/<random>.json, no personal data) is deleted by the probe itself.
 */
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, ListBucketsCommand } from '@aws-sdk/client-s3';
import { copyConfig, sealObject, openObject } from '../api/_services/erasure-tombstone-copy.js';
import { isMainModule } from './lib/is-main.mjs';

const outcome = async (/** @type {() => Promise<unknown>} */ f) => {
  try { await f(); return 'ALLOWED'; } catch (e) {
    const s = /** @type {any} */ (e)?.$metadata?.httpStatusCode;
    return s === 403 || s === 401 ? 'REFUSED' : s === 404 ? 'NOT_FOUND' : `ERROR_${s || /** @type {any} */ (e)?.name || 'UNKNOWN'}`.slice(0, 40);
  }
};

/** @param {Record<string, string | undefined>} env @param {{ client?: any }} [opts] */
export async function probe(env = process.env, opts = {}) {
  const cfg = copyConfig(env);
  if (!cfg.enabled) return { ok: false, config: cfg.invalid ? cfg.reason : 'COPY_CONFIG_MISSING' };
  const client = opts.client ?? new S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } });
  const key = `${cfg.prefix}probe/${crypto.randomBytes(8).toString('hex')}.json`;
  const r = { config: 'OK', put: 'SKIPPED', get: 'SKIPPED', roundTrip: false, list: 'SKIPPED', delete: 'SKIPPED', listBuckets: 'SKIPPED', otherBucket: 'SKIPPED' };
  r.put = await outcome(() => client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: sealObject(cfg.key, key, { probe: true }), ContentType: 'application/json' })));
  r.get = await outcome(async () => {
    const o = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    r.roundTrip = openObject(cfg.key, key, await o.Body.transformToString('utf8'))?.probe === true;
  });
  r.list = await outcome(() => client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: `${cfg.prefix}probe/` })));
  r.delete = await outcome(() => client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key })));
  r.listBuckets = await outcome(() => client.send(new ListBucketsCommand({})));
  r.otherBucket = await outcome(() => client.send(new ListObjectsV2Command({ Bucket: `${cfg.bucket}-other-probe`, MaxKeys: 1 })));
  const ok = r.put === 'ALLOWED' && r.get === 'ALLOWED' && r.roundTrip && r.list === 'ALLOWED' && r.delete === 'ALLOWED'
    && r.listBuckets !== 'ALLOWED' && r.otherBucket !== 'ALLOWED';
  return { ok, ...r };
}

if (isMainModule(import.meta.url)) {
  probe().then((r) => { console.log(`TOMBSTONE_COPY_PROBE ${JSON.stringify(r)}`); process.exitCode = r.ok ? 0 : 1; })
    .catch((e) => { console.log(`TOMBSTONE_COPY_PROBE ${JSON.stringify({ ok: false, config: 'OK', error: String(e?.name || 'Error').slice(0, 40) })}`); process.exitCode = 1; });
}
