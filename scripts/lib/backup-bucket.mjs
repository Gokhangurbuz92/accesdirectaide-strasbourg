// @ts-check
/**
 * V2 C7 (cloud-only backups) — the object-storage side shared by scripts/cloud-backup.mjs (producer) and scripts/cloud-restore-verify.mjs (verifier).
 * S3 API (Cloudflare R2 in the EU jurisdiction by default; any S3-compatible bucket works). Pure helpers + a thin client wrapper; never logs a value of
 * a credential, of the database or of a backup.
 *
 * Configuration (names only — values are secrets of the runtime that runs the job, never of the repository):
 *   BACKUP_S3_ENDPOINT            https://<account id>.eu.r2.cloudflarestorage.com  (http only to a loopback address: LAB fake bucket)
 *   BACKUP_S3_BUCKET              bucket name
 *   BACKUP_S3_REGION              default « auto » (R2)
 *   BACKUP_S3_ACCESS_KEY_ID       bucket-scoped token (producer: Object Read & Write; verifier: Object Read only)
 *   BACKUP_S3_SECRET_ACCESS_KEY
 *   BACKUP_S3_PREFIX              default « prod/ »
 */
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const flag = (/** @type {unknown} */ v) => String(v ?? '').trim();

/** names of the configuration, for messages (never values) */
export const BUCKET_VARS = Object.freeze(['BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY']);

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, endpoint: string, bucket: string, region: string, prefix: string, accessKeyId: string, secretAccessKey: string, euJurisdiction: boolean }
 *   | { ok: false, reason: string, missing?: string[] }}
 */
export function bucketConfig(env = process.env) {
  const missing = BUCKET_VARS.filter((k) => !flag(env[k]));
  if (missing.length) return { ok: false, reason: 'BUCKET_CONFIG_MISSING', missing };
  let u; try { u = new URL(flag(env.BACKUP_S3_ENDPOINT)); } catch { return { ok: false, reason: 'BUCKET_ENDPOINT_INVALID' }; }
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) return { ok: false, reason: 'BUCKET_ENDPOINT_INVALID' };
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return { ok: false, reason: 'BUCKET_ENDPOINT_NOT_HTTPS' };
  const bucket = flag(env.BACKUP_S3_BUCKET);
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return { ok: false, reason: 'BUCKET_NAME_INVALID' };
  const prefix = flag(env.BACKUP_S3_PREFIX || 'prod/');
  if (!/^[a-z0-9_-]+\/$/.test(prefix)) return { ok: false, reason: 'BUCKET_PREFIX_INVALID' };
  return { ok: true, endpoint: u.origin, bucket, region: flag(env.BACKUP_S3_REGION) || 'auto', prefix,
    accessKeyId: flag(env.BACKUP_S3_ACCESS_KEY_ID), secretAccessKey: flag(env.BACKUP_S3_SECRET_ACCESS_KEY),
    euJurisdiction: /\.eu\.r2\.cloudflarestorage\.com$/.test(u.hostname) };
}

/**
 * The time an object was TAKEN, from its name (written by db-backup.mjs / db-erasure-replay.mjs): never the bucket's LastModified, which a copy changes.
 * @param {string} key @returns {{ kind: 'dump' | 'ledger' | 'sidecar' | 'other', t: number | null }}
 */
export function objectTime(key) {
  const base = String(key).split('/').pop() || '';
  const m = base.match(/_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.(dump\.enc|json\.enc)(\.sha256)?$/);
  const kind = !m ? 'other' : m[8] ? 'sidecar' : m[7] === 'dump.enc' && base.startsWith('ada_') && !base.startsWith('ada_erasures_') ? 'dump' : base.startsWith('ada_erasures_') ? 'ledger' : 'other';
  if (!m) return { kind, t: null };
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const d = new Date(t);
  return { kind, t: Number.isFinite(t) && d.getUTCDate() === +m[3] && d.getUTCMonth() === +m[2] - 1 ? t : null };
}

/**
 * Freshness and retention of the bucket (pure). keepDays: everything younger is kept; the newest dump is ALWAYS kept (a rotation never leaves zero
 * backups). `prune` = objects the rotation removes (dump + sidecar + ledger older than keepDays). `overdue` = objects older than keepDays + graceDays: the
 * bucket's lifecycle rule should already have deleted them (a retention failure, reported as an alert).
 * @param {{ key: string, size?: number }[]} objects
 * @param {{ keepDays: number, maxAgeHours: number, graceDays?: number, now?: number }} opts
 */
