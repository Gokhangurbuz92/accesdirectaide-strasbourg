// @ts-check
/**
 * R46 — the HTTP client of a future certified health-data host (HDS), as specified in CONTRACT.md beside this file.
 * Nothing here is « live »: no certified host is contracted. The client is exercised against a local mock server (tests/unit/r46-protected-store.test.js).
 *
 * Configuration (names only; values are server secrets, never in the repository):
 *   ADA_PROTECTED_STORE_ENDPOINT    base URL; https only (http only to a loopback address, outside production / preview)
 *   ADA_PROTECTED_STORE_TOKEN       bearer credential issued by the host (32+ characters)
 *   ADA_PROTECTED_STORE_TIMEOUT_MS  per-request timeout (default 8000, 1000–30000)
 */
import crypto from 'node:crypto';

export const CERTIFIED_KEY_PREFIX = 'phs1/';
const MAX_ATTEMPTS = 3;

/** @param {unknown} v */
const flag = (v) => String(v ?? '').trim();
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** @param {Record<string, string | undefined>} envVars @returns {{ ok: true, endpoint: string, token: string, timeoutMs: number } | { ok: false, reason: string }} */
export function certifiedHostConfig(envVars = process.env) {
  const raw = flag(envVars.ADA_PROTECTED_STORE_ENDPOINT);
  const token = flag(envVars.ADA_PROTECTED_STORE_TOKEN);
  if (!raw) return { ok: false, reason: 'CERTIFIED_ENDPOINT_MISSING' };
  if (token.length < 32) return { ok: false, reason: 'CERTIFIED_TOKEN_MISSING' };
  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'CERTIFIED_ENDPOINT_INVALID' }; }
  const deployed = ['production', 'preview'].includes(flag(envVars.VERCEL_ENV).toLowerCase());
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname) && !deployed)) return { ok: false, reason: 'CERTIFIED_ENDPOINT_NOT_HTTPS' };
  if (u.username || u.password || u.search || u.hash) return { ok: false, reason: 'CERTIFIED_ENDPOINT_INVALID' };
  const t = Number(flag(envVars.ADA_PROTECTED_STORE_TIMEOUT_MS) || 8000);
  const timeoutMs = Number.isFinite(t) ? Math.min(30000, Math.max(1000, Math.round(t))) : 8000;
  return { ok: true, endpoint: u.toString().replace(/\/+$/, ''), token, timeoutMs };
}

export class CertifiedHostError extends Error {
  /** @param {string} code @param {number} [status] */
  constructor(code, status) { super(`CERTIFIED_HOST_${code}`); this.name = 'CertifiedHostError'; this.code = code; this.status = status ?? null; }
}

const sha256 = (/** @type {Buffer} */ b) => crypto.createHash('sha256').update(b).digest('hex');
const retryable = (/** @type {number} */ s) => s === 429 || s >= 500;
const sleep = (/** @type {number} */ ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * @param {Record<string, string | undefined>} envVars
 * @param {{ fetchImpl?: typeof fetch, backoffMs?: number }} [opts]
 */
export function createCertifiedHostStore(envVars = process.env, opts = {}) {
  const cfg = certifiedHostConfig(envVars);
  if (!cfg.ok) throw new CertifiedHostError(cfg.reason);
  const doFetch = opts.fetchImpl || fetch;
  const backoff = opts.backoffMs ?? 200;
  const idOf = (/** @type {string} */ key) => {
    const id = String(key).slice(CERTIFIED_KEY_PREFIX.length);
    if (!String(key).startsWith(CERTIFIED_KEY_PREFIX) || !/^[0-9a-f-]{36}$/.test(id)) throw new CertifiedHostError('INVALID_KEY');
    return id;
  };
  /** @param {string} method @param {string} id @param {{ body?: Buffer, headers?: Record<string, string> }} [init] */
  async function call(method, id, init = {}) {
    let last = /** @type {unknown} */ (null);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), cfg.ok ? cfg.timeoutMs : 8000);
      try {
        const res = await doFetch(`${cfg.ok ? cfg.endpoint : ''}/v1/objects/${encodeURIComponent(id)}`, {
          method, signal: ctl.signal, redirect: 'error',
          headers: { Authorization: `Bearer ${cfg.ok ? cfg.token : ''}`, 'Idempotency-Key': id, ...(init.headers || {}) },
          ...(init.body ? { body: /** @type {any} */ (init.body) } : {}),
        });
        if (!retryable(res.status) || attempt === MAX_ATTEMPTS) return res;
        last = new CertifiedHostError('UPSTREAM', res.status);
      } catch (e) {
        last = e;
        if (attempt === MAX_ATTEMPTS) throw new CertifiedHostError('UNREACHABLE');
      } finally { clearTimeout(timer); }
      await sleep(backoff * attempt);
    }
    throw last instanceof Error ? last : new CertifiedHostError('UNREACHABLE');
  }
  return {
    /** @param {Buffer} buffer @param {string} [mimeType] */
    async upload(buffer, mimeType = 'application/octet-stream') {
      const id = crypto.randomUUID();   // chosen by ADA: a retried PUT with the same id is idempotent (CONTRACT.md § 3)
      const digest = sha256(buffer);
      const res = await call('PUT', id, { body: buffer, headers: { 'Content-Type': mimeType, 'X-Content-SHA256': digest } });
      if (res.status !== 201 && res.status !== 200) throw new CertifiedHostError('PUT_REFUSED', res.status);
      const body = /** @type {any} */ (await res.json().catch(() => ({})));
      if (body?.sha256 !== digest) throw new CertifiedHostError('PUT_DIGEST_MISMATCH', res.status);
      return `${CERTIFIED_KEY_PREFIX}${id}`;
    },
    /** @param {string} key */
    async download(key) {
      const res = await call('GET', idOf(key));
      if (res.status === 404) throw new CertifiedHostError('NOT_FOUND', 404);
      if (res.status !== 200) throw new CertifiedHostError('GET_REFUSED', res.status);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (res.headers.get('x-content-sha256') !== sha256(bytes)) throw new CertifiedHostError('GET_DIGEST_MISMATCH', 200);
      return bytes;
    },
    /** @param {string} key */
    async delete(key) {
      const res = await call('DELETE', idOf(key));
      if (res.status !== 204 && res.status !== 200 && res.status !== 404) throw new CertifiedHostError('DELETE_REFUSED', res.status);   // 404 = already gone (idempotent)
    },
  };
}
