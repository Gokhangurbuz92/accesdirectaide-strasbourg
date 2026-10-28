// @ts-nocheck
import * as Sentry from '@sentry/node';
import { env } from './env.js';
import { redactValue, redactText, containsIdentifiers } from './redact.js';

const dsn = env.sentry.dsn;
const environment = env.sentry.environment;
const release = env.sentry.release;

function scrubHeaders(/** @type {string | number | boolean | null | undefined} */ headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = String(k || '');
    const lower = key.toLowerCase();
    if (
      lower.includes('authorization') ||
      lower.includes('cookie') ||
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('key')
    ) {
      out[key] = '[REDACTED]';
      continue;
    }
    // @ts-ignore
    out[key] = typeof v === 'string' ? String(v).slice(0, 200) : v;
  }
  return out;
}

/**
* @param {{ category: any; message: any; data: any; }} breadcrumb
*/
export function sanitizeSentryBreadcrumb(breadcrumb) {
  if (!breadcrumb) return breadcrumb;
  if (breadcrumb.category === 'console' || breadcrumb.category === 'sentry') {
    const msg = (breadcrumb.message || '').toLowerCase();
    if (msg.includes('prompt') || msg.includes('dossier') || msg.includes('response') || msg.includes('diagnostic')) {
      breadcrumb.message = '[REDACTED SENSITIVE BREADCRUMB]';
      delete breadcrumb.data;
    }
  }
  if (breadcrumb.data) {
    breadcrumb.data = sanitizeDeep(breadcrumb.data);
  }
  return breadcrumb;
}

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
* @param {{ user: any; request: any; extra: any; contexts: any; tags: any; breadcrumbs: any; }} event
* @returns {any} the scrubbed event, or null when it cannot be sent safely (PKG-6 / D21)
*/
export function sanitizeSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (event.request && typeof event.request === 'object') {
    if ('data' in event.request) event.request.data = sanitizeDeep(event.request.data);
    if ('cookies' in event.request) event.request.cookies = '[REDACTED]';   // PKG-6 / D21: every cookie value can be a session credential
    if (event.request.headers) {
      event.request.headers = sanitizeDeep(event.request.headers);
    }
    if (event.request.query_string != null) {
      event.request.query_string = '[REDACTED_QUERY]';   // PKG-6 / D21: search text is free text (names, situations): never sent
    }
    if (event.request.url && event.request.url.includes('?')) {
      event.request.url = event.request.url.split('?')[0] + '?pii=scrubbed';
    }
  }

  if (event.user) {
    event.user = sanitizeDeep(event.user);
    if (event.user.id) event.user.id = "[MASQUÉ-RGPD]";
  }

  if (event.contexts) {
    event.contexts = sanitizeDeep(event.contexts);
    if (event.contexts.runtime) {
      delete event.contexts.runtime.env;
    }
  }

  if (event.extra) {
    event.extra = sanitizeDeep(event.extra);
  }
  
  if (event.tags) {
    event.tags = sanitizeDeep(event.tags);
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(sanitizeSentryBreadcrumb);
  }

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
  if (event.request && typeof event.request.data === 'string') event.request.data = '[REDACTED_BODY]';
  // an event that still carries a recognisable identifier after scrubbing is dropped, never sent
  try { if (containsIdentifiers(JSON.stringify(event))) return null; } catch { return null; }
  return event;
}

const CODE_MESSAGE = /^[A-Z][A-Z0-9_]{2,63}$/;
/** @param {unknown} m */
function safeMessage(m) {
  if (m == null) return m;
  const s = String(m).trim();
  return CODE_MESSAGE.test(s) ? s : '[message removed: may contain request data]';
}

/**
 * Launch-readiness item 68: performance traces were sampled at 100 % (every request, its route and timing, sent to the provider); 10 % by default now, set by
 * SENTRY_TRACES_SAMPLE_RATE (0 to 1). Errors are not sampled. The DSN must be in the EU region (*.ingest.de.sentry.io: release preflight + CSP);
 * sendDefaultPii stays false (no IP, cookie or header is attached by the SDK).
 */
export function tracesSampleRate(raw = process.env.SENTRY_TRACES_SAMPLE_RATE) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0.1;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.1;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    sendDefaultPii: false,
    tracesSampleRate: tracesSampleRate(),
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
    beforeSend: sanitizeSentryEvent,
  });
}

export default Sentry;
