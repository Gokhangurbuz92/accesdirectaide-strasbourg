// @ts-nocheck
/**
 * Automatic verification chain (owner decision, 2026-10-25) — the polite fetcher of official sources.
 *
 * Every request goes to an official site of the allow-list (api/lib/services/official-sources.js: https/http only, no loopback or private address, host on the
 * list) or of the registry's attested domains (opts.trustedDomains: e.g. the website the Annuaire de l'administration gives for a public body, see sources.js);
 * each redirect is re-checked the same way before it is followed (service-public.fr → service-public.gouv.fr is fine, a redirect elsewhere is refused).
 * One request at a time per host with a pause between two, a timeout and a size limit; the user agent names the service. The chain never sends personal data:
 * it only reads public pages and public registries.
 *
 * ADA_VERIFICATION_NETWORK=off disables every request (tests, offline machines): the chain then records « source non consultée », never a success.
 */
import { validateUrlSafety } from '../../lib/services/official-sources.js';

export const USER_AGENT = 'AccesDirectAide/1.0 (verification automatique des fiches publiques; +https://www.accesdirectaide.fr)';
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_BYTES = 3 * 1024 * 1024;
/** the largest download a caller may ask for (opts.maxBytes): the Service-Public open-data archive is about 25 MB */
const MAX_BYTES_CEILING = 64 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const gapEnv = process.env.ADA_VERIFICATION_MIN_GAP_MS;
const MIN_GAP_MS = gapEnv !== undefined && gapEnv !== '' && Number.isFinite(Number(gapEnv)) && Number(gapEnv) >= 0 ? Number(gapEnv) : 1200;

const lastByHost = new Map();
const chainByHost = new Map();

export class SourceError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [details] */
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

export const networkEnabled = (env = process.env) => String(env.ADA_VERIFICATION_NETWORK || 'on').toLowerCase() !== 'off';

/** host equal to, or a subdomain of, one of the domains @param {string} host @param {string[]} [domains] */
export const hostIn = (host, domains = []) => domains.some((d) => { const x = String(d || '').trim().toLowerCase(); return x && (host === x || host.endsWith('.' + x)); });

/** The address may be fetched: safe (no loopback / private network / other scheme) and on the allow-list or an attested domain. @param {string} url @param {string[]} [trustedDomains] */
export function fetchable(url, trustedDomains = []) {
  const safety = validateUrlSafety(url);
  if (safety.safe) return safety;
  if (safety.reason === 'DOMAIN_NOT_ALLOWED' && hostIn(new URL(url).hostname.toLowerCase(), trustedDomains)) return { safe: true };
  return safety;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serialise the requests of one host and keep a pause between them. */
async function politely(host, fn) {
  const previous = chainByHost.get(host) || Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  chainByHost.set(host, previous.then(() => mine));
  await previous.catch(() => {});
  try {
    const wait = (lastByHost.get(host) || 0) + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    return await fn();
  } finally {
    lastByHost.set(host, Date.now());
    release();
  }
}

/**
 * GET an official resource. Returns { status, url (final), text (or bytes with opts.binary), contentType, fetchedAt }; throws SourceError on a refused address, a
 * network failure, a timeout or an oversized answer. A 404 / 410 is returned (the caller decides: « page disparue »), not thrown.
 * opts.headers: extra request headers (conditional requests: If-Modified-Since / If-None-Match — a 304 is returned as it is, without a body).
 * @param {string} url @param {{ accept?: string, timeoutMs?: number, fetchImpl?: typeof fetch, env?: Record<string, string | undefined>, trustedDomains?: string[], binary?: boolean, maxBytes?: number, headers?: Record<string, string> }} [opts]
 */
export async function officialGet(url, opts = {}) {
  const env = opts.env || process.env;
  if (!networkEnabled(env)) throw new SourceError('NETWORK_DISABLED', 'Consultation des sources désactivée (ADA_VERIFICATION_NETWORK=off).');
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const maxBytes = Math.min(Number(opts.maxBytes) || MAX_BYTES, MAX_BYTES_CEILING);
  let current = String(url || '');
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let safety;
    try { safety = fetchable(current, opts.trustedDomains); } catch { safety = { safe: false, reason: 'INVALID_URL' }; }
    if (!safety.safe) throw new SourceError('URL_REFUSED', `Adresse refusée (${safety.reason}).`, { url: current, reason: safety.reason });
    const host = new URL(current).hostname.toLowerCase();
    const res = await politely(host, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
      try {
        return await fetchImpl(current, { method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: { ...(opts.headers || {}), 'User-Agent': USER_AGENT, Accept: opts.accept || 'text/html,application/json;q=0.9,*/*;q=0.5', 'Accept-Language': 'fr-FR,fr;q=0.9' } });
      } catch (e) {
        throw new SourceError(e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', e?.name === 'AbortError' ? 'Le site n’a pas répondu à temps.' : 'Le site n’a pas pu être joint.', { url: current });
      } finally { clearTimeout(timer); }
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    const contentType = res.headers.get('content-type') || '';
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new SourceError('TOO_LARGE', 'Réponse trop volumineuse.', { url: current, bytes: declared });
    if (res.status === 304) return { status: 304, url: current, bytes: null, text: '', contentType, lastModified: res.headers.get('last-modified') || null, etag: res.headers.get('etag') || null, fetchedAt: new Date().toISOString() };
    if (opts.binary) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > maxBytes) throw new SourceError('TOO_LARGE', 'Réponse trop volumineuse.', { url: current, bytes: bytes.length });
      return { status: res.status, url: current, bytes, contentType, lastModified: res.headers.get('last-modified') || null, etag: res.headers.get('etag') || null, fetchedAt: new Date().toISOString() };
    }
    const text = await res.text();
    if (text.length > maxBytes) throw new SourceError('TOO_LARGE', 'Réponse trop volumineuse.', { url: current, bytes: text.length });
    return { status: res.status, url: current, text, contentType, fetchedAt: new Date().toISOString() };
  }
  throw new SourceError('TOO_MANY_REDIRECTS', 'Trop de redirections.', { url });
}