export function bucketPlan(objects, { keepDays, maxAgeHours, graceDays = 2, now = Date.now() }) {
  if (!Number.isInteger(keepDays) || keepDays < 1) throw new Error('invalid keepDays');
  const items = objects.map((o) => ({ ...o, ...objectTime(o.key) }));
  const dumps = items.filter((o) => o.kind === 'dump' && o.t !== null).sort((a, b) => /** @type {number} */ (b.t) - /** @type {number} */ (a.t));
  const ledgers = items.filter((o) => o.kind === 'ledger' && o.t !== null).sort((a, b) => /** @type {number} */ (b.t) - /** @type {number} */ (a.t));
  const newest = dumps[0] || null;
  const newestKeep = new Set(newest ? [newest.key, `${newest.key}.sha256`] : []);
  const old = (/** @type {number | null} */ t, days) => t !== null && now - t > days * 86400000;
  const prune = items.filter((o) => old(o.t, keepDays) && !newestKeep.has(o.key)).map((o) => o.key);
  const overdue = items.filter((o) => old(o.t, keepDays + graceDays) && !newestKeep.has(o.key)).length;
  const ageHours = newest ? Math.round(((now - /** @type {number} */ (newest.t)) / 3600000) * 10) / 10 : null;
  const dumpsWithoutSidecar = dumps.filter((d) => !items.some((o) => o.key === `${d.key}.sha256`)).length;
  return {
    dumps: dumps.length, ledgers: ledgers.length, newestDump: newest?.key || null, newestLedger: ledgers[0]?.key || null, ageHours,
    fresh: Boolean(newest) && /** @type {number} */ (ageHours) <= maxAgeHours, maxAgeHours, keepDays, prune, overdue, dumpsWithoutSidecar,
    totalBytes: items.reduce((s, o) => s + Number(o.size || 0), 0), unknownObjects: items.filter((o) => o.kind === 'other').length,
  };
}

/** the newest ledger exported at or after a dump (what a restore of that dump must replay) @param {{ key: string }[]} objects @param {string} dumpKey */
export function ledgerForDump(objects, dumpKey) {
  const t = objectTime(dumpKey).t;
  if (t === null) return null;
  const after = objects.map((o) => ({ key: o.key, ...objectTime(o.key) })).filter((o) => o.kind === 'ledger' && o.t !== null && /** @type {number} */ (o.t) >= t)
    .sort((a, b) => /** @type {number} */ (b.t) - /** @type {number} */ (a.t));
  return after[0]?.key || null;
}

/**
 * A healthchecks.io-style ping URL (https; http only to loopback). Optional: without it the job only reports through its exit code.
 * @param {string | undefined} raw @returns {string | null | false} null = not configured, false = invalid
 */
export function pingUrl(raw) {
  const v = flag(raw);
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.username || u.password || u.hash) return false;
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return false;
    return u.toString().replace(/\/+$/, '');
  } catch { return false; }
}

/** pings /start, success (''), /fail with a short body (codes and counts only); never throws (monitoring must not break the backup) */
export async function ping(base, suffix, body = '', fetchImpl = fetch) {
  if (!base) return false;
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 10000);
    try { const r = await fetchImpl(`${base}${suffix}`, { method: 'POST', body: String(body).slice(0, 10000), signal: ctl.signal, redirect: 'error' }); return r.ok; }
    finally { clearTimeout(timer); }
  } catch { return false; }
}

/** S3 client (SDK v3). Checksums only when the API requires them: R2 and other S3-compatible stores differ on the optional flexible checksums. */
export async function s3Client(/** @type {Extract<ReturnType<typeof bucketConfig>, { ok: true }>} */ cfg) {
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({ endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: true, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 4 });
}

/** every object under the prefix (paginated) */
export async function listObjects(client, cfg) {
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  /** @type {{ key: string, size: number }[]} */ const out = [];
  let token;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: cfg.prefix, ContinuationToken: token }));
    for (const o of r.Contents || []) out.push({ key: String(o.Key), size: Number(o.Size || 0) });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** uploads a local file (streamed, with its length) and checks the stored size and digest metadata with a HEAD */
export async function putFile(client, cfg, file, key, sha256) {
  const { PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const size = fs.statSync(file).size;
  await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: fs.createReadStream(file), ContentLength: size,
    ContentType: 'application/octet-stream', Metadata: { sha256 } }));
  const h = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
  if (Number(h.ContentLength) !== size || h.Metadata?.sha256 !== sha256) throw Object.assign(new Error('UPLOAD_NOT_CONFIRMED'), { code: 'UPLOAD_NOT_CONFIRMED' });
  return size;
}

/** downloads an object to a local file (0600) */
export async function getFile(client, cfg, key, file) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const r = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  await pipeline(/** @type {any} */ (r.Body), fs.createWriteStream(file, { mode: 0o600, flags: 'wx' }));
  return { sha256: r.Metadata?.sha256 || null };
}

export async function deleteKeys(client, cfg, keys) {
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  let n = 0;
  for (const k of keys) { await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: k })); n += 1; }
  return n;
}
