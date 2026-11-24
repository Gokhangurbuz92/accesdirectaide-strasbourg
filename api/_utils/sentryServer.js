// @ts-nocheck
import * as Sentry from '@sentry/node';
import { env } from './env.js';
import { redactText, containsIdentifiers } from './redact.js';
import { scrubBreadcrumb, scrubEvent, scrubText, sentryDsnIsEu } from '../../src/observability/sentryScrub.js';

const dsn = env.sentry.dsn;
const environment = env.sentry.environment;
const release = env.sentry.release;

/**
 * R5-S1: the server breadcrumbs follow the browser rules (src/observability/sentryScrub.js): console and form-input breadcrumbs are dropped, so is
 * any breadcrumb carrying a body; http / fetch keep method, scrubbed URL (no query, path tokens → [id]) and status; other string data is redacted.
 * @param {any} breadcrumb @returns {any} null to drop it
 */
export function sanitizeSentryBreadcrumb(breadcrumb) {
  if (!breadcrumb || typeof breadcrumb !== 'object') return null;
  if (breadcrumb.category === 'sentry') return null;
  if (breadcrumb.data && typeof breadcrumb.data === 'object' && Object.keys(breadcrumb.data).some((k) => BODY_KEY.test(k))) return null;
  const out = scrubBreadcrumb(breadcrumb);
  if (!out) return null;
  if (out.message) out.message = redactText(String(out.message));
  if (out.data) out.data = sanitizeDeep(out.data);
  return out;
}

/** a breadcrumb data key that carries a request or response body */
const BODY_KEY = /body|payload|^data$|^request$|^response$/i;

function sanitizeDeep(/** @type {unknown} */ obj) {
  if (typeof obj === 'string') return redactText(obj);   // PKG-6 / D21: string leaves are masked too
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeDeep);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k).toLowerCase();
    if (
      key.includes('authorization') ||
      key.includes('cookie') ||
      key.includes('token') ||
      key.includes('secret') ||
      key.includes('password') ||
      key.includes('key') ||
      key.includes('email') ||
      key.includes('phone') ||
      key.includes('nir') ||
      key.includes('iban') ||
      key.includes('prompt') ||
      key.includes('response') ||
      key.includes('diagnostic') ||
      key.includes('health') ||
      key.includes('disability')
    ) {
      // @ts-ignore
      out[k] = '[REDACTED]';
      continue;
    }
    // @ts-ignore
    out[k] = sanitizeDeep(v);
  }
  return out;
}

/**
 * R5-S1: the server event follows the browser rules (shared helper src/observability/sentryScrub.js): event.user deleted; request reduced to the URL
 * (no query string or fragment, path tokens and personal path parts → [id]) and the user-agent header — data, cookies, query_string and every other
 * header (x-forwarded-for, x-real-ip, cf-connecting-ip, authorization, cookie …) are deleted; e-mails → [email]; console breadcrumbs and breadcrumbs
 * with a body dropped. Kept from PKG-6 / D21: only a technical CODE survives as a message, frame source and variables never leave, safe diagnostics in
 * extra / tags / contexts are redacted by key and value, and an event that still carries an identifier is dropped, never sent.
 * @param {any} event
 * @returns {any} the scrubbed event, or null when it cannot be sent safely
 */
export function sanitizeSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const extra = event.extra && typeof event.extra === 'object' ? sanitizeDeep(event.extra) : undefined;
  const breadcrumbs = Array.isArray(event.breadcrumbs) ? event.breadcrumbs : Array.isArray(event.breadcrumbs?.values) ? event.breadcrumbs.values : null;
  delete event.breadcrumbs;
  scrubEvent(event);   // user, request, query strings, path tokens, e-mails, tags, transaction, frames
  if (extra) event.extra = scrubDeepText(extra);   // D21: safe diagnostics (requestId, phase) stay, redacted
  if (breadcrumbs) event.breadcrumbs = breadcrumbs.map(sanitizeSentryBreadcrumb).filter(Boolean);
  if (event.contexts) {
    event.contexts = sanitizeDeep(event.contexts);
    if (event.contexts.runtime) delete event.contexts.runtime.env;
  }
  if (event.tags) event.tags = sanitizeDeep(event.tags);

  // PKG-6 / D21: an exception or log MESSAGE can carry a fragment of the request (JSON.parse quotes the body, err.cause chains …). Only a technical CODE survives
  // (e.g. OPENFISCA_UNAVAILABLE); the error type and the code location of the frames stay; frame variables never leave.
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      ex.value = safeMessage(ex.value);
      for (const f of ex.stacktrace?.frames || []) { delete f.vars; delete f.pre_context; delete f.context_line; delete f.post_context; }   // file / function / line stay
    }
  }
  if (typeof event.message === 'string') event.message = safeMessage(event.message);
  else if (event.message && typeof event.message === 'object') { event.message.formatted = safeMessage(event.message.formatted); delete event.message.params; }
  if (event.logentry) { event.logentry.message = safeMessage(event.logentry.message); delete event.logentry.params; }
  // an event that still carries a recognisable identifier after scrubbing is dropped, never sent
  try { if (containsIdentifiers(JSON.stringify(event))) return null; } catch { return null; }
  return event;
}

/** @param {any} v @returns {any} */
function scrubDeepText(v) {
  if (typeof v === 'string') return scrubText(v);
  if (Array.isArray(v)) return v.map(scrubDeepText);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeepText(x)]));
  return v;
}

const CODE_MESSAGE = /^[A-Z][A-Z0-9_]{2,63}$/;
/** @param {unknown} m */
function safeMessage(m) {
  if (m == null) return m;
  const s = String(m).trim();
  return CODE_MESSAGE.test(s) ? s : '[message removed: may contain request data]';
}

/**
 * R5-S1: NO server performance tracing by default (errors only). Tracing needs BOTH SENTRY_SERVER_TRACING=on AND SENTRY_TRACES_SAMPLE_RATE a number in
 * ]0, 1]; otherwise undefined, and Sentry.init gets no tracesSampleRate at all (absent = tracing disabled; 0 would still enable the tracing machinery).
 * Launch-readiness item 68 (never 100 % by default) is kept: there is no default rate any more.
 * @param {unknown} [raw] @param {unknown} [flag] @returns {number | undefined}
 */
export function tracesSampleRate(raw = process.env.SENTRY_TRACES_SAMPLE_RATE, flag = process.env.SENTRY_SERVER_TRACING) {
  if (String(flag ?? '').trim().toLowerCase() !== 'on') return undefined;
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : undefined;
}

/**
 * R5-S1: the server sends only from a Vercel PRODUCTION deployment (VERCEL_ENV=production) with a DSN of the EU region (o<id>.ingest.de.sentry.io).
 * @param {{ dsn?: string, environment?: string }} [s]
 */
export function serverSentryActive(s = { dsn, environment }) {
  return s.environment === 'production' && sentryDsnIsEu(s.dsn);
}

if (serverSentryActive()) {
  const rate = tracesSampleRate();
  Sentry.init({
    dsn,
    environment,
    release,
    sendDefaultPii: false,
    ...(rate !== undefined ? { tracesSampleRate: rate } : {}),
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
    beforeSend: sanitizeSentryEvent,
  });
}

export default Sentry;
