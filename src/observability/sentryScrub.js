/**
 * Browser error tracking (Sentry, EU region) — data minimisation, applied before anything leaves the browser (beforeSend / beforeBreadcrumb).
 * Errors only: no tracing, no Session Replay, no release-health session. What may leave: the error description (personal parts removed), the browser
 * and operating system (User-Agent), the page path without parameters. What never leaves: e-mail, IP, identity (event.user), query strings and
 * fragments, cookies, other headers, request / extra bodies, tokens and identifiers in paths, form contents (ui.input breadcrumbs), console output.
 * Pure functions: tested by tests/unit/sentry-eu-scrub.test.js. The legal pages describe exactly this list (src/pages/Confidentialite.jsx, Cookies.jsx).
 */

export const ID = '[id]';

/** the only Sentry ingest origin the CSP allows (vercel.json connect-src https://*.ingest.de.sentry.io): o<id>.ingest.de.sentry.io (EU region, Frankfurt) */
export const SENTRY_EU_INGEST_HOST = /^o\d+\.ingest\.de\.sentry\.io$/;

/** is this DSN one of the EU region? (browser and server: nothing is sent to another region) @param {unknown} dsn */
export function sentryDsnIsEu(dsn) {
  if (typeof dsn !== 'string' || !dsn) return false;
  try { return SENTRY_EU_INGEST_HOST.test(new URL(dsn).hostname); } catch { return false; }
}

/** paths whose dynamic parts are personal (share / passport links, reset tokens, appointments, shared files): every segment after the prefix is masked */
const DYNAMIC_PREFIXES = [['share'], ['passport'], ['reset-password'], ['rdv'], ['compte', 'partages']];

