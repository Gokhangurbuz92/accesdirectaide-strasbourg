// @ts-nocheck
import crypto from 'node:crypto';
import { env } from './env.js';
import logger from './logger.js';

/**
 * @typedef {{
 *  filename: string,
 *  contentType: string,
 *  content: string
 * }} MailAttachment
 */

/** @typedef {{ to: string, subject: string, text: string, html?: string, category?: string, attachments?: MailAttachment[], idempotencyKey?: string }} MailPayload */

/** @type {Array<{ to: string, subject: string, text: string, html?: string, sentAt: string, category: string, attachments?: MailAttachment[] }>} */
const testOutbox = [];
/** Upper bound for provider HTTP calls so a hung provider cannot stall callers. */
const MAILER_HTTP_TIMEOUT_MS = 10_000;

/**
 * R36: a provider that answers 429 (rate limit) has not taken the message: it is sent again after the delay it asks for (Retry-After, at most 5 s), at most
 * twice. With an idempotency key (Resend) a 5xx or a network error is retried too — the provider then ignores a copy it already accepted; without one
 * (Mailjet) only the 429 is, so a message is never sent twice.
 * R41-E: `noRetry(res)` (optional, async) may refuse a retry after reading a CLONE of the answer — Resend's quota 429s (daily / monthly quota: a retry in the
 * same call cannot succeed) and its 409 invalid_idempotent_request are not retried; its 409 concurrent_idempotent_requests is (« safe to retry later »).
 * @param {string} url @param {RequestInit} init
 * @param {{ idempotent: boolean, sleep?: (ms: number) => Promise<void>, retryStatuses?: number[], noRetry?: (res: Response) => Promise<boolean> }} o
 */
export async function postWithRetry(url, init, { idempotent, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retryStatuses = [], noRetry = null }) {
  for (let attempt = 0; ; attempt += 1) {
    let res = null; let error = null;
    try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(MAILER_HTTP_TIMEOUT_MS) }); } catch (e) { error = e; }
    let retryable = res ? res.status === 429 || (idempotent && (res.status >= 500 || retryStatuses.includes(res.status))) : idempotent;
    if (retryable && res && noRetry && attempt < 2) retryable = !(await noRetry(res).catch(() => false));
    if (!retryable || attempt >= 2) { if (error) throw error; return res; }
    const header = res?.headers?.get?.('retry-after'); const after = header === null || header === undefined || header === '' ? NaN : Number(header);
    await sleep(Number.isFinite(after) && after >= 0 ? Math.min(after * 1000, 5000) : 500 * 2 ** attempt);
  }
}

/**
 * R41-E — the Resend error codes (resend.com/docs/api-reference/errors, read 3 Nov 2026) that are worth another attempt LATER (another run): a 5xx, a rate
 * limit or quota 429, a concurrent request with the same key. Everything else answered by the provider (400 / 401 / 403 / 404 / 405 / 409 reused key /
 * 422) is permanent for this message: the request, the key or the domain must change first.
 */
const RESEND_NO_RETRY_IN_CALL = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded', 'invalid_idempotent_request']);
/** @param {number} status @param {string | null} code @returns {'retryable' | 'permanent'} */
export function classifyProviderFailure(status, code) {
  if (status >= 500 || status === 429) return 'retryable';
  if (status === 409 && code === 'concurrent_idempotent_requests') return 'retryable';
  return 'permanent';
}
/** an error code as it may be logged: a short identifier, never free text (a provider message can quote the recipient) */
const safeCode = (v) => (typeof v === 'string' || typeof v === 'number') && /^[A-Za-z0-9_.-]{1,64}$/.test(String(v)) ? String(v) : null;
/** Resend error body `{ statusCode, name, message }`: only `name` is kept @param {Response} res */
async function resendErrorCode(res) {
  try { return safeCode((await res.json())?.name); } catch { return null; }
}
/** Mailjet v3.1 error body: the first ErrorCode of the first message (never ErrorMessage, which quotes the address) @param {any} body */
const mailjetErrorCode = (body) => safeCode(body?.Messages?.[0]?.Errors?.[0]?.ErrorCode) || safeCode(body?.ErrorCode) || null;

/**
 * R41-E — the Idempotency-Key a caller may give (e.g. `parcours-reminder/<item>/<threshold>/<due>/email`): kept as is when it is 1-256 plain identifier
 * characters, otherwise replaced by its SHA-256 (a key is sent in a header and kept 24 h by the provider: it must never carry an address or free text).
 * @param {unknown} key @returns {string | null}
 */
