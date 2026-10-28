// @ts-nocheck
import { env } from './env.js';
import logger from './logger.js';

/**
 * @typedef {{
 *  filename: string,
 *  contentType: string,
 *  content: string
 * }} MailAttachment
 */

/** @typedef {{ to: string, subject: string, text: string, html?: string, category?: string, attachments?: MailAttachment[] }} MailPayload */

/** @type {Array<{ to: string, subject: string, text: string, html?: string, sentAt: string, category: string, attachments?: MailAttachment[] }>} */
const testOutbox = [];
/** Upper bound for provider HTTP calls so a hung provider cannot stall callers. */
const MAILER_HTTP_TIMEOUT_MS = 10_000;
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
  return { ...out, outcome };
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
    return { accepted: true, delivered: false, provider };
  }

  // ── Mailjet v3.1 Send API ──
  if (provider === 'mailjet') {
    const apiKey = String(env.mailer.apiKey || '').trim();
    if (!apiKey || !apiKey.includes(':')) {
      warnProviderOnce('mailjet_missing_key');
      logger.error('[mailer] MAILER_API_KEY must be in "publicKey:secretKey" format for Mailjet.');
      return { accepted: true, delivered: false, provider };
    }
    if (!from) {
      warnProviderOnce('mailjet_missing_from');
      return { accepted: true, delivered: false, provider };
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

      const mjResponse = await fetch('https://api.mailjet.com/v3.1/send', {
        method: 'POST',
        signal: AbortSignal.timeout(MAILER_HTTP_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify(mjPayload),
      });

      if (!mjResponse.ok) {
        const errBody = await mjResponse.text().catch(() => '');
        logger.error(`[mailer] Mailjet API error (${mjResponse.status}): ${errBody}`);
        return { accepted: true, delivered: false, provider };
      }

      const mjResult = await mjResponse.json();
      const firstMessage = mjResult?.Messages?.[0];
      const status = firstMessage?.Status;
      logger.info(`[mailer] Mailjet sent category=${category} status=${status} id=${firstMessage?.To?.[0]?.MessageID || 'n/a'}`);   // PKG-4: no recipient address in logs (personal data)
      return { accepted: true, delivered: status === 'success', provider };
    } catch (err) {
      logger.error('[mailer] Mailjet fetch error:', err.message);
      return { accepted: true, delivered: false, provider };
    }
  }

  // ── Resend REST API ──
  if (provider === 'resend') {
    const apiKey = String(env.mailer.apiKey || '').trim();
    if (!apiKey || !from) {
      warnProviderOnce(provider);
      return { accepted: true, delivered: false, provider };
    }
    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(MAILER_HTTP_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from,
          to: payload.to,
          subject: payload.subject,
          text: payload.text,
          ...(payload.html ? { html: payload.html } : {}),
          ...(payload.attachments?.length ? { attachments: providerAttachments(payload.attachments).map((f) => ({ filename: f.filename, content: f.base64, content_type: f.contentType })) } : {}),
        }),
      });
      if (!resendResponse.ok) {
        const errBody = await resendResponse.text().catch(() => '');
        logger.error(`[mailer] Resend error (${resendResponse.status}): ${errBody}`);
        return { accepted: true, delivered: false, provider };
      }
      logger.info(`[mailer] Resend sent category=${category}`);   // PKG-4: no recipient address in logs (personal data)
      return { accepted: true, delivered: true, provider };
    } catch (err) {
      // @ts-ignore
      logger.error('[mailer] Resend fetch error:', err.message);
      return { accepted: true, delivered: false, provider };
    }
  }

  if (['smtp', 'postmark', 'sendgrid', 'brevo'].includes(provider)) {
    // Provider wiring is intentionally deferred to deployment config.
    warnProviderOnce(provider);
    logUndelivered(provider, category, 'provider not wired');
    return { accepted: true, delivered: false, provider };
  }

  warnProviderOnce(provider);
  return { accepted: true, delivered: false, provider };
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
