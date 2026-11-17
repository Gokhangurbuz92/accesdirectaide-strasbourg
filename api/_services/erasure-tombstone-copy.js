/**
 * D5 b (owner decision 17/11/2026) — the SECOND copy of the erasure tombstones, outside the database AND outside Upstash: one object per tombstone in an
 * S3-compatible bucket of the K3 object storage (Cloudflare R2, EU jurisdiction — the same account as the backup and evidence buckets, a DEDICATED bucket
 * and a dedicated token: ops/cloud-backup/README.md, CONTROL/v2/k3_tombstone_key_setup.sh).
 *
 * Off unless every variable below is set (then the site behaves exactly as before: Upstash only). Names only — values are Vercel « sensitive » secrets:
 *   TOMBSTONE_COPY_S3_ENDPOINT           https://<account id>.eu.r2.cloudflarestorage.com  (http only to a loopback address: LAB fake bucket)
 *   TOMBSTONE_COPY_S3_BUCKET             bucket name (dedicated: the backup bucket has a 30-day lock and a 35-day lifecycle, both wrong here)
 *   TOMBSTONE_COPY_S3_ACCESS_KEY_ID      token scoped to that bucket only (R2 « Object Read & Write »)
 *   TOMBSTONE_COPY_S3_SECRET_ACCESS_KEY
 *   TOMBSTONE_COPY_KEY                   64 hex: AES-256-GCM key — every object is encrypted AND authenticated (a modified, swapped or forged object is
 *                                        rejected); it also keys the HMAC that names the objects, so a name reveals nothing
 *   TOMBSTONE_COPY_S3_PREFIX             optional, default « erasure-tombstones/ »
 *   TOMBSTONE_COPY_S3_REGION             optional, default « auto » (R2)
 *
 * Content = exactly the Upstash record (request id, pseudonymous subject id, domains, time, phase — no e-mail, no name, no content), encrypted.
 * Layout: <prefix>t/<YYYYMMDDTHHMMSSmmmZ>_<0 intent | 1 done/aborted>_<hmac>.json (one object per record; the name orders them) and <prefix>last.json (the
 * newest record written, like `…:last` in Upstash: its absence while records exist, or a marker younger than 40 days whose record is gone, = a loss).
 * Retention: 40 days per record, like the Upstash list — a bucket lifecycle rule on <prefix>t/ AND the hourly health check deletes overdue records itself
 * (inventory(), api/_handlers/cron/health-alert.js), so the retention holds even if the lifecycle rule is missing.
 */
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const COPY_VARS = Object.freeze(['TOMBSTONE_COPY_S3_ENDPOINT', 'TOMBSTONE_COPY_S3_BUCKET', 'TOMBSTONE_COPY_S3_ACCESS_KEY_ID', 'TOMBSTONE_COPY_S3_SECRET_ACCESS_KEY', 'TOMBSTONE_COPY_KEY']);
export const COPY_RETENTION_DAYS = 40;
export const COPY_FORMAT = 'ada-tombstone-copy/1';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
/** Cloudflare R2, EU jurisdiction (a jurisdictional bucket is reachable only there) — the K3 object storage */
const EU_R2_HOST = /^[a-z0-9]+\.eu\.r2\.cloudflarestorage\.com$/;
const flag = (/** @type {unknown} */ v) => String(v ?? '').trim();
const PAGE_LIMIT = 50;   // 50 × 1000 objects: far above 40 days of erasures; beyond it the listing is reported truncated (never silently partial)

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ enabled: false, invalid: false } | { enabled: false, invalid: true, reason: string, missing?: string[] } | { enabled: true, invalid: false,
 *   endpoint: string, bucket: string, region: string, prefix: string, accessKeyId: string, secretAccessKey: string, key: Buffer }}
 */
export function copyConfig(env = process.env) {
  const set = COPY_VARS.filter((k) => flag(env[k]));
  if (!set.length) return { enabled: false, invalid: false };
  const missing = COPY_VARS.filter((k) => !flag(env[k]));
  if (missing.length) return { enabled: false, invalid: true, reason: 'COPY_CONFIG_INCOMPLETE', missing };
  let u; try { u = new URL(flag(env.TOMBSTONE_COPY_S3_ENDPOINT)); } catch { return { enabled: false, invalid: true, reason: 'COPY_ENDPOINT_INVALID' }; }
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) return { enabled: false, invalid: true, reason: 'COPY_ENDPOINT_INVALID' };
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return { enabled: false, invalid: true, reason: 'COPY_ENDPOINT_NOT_HTTPS' };
  if (!LOOPBACK.has(u.hostname) && !EU_R2_HOST.test(u.hostname)) return { enabled: false, invalid: true, reason: 'COPY_ENDPOINT_NOT_EU_JURISDICTION' };
  const bucket = flag(env.TOMBSTONE_COPY_S3_BUCKET);
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return { enabled: false, invalid: true, reason: 'COPY_BUCKET_INVALID' };
  const prefix = flag(env.TOMBSTONE_COPY_S3_PREFIX) || 'erasure-tombstones/';
  if (!/^[a-z0-9_-]+\/$/.test(prefix)) return { enabled: false, invalid: true, reason: 'COPY_PREFIX_INVALID' };
  const hex = flag(env.TOMBSTONE_COPY_KEY);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return { enabled: false, invalid: true, reason: 'COPY_KEY_INVALID' };
  return { enabled: true, invalid: false, endpoint: u.origin, bucket, region: flag(env.TOMBSTONE_COPY_S3_REGION) || 'auto', prefix,
    accessKeyId: flag(env.TOMBSTONE_COPY_S3_ACCESS_KEY_ID), secretAccessKey: flag(env.TOMBSTONE_COPY_S3_SECRET_ACCESS_KEY), key: Buffer.from(hex, 'hex') };
}