export function normalizeIdempotencyKey(key) {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return null;
  if (k.length <= 256 && /^[A-Za-z0-9/_:.-]+$/.test(k)) return k;
  return `sha256:${crypto.createHash('sha256').update(k, 'utf8').digest('hex')}`;
}

/**
 * R41-E — the class of a sendMail() result for a caller that decides whether to try again later: 'none' (accepted / test outbox), 'retryable' (provider
 * unreachable, 5xx, 429, timeout — or no result at all), 'permanent' (the provider refused this message), 'not_configured' (no provider / key / sender).
 * @param {{ outcome?: string, failure?: string } | null | undefined} out
 */
export function mailFailure(out) {
  if (!out) return 'retryable';
  if (out.outcome === 'PROVIDER_ACCEPTED' || out.outcome === 'TEST_RECORDED') return 'none';
  if (out.outcome === 'NOT_SENT') return 'not_configured';
  if (out.failure === 'retryable' || out.failure === 'not_configured') return out.failure;
  return 'permanent';
}
const warnedProviders = new Set();

/**
 * @returns {string}
 */
function getProvider() {
  return String(env.mailer.provider || 'noop').trim().toLowerCase() || 'noop';
}

/**
 * @param {string} provider
 */
function warnProviderOnce(provider) {
  if (warnedProviders.has(provider)) return;
  warnedProviders.add(provider);
  logger.warn(`[mailer] Provider "${provider}" is not configured for runtime delivery; using safe no-op.`);
}

/**
 * N05 (R13): the attachments as the providers' APIs take them (base64 of the UTF-8 bytes). Before R13 only the test outbox kept them: Mailjet and Resend sent the
 * confirmation / move / cancellation e-mails WITHOUT their calendar file.
 * @param {MailAttachment[] | undefined} attachments
 * @returns {Array<{ filename: string, contentType: string, base64: string }>}
 */
function providerAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.map((a) => ({
    filename: String(a?.filename || '').trim() || 'attachment.txt',
    contentType: String(a?.contentType || '').trim() || 'application/octet-stream',
    base64: Buffer.from(String(a?.content || ''), 'utf8').toString('base64'),
  }));
}

/**
 * Whether the configured provider can really deliver mail (no network call).
 * `noop` and the not-yet-wired providers (smtp/postmark/sendgrid/brevo) are accepted by sendMail() but never deliver,
 * which silently breaks e-mail verification (required to book) — readiness uses this to fail closed in production.
 * @returns {{ provider: string, deliverable: boolean, reason: string }}
 */
export function getMailerStatus() {
  return evaluateMailerConfig({ provider: getProvider(), from: env.mailer.from, apiKey: env.mailer.apiKey });
}

/**
 * Pure rule shared by readiness and the release preflight (no I/O, no env access).
 * @param {{ provider?: string, from?: string, apiKey?: string }} cfg
 * @returns {{ provider: string, deliverable: boolean, reason: string }}
 */
export function evaluateMailerConfig(cfg) {
  const provider = String(cfg.provider || 'noop').trim().toLowerCase() || 'noop';
  const from = String(cfg.from || '').trim();
  const apiKey = String(cfg.apiKey || '').trim();
  if (provider === 'test') return { provider, deliverable: true, reason: 'in-memory test outbox' };
  if (provider === 'resend') return apiKey && from ? { provider, deliverable: true, reason: 'ok' } : { provider, deliverable: false, reason: 'MAILER_API_KEY or MAILER_FROM missing' };
  if (provider === 'mailjet') return apiKey.includes(':') && from ? { provider, deliverable: true, reason: 'ok' } : { provider, deliverable: false, reason: 'MAILER_API_KEY (public:secret) or MAILER_FROM missing' };
  if (provider === 'noop') return { provider, deliverable: false, reason: 'MAILER_PROVIDER not configured (default noop)' };
  return { provider, deliverable: false, reason: 'provider not wired (only resend and mailjet send mail)' };
}

/** Structured, address-free error so undelivered verification/reset mails are visible in logs/Sentry. */
function logUndelivered(provider, category, reason) {
  logger.error({ msg: 'mailer.undelivered', provider, category, reason }, '[mailer] message accepted but NOT delivered');
}

/**
 * @param {MailPayload} payload
 * @returns {Promise<{ accepted: boolean, delivered: boolean, provider: string }>}
 */
/**
 * PKG-4 / R20: every result also carries `outcome`, so a ledger never confuses the cases:
 *   PROVIDER_ACCEPTED  a real provider ACCEPTED the request (that is not proof the mailbox received it: delivery / bounce is only known from the provider's events)
 *   TEST_RECORDED  kept in the in-memory test outbox (nothing left the machine)
 *   NOT_SENT       no provider configured (noop)                   NOT_DELIVERED  a real provider was tried and did not accept it (configuration or refusal)
 *   INVALID        incomplete message (no recipient / subject / text) — nothing attempted
 * `delivered` keeps its historical meaning for existing callers.
 */
