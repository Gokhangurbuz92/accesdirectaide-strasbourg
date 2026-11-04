/**
 * R42-MAIL — Microsoft Graph `sendMail` adapter (MAILER_PROVIDER=msgraph), behind the provider switch of `mailer.js`.
 *
 * Sources (read 4 Nov 2026): learn.microsoft.com/graph/api/user-sendmail (application permission Mail.Send, `POST /users/{id|upn}/sendMail`, answer
 * `202 Accepted` « doesn't indicate that the request processing has completed »), /graph/outlook-things-to-know-about-send-mail (non-delivery reports are
 * placed in the sender's Inbox), /graph/throttling (429 + Retry-After seconds), /graph/throttling-limits (Outlook: 10,000 requests / 10 min and four
 * concurrent requests per app and mailbox), /entra/identity-platform/certificate-credentials (client assertion: PS256, `x5t#S256`, aud = the v2.0 token
 * endpoint, exp 5-10 min), /exchange/permissions-exo/application-rbac (the scope to ONE mailbox is an Exchange « Application Mail.Send » role assignment).
 *
 * What this adapter guarantees:
 *   - credentials: a certificate (preferred — signed with node:crypto, no dependency) or a client secret; the token is cached in memory until 5 min
 *     before it expires; every HTTP call has a 10 s timeout;
 *   - the result is at best PROVIDER_ACCEPTED (Graph 202): Microsoft gives NO delivery event; a bounce comes back as a non-delivery report in the
 *     sending mailbox, so nothing here is ever called « delivered »;
 *   - Graph has no idempotency key: a 429 (not taken) is retried in the call after Retry-After; a 5xx / timeout / network error is NOT retried in the
 *     call (the message may have been created) and is classed `retryable` for a later run, whose ledger (recordNotice, reachedToday, RdvNotificationLog,
 *     parcours ledger) skips who was already reached; a caller key accepted once by this instance is not sent again (in-memory, 24 h);
 *   - logs and results carry an HTTP status and a short error code only — never the address, the subject, the body or the provider's message;
 *   - `saveToSentItems: false`: no copy of a reset / verification link stays in the mailbox.
 */
import crypto from 'node:crypto';

export const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
export const TOKEN_HOST = 'https://login.microsoftonline.com';
export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const HTTP_TIMEOUT_MS = 10_000;
/** Graph's JSON request limit is 4 MB; the attachments (calendar files) are kept well below it */
const MAX_ATTACHMENT_BASE64_BYTES = 3 * 1024 * 1024;
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const DEDUPE_MAX = 2000;