/** a token-like segment: 20 characters or more of [A-Za-z0-9_-] */
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]{20,}$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** errors raised by browser extensions are not the site's (and could carry the extension's own data) */
export const SENTRY_DENY_URLS = [/^chrome-extension:\/\//i, /^moz-extension:\/\//i, /^safari-extension:\/\//i, /^safari-web-extension:\/\//i,
  /^ms-browser-extension:\/\//i, /^edge-extension:\/\//i];

/** the breadcrumb categories never sent: what the person typed, and the console (which may print anything) */
export const DROPPED_BREADCRUMB_CATEGORIES = ['ui.input', 'console'];

/** @param {string} path a path without query or fragment */
function scrubPath(path) {
  const parts = path.split('/');
  const out = parts.map((seg) => (TOKEN_SEGMENT.test(seg) ? ID : seg));
  for (const prefix of DYNAMIC_PREFIXES) {
    for (let i = 0; i + prefix.length <= parts.length; i += 1) {
      if (prefix.every((p, j) => parts[i + j] === p)) {
        for (let k = i + prefix.length; k < parts.length; k += 1) if (parts[k] !== '') out[k] = ID;
      }
    }
  }
  return out.join('/');
}

/**
 * The URL without query string, fragment or personal path parts. Keeps scheme and host (the site's own, or a script's origin).
 * @param {unknown} url @returns {unknown}
 */
export function scrubUrl(url) {
  if (typeof url !== 'string') return url;
  const cut = url.split(/[?#]/)[0];
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)(\/.*)?$/i.exec(cut);
  if (m) return m[1] + (m[2] ? scrubPath(m[2]) : '');
  return scrubPath(cut);
}

/**
 * Free text (an error message, a breadcrumb message): e-mail addresses, URLs and site paths inside it are scrubbed.
 * @param {unknown} text @returns {unknown}
 */
export function scrubText(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(EMAIL, '[email]')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)]+/gi, (u) => String(scrubUrl(u)))
    .replace(/(^|[\s'"(])(\/[^\s'"<>)]*)/g, (_all, pre, p) => pre + String(scrubUrl(p)));
}

/** a tag: a route without its leading slash (« share/<token> ») is a path too @param {unknown} v */
function scrubTag(v) {
  if (typeof v !== 'string') return v;
  return /^[^\s]*\/[^\s]*$/.test(v) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? scrubUrl(v) : scrubText(v);
}

/** @param {any} frame */
function scrubFrame(frame) {
  if (!frame || typeof frame !== 'object') return frame;
  if (frame.filename) frame.filename = scrubUrl(frame.filename);
  if (frame.abs_path) frame.abs_path = scrubUrl(frame.abs_path);
  delete frame.vars;
  return frame;
}

/**
 * One breadcrumb: null to drop it. fetch / xhr keep method, scrubbed URL and status only; navigation keeps scrubbed from / to.
 * @param {any} crumb @returns {any}
 */
export function scrubBreadcrumb(crumb) {
  if (!crumb || typeof crumb !== 'object') return null;
  if (DROPPED_BREADCRUMB_CATEGORIES.includes(crumb.category)) return null;
  const out = { ...crumb };
  if (out.message) out.message = scrubText(out.message);
  const d = out.data && typeof out.data === 'object' ? out.data : null;
  if (out.category === 'fetch' || out.category === 'xhr' || out.category === 'http') {
    out.data = d ? { method: d.method, url: scrubUrl(d.url), status_code: d.status_code } : undefined;
  } else if (out.category === 'navigation') {
    out.data = d ? { from: scrubUrl(d.from), to: scrubUrl(d.to) } : undefined;
  } else if (d) {
    /** @type {Record<string, unknown>} */ const kept = {};
    for (const [k, v] of Object.entries(d)) if (typeof v === 'number' || typeof v === 'boolean') kept[k] = v; else if (typeof v === 'string') kept[k] = scrubText(v);
    out.data = kept;
  }
  if (out.data === undefined) delete out.data;
  return out;
}

/**
 * The whole event, before it is sent. Never throws a personal value through: identity, bodies, cookies and headers (except User-Agent) are deleted.
 * @param {any} event @returns {any}
 */
export function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;
  delete event.user;
  delete event.extra;
  delete event.server_name;
  if (event.request) {
    const h = event.request.headers && typeof event.request.headers === 'object' ? event.request.headers : {};
    const uaKey = Object.keys(h).find((k) => k.toLowerCase() === 'user-agent');
    const ua = uaKey ? h[uaKey] : undefined;
    // every other header goes: x-forwarded-for, x-real-ip, cf-connecting-ip, authorization, cookie, referer …; data, cookies, query_string, env too
    event.request = { url: scrubUrl(event.request.url), ...(typeof ua === 'string' ? { headers: { [String(uaKey)]: ua } } : {}) };
    if (!event.request.url) delete event.request.url;
  }
  if (event.contexts) {
    if (event.contexts.runtime) delete event.contexts.runtime.env;
    delete event.contexts.state;   // redux-like state snapshots
  }
  if (event.transaction) event.transaction = scrubText(scrubUrl(event.transaction));
  if (event.contexts?.http && typeof event.contexts.http.path === 'string') event.contexts.http.path = scrubUrl(event.contexts.http.path);
  if (event.message) event.message = typeof event.message === 'string' ? scrubText(event.message) : { ...event.message, formatted: scrubText(event.message.formatted), message: scrubText(event.message.message), params: undefined };
  if (event.logentry) event.logentry = { message: scrubText(event.logentry.message) };
  if (event.tags && typeof event.tags === 'object') for (const k of Object.keys(event.tags)) event.tags[k] = scrubTag(event.tags[k]);
  for (const ex of event.exception?.values || []) {
    ex.value = scrubText(ex.value);
    for (const f of ex.stacktrace?.frames || []) scrubFrame(f);
  }
  for (const f of event.stacktrace?.frames || []) scrubFrame(f);
  if (Array.isArray(event.breadcrumbs)) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean);
  else if (event.breadcrumbs && Array.isArray(event.breadcrumbs.values)) event.breadcrumbs = event.breadcrumbs.values.map(scrubBreadcrumb).filter(Boolean);
  return event;
}

/**
 * The integrations kept from the SDK defaults: everything except the release-health session (errors only).
 * @param {{ name: string }[]} defaults
 */
export function keptDefaultIntegrations(defaults) {
  return defaults.filter((i) => i.name !== 'BrowserSession');
}