export async function sendMail(payload) {
  const out = await sendMailRaw(payload);
  const provider = out?.provider;
  const invalid = !payload || typeof payload !== 'object' || !payload.to || !payload.subject || !payload.text;
  const outcome = invalid ? 'INVALID' : provider === 'test' ? 'TEST_RECORDED' : provider === 'noop' ? 'NOT_SENT' : out?.delivered ? 'PROVIDER_ACCEPTED' : 'NOT_DELIVERED';
  // R41-E: every failure carries its class (retryable / permanent / not_configured) and, when a provider answered, its HTTP status and error code
  const failure = outcome === 'PROVIDER_ACCEPTED' || outcome === 'TEST_RECORDED' ? undefined : invalid ? 'permanent' : outcome === 'NOT_SENT' ? 'not_configured' : out?.failure || 'permanent';
  return { ...out, outcome, ...(failure ? { failure } : {}) };
}

/** Ledger status of one e-mail attempt: TEST_RECORDED (test outbox) | PROVIDER_ACCEPTED (a real provider accepted the request — not a confirmed delivery) | NOT_DELIVERED.
 *  PKG-5: nothing is ever recorded as DELIVERED for e-mail without a provider delivery event. Works with older results that carry only `delivered`. */
export const mailLedgerStatus = (out) => (out?.outcome === 'TEST_RECORDED' ? 'TEST_RECORDED' : (out?.outcome ? out.outcome === 'PROVIDER_ACCEPTED' : Boolean(out?.delivered)) ? 'PROVIDER_ACCEPTED' : 'NOT_DELIVERED');