/**
 * @typedef {{ tenantId: string, clientId: string, sender: string, certPrivateKey: string, certPem: string, clientSecret: string }} GraphConfig
 * @typedef {{ filename: string, contentType: string, base64: string }} GraphAttachment
 * @typedef {{ to: string, subject: string, text: string, html?: string, attachments?: GraphAttachment[], idempotencyKey?: string | null }} GraphMail
 * @typedef {'retryable' | 'permanent' | 'not_configured'} GraphFailure
 * @typedef {{ accepted: true, delivered: boolean, provider: 'msgraph', providerStatus?: number, errorCode?: string | null, failure?: GraphFailure,
 *   providerRequestId?: string, deduplicated?: boolean }} GraphResult
 * @typedef {(url: string, init: RequestInit) => Promise<Response>} FetchLike
 * @typedef {{ fetch?: FetchLike, now?: () => number, sleep?: (ms: number) => Promise<void> }} GraphDeps
 */

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TENANT_DOMAIN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const MAILBOX = /^[^\s@<>"]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** a short identifier that may be logged (never free text: a provider message can quote the recipient) @param {unknown} v @returns {string | null} */
export function safeCode(v) {
  return (typeof v === 'string' || typeof v === 'number') && /^[A-Za-z0-9_.-]{1,64}$/.test(String(v)) ? String(v) : null;
}

/** the bare address of « Name <address> » or « address » @param {string} from @returns {string} */
export function mailboxOf(from) {
  const s = String(from || '').trim();
  const m = /<([^<>]+)>\s*$/.exec(s);
  return (m ? m[1] : s).trim();
}

/** a multi-line PEM may be stored with literal « \n » (one-line environment values) @param {string} v */
const pem = (v) => String(v || '').trim().replace(/\\n/g, '\n');

/**
 * @param {{ tenantId?: string, clientId?: string, sender?: string, from?: string, certPrivateKey?: string, certPem?: string, clientSecret?: string }} raw
 * @returns {GraphConfig}
 */
export function graphConfig(raw) {
  return {
    tenantId: String(raw.tenantId || '').trim(),
    clientId: String(raw.clientId || '').trim(),
    sender: String(raw.sender || '').trim() || mailboxOf(String(raw.from || '')),
    certPrivateKey: pem(String(raw.certPrivateKey || '')),
    certPem: pem(String(raw.certPem || '')),
    clientSecret: String(raw.clientSecret || '').trim(),
  };
}

/**
 * Pure readiness rule (no I/O): which credential would be used, or why none can.
 * @param {GraphConfig} cfg @returns {{ ok: boolean, reason: string, credential: 'certificate' | 'secret' | null }}
 */
export function evaluateGraphConfig(cfg) {
  if (!GUID.test(cfg.tenantId) && !TENANT_DOMAIN.test(cfg.tenantId)) return { ok: false, reason: 'MAILER_MSGRAPH_TENANT_ID missing or malformed', credential: null };
  if (!GUID.test(cfg.clientId)) return { ok: false, reason: 'MAILER_MSGRAPH_CLIENT_ID missing or malformed', credential: null };
  if (!MAILBOX.test(cfg.sender)) return { ok: false, reason: 'MAILER_MSGRAPH_SENDER (or MAILER_FROM) missing or malformed', credential: null };
  const hasKey = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(cfg.certPrivateKey); const hasCert = /-----BEGIN CERTIFICATE-----/.test(cfg.certPem);
  if (hasKey && hasCert) return { ok: true, reason: 'ok', credential: 'certificate' };
  if (hasKey || hasCert) return { ok: false, reason: 'MAILER_MSGRAPH_CERT_PRIVATE_KEY and MAILER_MSGRAPH_CERT_PEM must both be set', credential: null };
  if (cfg.clientSecret) return { ok: true, reason: 'ok (client secret; a certificate is preferred)', credential: 'secret' };
  return { ok: false, reason: 'no Graph credential (certificate or MAILER_MSGRAPH_CLIENT_SECRET)', credential: null };
}

/** @param {Buffer | string} v */
const b64url = (v) => Buffer.from(v).toString('base64url');

/**
 * The signed client assertion of the certificate credential (private_key_jwt): header PS256 + x5t#S256, claims aud/iss/sub/jti/nbf/iat/exp.
 * @param {GraphConfig} cfg @param {number} nowMs @returns {string}
 */
export function clientAssertion(cfg, nowMs) {
  const cert = new crypto.X509Certificate(cfg.certPem);
  const key = crypto.createPrivateKey(cfg.certPrivateKey);
  if (!cert.checkPrivateKey(key)) throw Object.assign(new Error('certificate and private key do not match'), { code: 'certificate_key_mismatch' });
  const now = Math.floor(nowMs / 1000);
  const header = { alg: 'PS256', typ: 'JWT', 'x5t#S256': b64url(crypto.createHash('sha256').update(cert.raw).digest()) };
  const claims = { aud: `${TOKEN_HOST}/${cfg.tenantId}/oauth2/v2.0/token`, iss: cfg.clientId, sub: cfg.clientId, jti: crypto.randomUUID(), nbf: now, iat: now, exp: now + 300 };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST });
  return `${signingInput}.${b64url(signature)}`;
}

/** @type {{ id: string, token: string, expiresAt: number } | null} */
let tokenCache = null;
/** @type {Map<string, number>} caller key -> time this instance saw Graph accept it */
const acceptedKeys = new Map();

/** Test-only reset of the token cache and of the accepted-key memory. */
export function __resetGraphState() { tokenCache = null; acceptedKeys.clear(); }

/** @param {unknown} e @returns {string} */
const errName = (e) => (e && typeof e === 'object' && 'name' in e && typeof e.name === 'string' ? e.name : 'Error');
/** @param {Response} res @returns {Promise<any>} */
const jsonOf = async (res) => { try { return await res.json(); } catch { return null; } };

/**
 * @param {GraphConfig} cfg @param {Required<GraphDeps>} deps @param {boolean} fresh ignore the cached token
 * @returns {Promise<{ ok: true, token: string, cached: boolean } | { ok: false, failure: GraphFailure, status?: number, errorCode: string }>}
 */
