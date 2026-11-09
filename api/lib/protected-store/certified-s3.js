// @ts-check
/**
 * V7 preparation — ProtectedStore driver for an HDS-certified host that exposes an S3-compatible object API (AWS S3 eu-west-3, Hosteur HDS bucket,
 * OVHcloud / Scaleway HDS object storage…) instead of the HTTP contract of CONTRACT.md § 3. Same guarantees as certified-host.js:
 *   - bytes are already sealed by ADA (data-keys.js) before they reach this driver; object ids are random UUIDs; no name, type or person id is sent;
 *   - the SHA-256 of what was stored is checked after PUT (HEAD) and on every GET; a mismatch is an integrity error, never accepted silently;
 *   - delete is idempotent (an absent object is success).
 * Keys stored in ADA's database are `phs2/<uuid>` (a key always goes back to the driver that wrote it, index.js).
 * Nothing here is live: no certified host is contracted. Exercised against a loopback fake bucket (tests/unit/v7-protected-store-s3.test.js).
 *
 * Configuration (names only):
 *   ADA_PROTECTED_STORE_S3_ENDPOINT   https base URL of the host's S3 API (http only to loopback, outside production / preview)
 *   ADA_PROTECTED_STORE_S3_BUCKET     bucket inside the host's HDS perimeter
 *   ADA_PROTECTED_STORE_S3_REGION     e.g. eu-west-3 (default « auto »)
 *   ADA_PROTECTED_STORE_S3_ACCESS_KEY_ID / ADA_PROTECTED_STORE_S3_SECRET_ACCESS_KEY   credential limited to this bucket
 */
import crypto from 'node:crypto';

export const CERTIFIED_S3_KEY_PREFIX = 'phs2/';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const flag = (/** @type {unknown} */ v) => String(v ?? '').trim();
const sha256 = (/** @type {Buffer} */ b) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * @param {Record<string, string | undefined>} envVars
 * @returns {{ ok: true, endpoint: string, bucket: string, region: string, accessKeyId: string, secretAccessKey: string } | { ok: false, reason: string }}
 */
export function certifiedS3Config(envVars = process.env) {
  const raw = flag(envVars.ADA_PROTECTED_STORE_S3_ENDPOINT);
  if (!raw) return { ok: false, reason: 'CERTIFIED_S3_ENDPOINT_MISSING' };
  const bucket = flag(envVars.ADA_PROTECTED_STORE_S3_BUCKET);
  const accessKeyId = flag(envVars.ADA_PROTECTED_STORE_S3_ACCESS_KEY_ID);
  const secretAccessKey = flag(envVars.ADA_PROTECTED_STORE_S3_SECRET_ACCESS_KEY);
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return { ok: false, reason: 'CERTIFIED_S3_BUCKET_INVALID' };
  if (!accessKeyId || !secretAccessKey) return { ok: false, reason: 'CERTIFIED_S3_CREDENTIAL_MISSING' };
  let u; try { u = new URL(raw); } catch { return { ok: false, reason: 'CERTIFIED_S3_ENDPOINT_INVALID' }; }
  const deployed = ['production', 'preview'].includes(flag(envVars.VERCEL_ENV).toLowerCase());
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname) && !deployed)) return { ok: false, reason: 'CERTIFIED_S3_ENDPOINT_NOT_HTTPS' };
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) return { ok: false, reason: 'CERTIFIED_S3_ENDPOINT_INVALID' };
  return { ok: true, endpoint: u.origin, bucket, region: flag(envVars.ADA_PROTECTED_STORE_S3_REGION) || 'auto', accessKeyId, secretAccessKey };
}

export class CertifiedS3Error extends Error {
  /** @param {string} code */
  constructor(code) { super(`CERTIFIED_S3_${code}`); this.name = 'CertifiedS3Error'; this.code = code; }
}

/** @param {Record<string, string | undefined>} envVars @param {{ clientFactory?: (cfg: any) => Promise<any> }} [opts] */
export function createCertifiedS3Store(envVars = process.env, opts = {}) {
  const cfg = certifiedS3Config(envVars);
  if (!cfg.ok) throw new CertifiedS3Error(cfg.reason);
  /** @type {Promise<{ client: any, cmd: any }> | null} */
  let ready = null;
  const get = () => {
    if (!ready) {
      ready = (async () => {
        const cmd = await import('@aws-sdk/client-s3');
        const client = opts.clientFactory ? await opts.clientFactory(cfg) : new cmd.S3Client({ endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: true,
          credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }, requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 3 });
        return { client, cmd };
      })();
    }
    return ready;
  };
  const objectKey = (/** @type {string} */ id) => `objects/${id}`;
  const idOf = (/** @type {string} */ key) => {
    const id = String(key).slice(CERTIFIED_S3_KEY_PREFIX.length);
    if (!String(key).startsWith(CERTIFIED_S3_KEY_PREFIX) || !/^[0-9a-f-]{36}$/.test(id)) throw new CertifiedS3Error('INVALID_KEY');
    return id;
  };
  const status = (/** @type {any} */ e) => Number(e?.$metadata?.httpStatusCode || 0);
  return {
    /** @param {Buffer} buffer @param {string} [mimeType] */
    async upload(buffer, mimeType = 'application/octet-stream') {
      const { client, cmd } = await get();
      const id = crypto.randomUUID();
      const digest = sha256(buffer);
      try {
        await client.send(new cmd.PutObjectCommand({ Bucket: cfg.bucket, Key: objectKey(id), Body: buffer, ContentLength: buffer.length, ContentType: mimeType, Metadata: { sha256: digest } }));
        const h = await client.send(new cmd.HeadObjectCommand({ Bucket: cfg.bucket, Key: objectKey(id) }));
        if (h.Metadata?.sha256 !== digest || Number(h.ContentLength) !== buffer.length) throw new CertifiedS3Error('PUT_DIGEST_MISMATCH');
      } catch (e) { if (e instanceof CertifiedS3Error) throw e; throw new CertifiedS3Error(status(e) === 403 ? 'ACCESS_DENIED' : 'PUT_REFUSED'); }
      return `${CERTIFIED_S3_KEY_PREFIX}${id}`;
    },
    /** @param {string} key */
    async download(key) {
      const id = idOf(key);
      const { client, cmd } = await get();
      let r;
      try { r = await client.send(new cmd.GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey(id) })); }
      catch (e) { throw new CertifiedS3Error(status(e) === 404 || /** @type {any} */ (e)?.name === 'NoSuchKey' ? 'NOT_FOUND' : 'GET_REFUSED'); }
      const bytes = Buffer.from(await r.Body.transformToByteArray());
      if (!r.Metadata?.sha256 || r.Metadata.sha256 !== sha256(bytes)) throw new CertifiedS3Error('GET_DIGEST_MISMATCH');
      return bytes;
    },
    /** @param {string} key */
    async delete(key) {
      const id = idOf(key);
      const { client, cmd } = await get();
      try { await client.send(new cmd.DeleteObjectCommand({ Bucket: cfg.bucket, Key: objectKey(id) })); }
      catch (e) { if (status(e) !== 404) throw new CertifiedS3Error('DELETE_REFUSED'); }
    },
  };
}