/**
 * GET a large official file straight to disk (FINESS+: about 50 MB compressed each): the same address checks, redirect checks and per-host pause as officialGet,
 * the body streamed to `file` (never held in memory) with its SHA-1 and SHA-256 computed on the way, and a size limit (opts.maxBytes, 512 MB at most).
 * Returns { status, url, bytes, sha1, sha256 }; a non-200 answer or an oversized one throws SourceError and leaves no file.
 * @param {string} url @param {string} file @param {Parameters<typeof officialGet>[1]} [opts]
 */
export async function officialDownload(url, file, opts = {}) {
  const env = opts.env || process.env;
  if (!networkEnabled(env)) throw new SourceError('NETWORK_DISABLED', 'Consultation des sources désactivée (ADA_VERIFICATION_NETWORK=off).');
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const maxBytes = Math.min(Number(opts.maxBytes) || MAX_BYTES, 512 * 1024 * 1024);
  const { createHash } = await import('node:crypto'); const fs = await import('node:fs');
  let current = String(url || '');
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let safety;
    try { safety = fetchable(current, opts.trustedDomains); } catch { safety = { safe: false, reason: 'INVALID_URL' }; }
    if (!safety.safe) throw new SourceError('URL_REFUSED', `Adresse refusée (${safety.reason}).`, { url: current, reason: safety.reason });
    const host = new URL(current).hostname.toLowerCase();
    const out = await politely(host, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
      let res;
      try {
        res = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': USER_AGENT, Accept: opts.accept || '*/*' } });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) return { redirect: new URL(res.headers.get('location'), current).toString() };
        if (res.status !== 200) throw new SourceError('HTTP_' + res.status, `Réponse ${res.status} de la source.`, { url: current, status: res.status });
        if (Number(res.headers.get('content-length') || 0) > maxBytes) throw new SourceError('TOO_LARGE', 'Fichier trop volumineux.', { url: current });
        const sha1 = createHash('sha1'); const sha256h = createHash('sha256'); let bytes = 0;
        const w = fs.createWriteStream(file, { mode: 0o600 });
        try {
          for await (const part of res.body) {
            const b = Buffer.from(part); bytes += b.length;
            if (bytes > maxBytes) throw new SourceError('TOO_LARGE', 'Fichier trop volumineux.', { url: current, bytes });
            sha1.update(b); sha256h.update(b);
            if (!w.write(b)) await new Promise((r) => w.once('drain', r));
          }
          await new Promise((resolve, reject) => w.end((e) => (e ? reject(e) : resolve())));
        } catch (e) { w.destroy(); fs.rmSync(file, { force: true }); throw e; }
        return { status: 200, url: current, bytes, sha1: sha1.digest('hex'), sha256: sha256h.digest('hex') };
      } catch (e) {
        if (e instanceof SourceError) throw e;
        fs.rmSync(file, { force: true });
        throw new SourceError(e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', e?.name === 'AbortError' ? 'Le téléchargement n’a pas fini à temps.' : 'Le site n’a pas pu être joint.', { url: current });
      } finally { clearTimeout(timer); }
    });
    if (out.redirect) { current = out.redirect; continue; }
    return out;
  }
  throw new SourceError('TOO_MANY_REDIRECTS', 'Trop de redirections.', { url });
}

/** GET + JSON. @param {string} url @param {Parameters<typeof officialGet>[1]} [opts] */
export async function officialJson(url, opts = {}) {
  const r = await officialGet(url, { ...opts, accept: 'application/json' });
  if (r.status !== 200) throw new SourceError('HTTP_' + r.status, `Réponse ${r.status} de la source.`, { url: r.url, status: r.status });
  try { return { ...r, json: JSON.parse(r.text) }; } catch { throw new SourceError('BAD_JSON', 'Réponse illisible de la source.', { url: r.url }); }
}