/** AES-256-GCM; the object name is the additional authenticated data (an object copied under another name is rejected) @param {Buffer} key @param {string} name @param {unknown} value */
export function sealObject(key, name, value) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(name, 'utf8'));
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(value), 'utf8')), c.final()]);
  return JSON.stringify({ f: COPY_FORMAT, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') });
}
/** @param {Buffer} key @param {string} name @param {string} body @returns {any} throws COPY_OBJECT_TAMPERED when it does not authenticate */
export function openObject(key, name, body) {
  try {
    const o = JSON.parse(body);
    if (o?.f !== COPY_FORMAT) throw new Error('format');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64')); d.setAAD(Buffer.from(name, 'utf8')); d.setAuthTag(Buffer.from(o.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(o.ct, 'base64')), d.final()]).toString('utf8'));
  } catch { throw Object.assign(new Error('COPY_OBJECT_TAMPERED'), { code: 'COPY_OBJECT_TAMPERED' }); }
}

/** @param {string} iso */
const stampOf = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
/** @param {string} name @returns {number | null} the record time carried by an object name */
export function recordTimeOf(name) {
  const m = String(name).split('/').pop()?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z_[01]_[0-9a-f]{32}\.json$/);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]);
  return Number.isFinite(t) ? t : null;
}

/** @param {any} cfg copyConfig() result (enabled) @param {{ client?: any }} [opts] */
export function createTombstoneCopy(cfg, opts = {}) {
  const client = opts.client ?? new S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: true, maxAttempts: 2,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } });
  const lastName = `${cfg.prefix}last.json`;
  /** @param {{ requestId: string, phase: string, completedAt: string }} t */
  const nameOf = (t) => `${cfg.prefix}t/${stampOf(t.completedAt)}_${t.phase === 'intent' ? 0 : 1}_${
    crypto.createHmac('sha256', cfg.key).update(`${t.requestId}|${t.phase}|${t.completedAt}`).digest('hex').slice(0, 32)}.json`;
  const put = (/** @type {string} */ name, /** @type {unknown} */ value) => client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: name, Body: sealObject(cfg.key, name, value),
    ContentType: 'application/json' }));
  const get = async (/** @type {string} */ name) => {
    try { const r = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: name })); return await r.Body.transformToString('utf8'); }
    catch (e) { const s = /** @type {any} */ (e)?.$metadata?.httpStatusCode; if (s === 404 || /** @type {any} */ (e)?.name === 'NoSuchKey') return null; throw e; }
  };
  /** every record object, oldest first by name @returns {Promise<{ keys: { key: string, size: number }[], truncated: boolean }>} */
  const listRecords = async () => {
    const keys = []; /** @type {string | undefined} */ let token; let pages = 0;
    do {
      /** @type {{ Contents?: { Key?: string, Size?: number }[], IsTruncated?: boolean, NextContinuationToken?: string }} */
      const r = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: `${cfg.prefix}t/`, ContinuationToken: token }));
      for (const o of r.Contents || []) keys.push({ key: String(o.Key), size: Number(o.Size || 0) });
      token = r.IsTruncated ? r.NextContinuationToken : undefined; pages += 1;
    } while (token && pages < PAGE_LIMIT);
    return { keys: keys.sort((a, b) => a.key.localeCompare(b.key)), truncated: Boolean(token) };
  };
  return {
    nameOf,
    /** the record, then the marker; throws on any failure (the caller decides) @param {any} t tombstoneOf() record (+ copy flags) */
    async write(t) {
      await put(nameOf(t), t);
      await put(lastName, { requestId: t.requestId, phase: t.phase, completedAt: t.completedAt });
    },
    /** rewrites only the record (same name) — used to note that the Upstash write failed @param {any} t */
    async rewrite(t) { await put(nameOf(t), t); },
    /**
     * every record newest first (the order of the Upstash list) and the marker. A record that does not authenticate is NOT returned and is counted in
     * `tampered` (the replay refuses then); a listing cut by the page limit is `truncated` (refused too).
     */
    async snapshot() {
      const { keys, truncated } = await listRecords();
      const entries = []; let tampered = 0;
      for (const { key } of keys) {
        const body = await get(key);
        if (body === null) continue;   // expired between list and get
        try { entries.push(openObject(cfg.key, key, body)); } catch { tampered += 1; }
      }
      let last = null; const lb = await get(lastName);
      if (lb !== null) { try { last = openObject(cfg.key, lastName, lb); } catch { tampered += 1; } }
      return { entries: entries.reverse(), last, length: 0, tampered, truncated };
    },
    /**
     * Health check: lists the records (proves the bucket answers with this token) and deletes those older than the retention (DeleteObject).
     * @param {number} [now] @returns {Promise<{ objects: number, overdue: number, deleted: number, deleteFailed: number, truncated: boolean }>}
     */
    async inventory(now = Date.now()) {
      const { keys, truncated } = await listRecords();
      const old = keys.filter(({ key }) => { const t = recordTimeOf(key); return t !== null && now - t > COPY_RETENTION_DAYS * 86400000; });
      let deleted = 0; let deleteFailed = 0;
      for (const { key } of old) { try { await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key })); deleted += 1; } catch { deleteFailed += 1; } }
      return { objects: keys.length - deleted, overdue: old.length, deleted, deleteFailed, truncated };
    },
  };
}

/** the copy configured by the environment, or null (off) @param {Record<string, string | undefined>} [env] */
export function tombstoneCopyFromEnv(env = process.env) {
  const cfg = copyConfig(env);
  return cfg.enabled ? createTombstoneCopy(cfg) : null;
}