async function getToken(cfg, deps, fresh) {
  const id = `${cfg.tenantId}|${cfg.clientId}`;
  const now = deps.now();
  if (!fresh && tokenCache && tokenCache.id === id && tokenCache.expiresAt > now) return { ok: true, token: tokenCache.token, cached: true };
  const check = evaluateGraphConfig(cfg);
  if (!check.ok) return { ok: false, failure: 'not_configured', errorCode: 'not_configured' };
  const form = new URLSearchParams({ client_id: cfg.clientId, scope: GRAPH_SCOPE, grant_type: 'client_credentials' });
  if (check.credential === 'certificate') {
    try {
      form.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      form.set('client_assertion', clientAssertion(cfg, now));
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e && e.code === 'certificate_key_mismatch' ? 'certificate_key_mismatch' : 'bad_certificate';
      return { ok: false, failure: 'not_configured', errorCode: code };
    }
  } else form.set('client_secret', cfg.clientSecret);
  /** @type {Response} */
  let res;
  try {
    res = await deps.fetch(`${TOKEN_HOST}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, failure: 'retryable', errorCode: errName(e) === 'TimeoutError' ? 'token_timeout' : 'token_network' };
  }
  const body = await jsonOf(res);
  if (!res.ok || typeof body?.access_token !== 'string') {
    // the error identifier (invalid_client…) and the first AADSTS number only — never error_description (it can quote identifiers of the tenant)
    const aadsts = Array.isArray(body?.error_codes) ? safeCode(body.error_codes[0]) : null;
    const errorCode = [safeCode(body?.error) || 'token_error', aadsts].filter(Boolean).join(':');
    return { ok: false, failure: res.status === 429 || res.status >= 500 ? 'retryable' : 'not_configured', status: res.status, errorCode };
  }
  const lifetime = Number(body.expires_in);
  tokenCache = { id, token: body.access_token, expiresAt: now + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600) * 1000 - 5 * 60 * 1000 };
  return { ok: true, token: body.access_token, cached: false };
}

/** the Graph error class of an HTTP status: 429 / 5xx may succeed later; any other refusal is permanent for this message @param {number} status @returns {GraphFailure} */
export function classifyGraphFailure(status) {
  return status === 429 || status >= 500 ? 'retryable' : 'permanent';
}

/** @param {GraphMail} mail @returns {Record<string, unknown>} the sendMail request body (JSON format) */
export function graphMessage(mail) {
  const attachments = (mail.attachments || []).map((a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.filename, contentType: a.contentType, contentBytes: a.base64 }));
  return {
    message: {
      subject: mail.subject,
      body: mail.html ? { contentType: 'HTML', content: mail.html } : { contentType: 'Text', content: mail.text },
      toRecipients: [{ emailAddress: { address: mail.to } }],
      ...(attachments.length ? { attachments } : {}),
    },
    saveToSentItems: false,
  };
}

/**
 * Send one message through Graph. Never throws.
 * @param {GraphConfig} cfg @param {GraphMail} mail @param {GraphDeps} [deps] @returns {Promise<GraphResult>}
 */
export async function sendViaGraph(cfg, mail, deps = {}) {
  /** @type {Required<GraphDeps>} */
  const d = { fetch: deps.fetch || ((url, init) => fetch(url, init)), now: deps.now || Date.now, sleep: deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))) };
  /** @param {GraphFailure} failure @param {string | null} errorCode @param {number} [status] @returns {GraphResult} */
  function fail(failure, errorCode, status) {
    return { accepted: true, delivered: false, provider: 'msgraph', failure, errorCode, ...(status ? { providerStatus: status } : {}) };
  }
  const check = evaluateGraphConfig(cfg);
  if (!check.ok) return fail('not_configured', 'not_configured');
  const size = (mail.attachments || []).reduce((n, a) => n + a.base64.length, 0);
  if (size > MAX_ATTACHMENT_BASE64_BYTES) return fail('permanent', 'attachment_too_large');

  const key = mail.idempotencyKey || null;
  const now = d.now();
  for (const [k, at] of acceptedKeys) if (now - at > DEDUPE_TTL_MS) acceptedKeys.delete(k);
  if (key && acceptedKeys.has(key)) return { accepted: true, delivered: true, provider: 'msgraph', deduplicated: true };

  const url = `${GRAPH_BASE}/users/${encodeURIComponent(cfg.sender)}/sendMail`;
  const body = JSON.stringify(graphMessage(mail));
  let refreshed = false;
  for (let attempt = 0; ; attempt += 1) {
    const tok = await getToken(cfg, d, refreshed);
    if (!tok.ok) return fail(tok.failure, tok.errorCode, tok.status);
    /** @type {Response} */
    let res;
    try {
      res = await d.fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${tok.token}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    } catch (e) {
      // not retried in the call: Graph may already have created the message (no idempotency key) — a later run decides, with its ledger
      return fail('retryable', errName(e) === 'TimeoutError' ? 'timeout' : 'network');
    }
    if (res.status === 202 || res.ok) {
      if (key) {
        if (acceptedKeys.size >= DEDUPE_MAX) { const oldest = acceptedKeys.keys().next().value; if (oldest !== undefined) acceptedKeys.delete(oldest); }
        acceptedKeys.set(key, d.now());
      }
      const requestId = safeCode(res.headers.get('request-id'));
      return { accepted: true, delivered: true, provider: 'msgraph', providerStatus: res.status, ...(requestId ? { providerRequestId: requestId } : {}) };
    }
    // a cached token refused (revoked / rotated credential): one more attempt with a new token
    if (res.status === 401 && tok.cached && !refreshed) { refreshed = true; tokenCache = null; continue; }
    if (res.status === 429 && attempt < 2) {
      const header = res.headers.get('retry-after'); const after = header === null || header === '' ? NaN : Number(header);
      await d.sleep(Number.isFinite(after) && after >= 0 ? Math.min(after * 1000, 5000) : 500 * 2 ** attempt);
      continue;
    }
    const errBody = await jsonOf(res);
    return fail(classifyGraphFailure(res.status), safeCode(errBody?.error?.code), res.status);
  }
}