async function sendMailRaw(payload) {
  const provider = getProvider();
  const from = String(env.mailer.from || '').trim();
  const category = String(payload.category || 'transactional').trim() || 'transactional';

  if (!payload || typeof payload !== 'object') {
    return { accepted: false, delivered: false, provider };
  }
  if (!payload.to || !payload.subject || !payload.text) {
    return { accepted: false, delivered: false, provider };
  }

  if (!from) {
    warnProviderOnce('missing_from');
  }

  if (provider === 'test') {
    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments.map((attachment) => ({
        filename: String(attachment?.filename || '').trim() || 'attachment.txt',
        contentType: String(attachment?.contentType || '').trim() || 'application/octet-stream',
        content: String(attachment?.content || ''),
      }))
      : [];

    testOutbox.push({
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      category,
      attachments,
      sentAt: new Date().toISOString(),
    });
    return { accepted: true, delivered: true, provider };
  }

  if (provider === 'noop') {
    warnProviderOnce('noop');
    logUndelivered(provider, category, 'noop provider');
    return { accepted: true, delivered: false, provider, failure: 'not_configured', errorCode: 'not_configured' };
  }

  // ── Mailjet v3.1 Send API ──
  if (provider === 'mailjet') {
    const apiKey = String(env.mailer.apiKey || '').trim();
    if (!apiKey || !apiKey.includes(':')) {
      warnProviderOnce('mailjet_missing_key');
      logger.error('[mailer] MAILER_API_KEY must be in "publicKey:secretKey" format for Mailjet.');
      return { accepted: true, delivered: false, provider, failure: 'not_configured', errorCode: 'not_configured' };
    }
    if (!from) {
      warnProviderOnce('mailjet_missing_from');
      return { accepted: true, delivered: false, provider, failure: 'not_configured', errorCode: 'not_configured' };
    }

    try {
      const credentials = Buffer.from(apiKey).toString('base64');
      const files = providerAttachments(payload.attachments);
      const mjPayload = {
        Messages: [{
          From: { Email: from, Name: 'AccesDirectAide' },
          To: [{ Email: payload.to }],
          Subject: payload.subject,
          TextPart: payload.text,
          ...(payload.html ? { HTMLPart: payload.html } : {}),
          CustomID: category,
          ...(files.length ? { Attachments: files.map((f) => ({ ContentType: f.contentType, Filename: f.filename, Base64Content: f.base64 })) } : {}),
        }],
      };

      const mjResponse = await postWithRetry('https://api.mailjet.com/v3.1/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify(mjPayload),
      }, { idempotent: false });

      if (!mjResponse.ok) {
        // R41-E / G11: status and error code only — the body's ErrorMessage quotes the recipient address
        const errorCode = mailjetErrorCode(await mjResponse.json().catch(() => null));
        const failure = classifyProviderFailure(mjResponse.status, errorCode);
        logger.error({ msg: 'mailer.provider_error', provider, category, status: mjResponse.status, errorCode, failure }, '[mailer] Mailjet refused the message');
        return { accepted: true, delivered: false, provider, providerStatus: mjResponse.status, errorCode, failure };
      }

      const mjResult = await mjResponse.json();
      const firstMessage = mjResult?.Messages?.[0];
      const status = firstMessage?.Status;
      logger.info(`[mailer] Mailjet sent category=${category} status=${status} id=${firstMessage?.To?.[0]?.MessageID || 'n/a'}`);   // PKG-4: no recipient address in logs (personal data)
      if (status !== 'success') {
        const errorCode = mailjetErrorCode(mjResult);
        return { accepted: true, delivered: false, provider, providerStatus: mjResponse.status, errorCode, failure: 'permanent' };
      }
      return { accepted: true, delivered: true, provider };
    } catch (err) {
      // R41-E: the error name only (a network error message can carry the URL or the peer address)
      logger.error({ msg: 'mailer.provider_unreachable', provider, category, err: { name: err?.name } }, '[mailer] Mailjet unreachable');
      return { accepted: true, delivered: false, provider, errorCode: err?.name === 'TimeoutError' ? 'timeout' : 'network', failure: 'retryable' };
    }
  }

  // ── Resend REST API ──
  if (provider === 'resend') {
    const apiKey = String(env.mailer.apiKey || '').trim();
    if (!apiKey || !from) {
      warnProviderOnce(provider);
      return { accepted: true, delivered: false, provider, failure: 'not_configured', errorCode: 'not_configured' };
    }
    try {
      const resendResponse = await postWithRetry('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          // one key per message: a retried copy is not sent twice. R41-E: a caller's stable key (a reminder retried by a later run within Resend's 24 h)
          'Idempotency-Key': normalizeIdempotencyKey(payload.idempotencyKey) || crypto.randomUUID(),
        },
        body: JSON.stringify({
          from,
          to: payload.to,
          subject: payload.subject,
          text: payload.text,
          ...(payload.html ? { html: payload.html } : {}),
          ...(payload.attachments?.length ? { attachments: providerAttachments(payload.attachments).map((f) => ({ filename: f.filename, content: f.base64, content_type: f.contentType })) } : {}),
        }),
      }, { idempotent: true, retryStatuses: [409], noRetry: async (res) => {
        const code = typeof res.clone === 'function' ? await resendErrorCode(res.clone()) : null;
        return (res.status === 409 && code !== 'concurrent_idempotent_requests') || RESEND_NO_RETRY_IN_CALL.has(code || '');
      } });
      if (!resendResponse.ok) {
        // R41-E / G11: the HTTP status and Resend's error `name` only — its `message` can repeat the recipient address (personal data)
        const errorCode = await resendErrorCode(resendResponse);
        const failure = classifyProviderFailure(resendResponse.status, errorCode);
        logger.error({ msg: 'mailer.provider_error', provider, category, status: resendResponse.status, errorCode, failure }, '[mailer] Resend refused the message');
        return { accepted: true, delivered: false, provider, providerStatus: resendResponse.status, errorCode, failure };
      }
      const accepted = await resendResponse.json().catch(() => null);
      logger.info(`[mailer] Resend sent category=${category}`);   // PKG-4: no recipient address in logs (personal data)
      return { accepted: true, delivered: true, provider, ...(safeCode(accepted?.id) ? { providerMessageId: accepted.id } : {}) };
    } catch (err) {
      // R41-E: the error name only (a network error message can carry the URL or the peer address)
      logger.error({ msg: 'mailer.provider_unreachable', provider, category, err: { name: err?.name } }, '[mailer] Resend unreachable');
      return { accepted: true, delivered: false, provider, errorCode: err?.name === 'TimeoutError' ? 'timeout' : 'network', failure: 'retryable' };
    }
  }

  if (['smtp', 'postmark', 'sendgrid', 'brevo'].includes(provider)) {
    // Provider wiring is intentionally deferred to deployment config.
    warnProviderOnce(provider);
    logUndelivered(provider, category, 'provider not wired');
    return { accepted: true, delivered: false, provider, failure: 'not_configured', errorCode: 'not_configured' };
  }

  warnProviderOnce(provider);
  return { accepted: true, delivered: false, provider, failure: 'not_configured', errorCode: 'not_configured' };
}

/**
 * Test-only accessor.
 */
export function __getTestOutbox() {
  return testOutbox.slice();
}

/**
 * Test-only reset.
 */
export function __clearTestOutbox() {
  testOutbox.length = 0;
}
