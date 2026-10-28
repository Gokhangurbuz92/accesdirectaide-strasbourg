/**
 * Redaction helpers for logs and observability.
 *
 * Goals:
 * - Never log secrets (tokens, passwords, cookies, authorization headers, API keys, DB URLs with creds).
 * - Mask common PII (email, phone).
 * - Avoid logging request bodies.
 * - Keep logs bounded (truncate long strings, cap large arrays/objects).
 */

const EMAIL_REGEX = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const PHONE_REGEX = /(\b(?:\+33|0)[1-9](?:[\s.-]*\d{2}){4}\b)/g;
// PKG-6 / D21 (found by the real-sink test: these reached stdout in clear). Applied before the phone pattern; masking too much is the safe failure.
// French NIR (sécurité sociale), grouped or not: sex, year, month, department (incl. 2A/2B), commune, order, key (the key is required, so 13-digit epoch milliseconds are not matched).
const NIR_REGEX = /\b[12][\s.]?\d{2}[\s.]?(?:0[1-9]|1[0-2]|[2-9]\d)[\s.]?(?:\d{2}|2[AB])[\s.]?\d{3}[\s.]?\d{3}[\s.]?\d{2}\b/gi;
// IBAN: country, check digits, 11-30 alphanumerics, grouped by 4 or not.
const IBAN_REGEX = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g;
// Payment card: 15-16 digits (grouped by 4 or not) that pass the Luhn check (13-digit epoch milliseconds are not matched).
const CARD_REGEX = /\b(?:\d[ -]?){14,15}\d\b/g;
/** @param {string} digits */
function luhn(digits) {
  let sum = 0; let dbl = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) { let d = Number(digits[i]); if (dbl) { d *= 2; if (d > 9) d -= 9; } sum += d; dbl = !dbl; }
  return sum % 10 === 0;
}

const SENSITIVE_KEY_REGEX = /(token|secret|authorization|cookie|password|jwt|api[_-]?key|private[_-]?key|access[_-]?key|session|nir|iban|prompt|response|dossier|diagnostic)/i;
const BODY_KEY_REGEX = /(^body$|payload|raw|content|html|markdown)/i;

const DEFAULT_MAX_STRING = 200;
const MAX_QUERY_STRING = 80;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 6;

/** @param {string} email */
function maskEmail(email) {
  if (!email) return email;
  const [local, domain] = String(email).split('@');
  if (!domain) return email;
  const safeLocal = local.length > 1 ? `${local[0]}***` : '***';
  return `${safeLocal}@${domain}`;
}

/** @param {string} phone */
function maskPhone(phone) {
  if (!phone) return phone;
  const clean = String(phone).replace(/[\s.-]/g, '');
  if (clean.length < 6) return '******';
  return `${clean.slice(0, 2)}******${clean.slice(-2)}`;
}

/** @param {string} value @param {number} maxLen */
function truncateString(value, maxLen) {
  const s = String(value);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}...`;
}

/** NIR, IBAN and payment card numbers inside free text. @param {string} s */
function maskIdentifiers(s) {
  return s
    .replace(NIR_REGEX, '[NIR]')
    .replace(IBAN_REGEX, '[IBAN]')
    .replace(CARD_REGEX, (m) => { const d = m.replace(/[ -]/g, ''); return (d.length === 15 || d.length === 16) && luhn(d) ? '[CARTE]' : m; });
}

/** @param {unknown} value @param {{ maxLen?: number }=} options */
function sanitizeString(value, { maxLen = DEFAULT_MAX_STRING } = {}) {
  if (value == null) return value;
  let s = maskIdentifiers(String(value));
  s = s.replace(EMAIL_REGEX, (m) => maskEmail(m));
  s = s.replace(PHONE_REGEX, (m) => maskPhone(m));
  return truncateString(s, maxLen);
}

/** @param {unknown} error */
function sanitizeError(error) {
  if (!(error instanceof Error)) return sanitizeString(error);
  return {
    name: error.name,
    message: sanitizeString(error.message, { maxLen: DEFAULT_MAX_STRING }),
    stack: typeof error.stack === 'string' ? sanitizeString(error.stack, { maxLen: 2000 }) : undefined,
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Redact an arbitrary value for safe logging.
 *
 * @param {unknown} value
 * @param {{ depth?: number }=} options
 * @returns {unknown}
 */
export function redactValue(value, options = {}) {
  const depth = options.depth ?? 0;
  if (value == null) return value;

  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return sanitizeError(value);

  if (depth >= MAX_DEPTH) return '[Truncated]';

  if (Array.isArray(value)) {
    const sliced = value.slice(0, MAX_ARRAY_ITEMS);
    return sliced.map((v) => redactValue(v, { depth: depth + 1 }));
  }

  if (isPlainObject(value)) {
    /** @type {Record<string, unknown>} */
    const out = {};
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    for (const [rawKey, rawVal] of entries) {
      const key = String(rawKey);
      const lower = key.toLowerCase();

      if (SENSITIVE_KEY_REGEX.test(lower)) {
        out[key] = '[REDACTED]';
        continue;
      }

      if (BODY_KEY_REGEX.test(lower)) {
        out[key] = '[REDACTED_BODY]';
        continue;
      }

      const maxLen =
        lower === 'q' || lower.includes('query') || lower.includes('search')
          ? MAX_QUERY_STRING
          : DEFAULT_MAX_STRING;

      if (typeof rawVal === 'string') {
        out[key] = sanitizeString(rawVal, { maxLen });
        continue;
      }

      out[key] = redactValue(rawVal, { depth: depth + 1 });
    }
    return out;
  }

  // Unknown structured types (Map, Set, Buffer, streams) -> string tag only
  try {
    const tag = Object.prototype.toString.call(value);
    return sanitizeString(tag);
  } catch {
    return '[Unserializable]';
  }
}

/** PKG-6 / D21: true when a regex-recognisable identifier (e-mail, phone, NIR, IBAN, Luhn-valid card) is present. @param {string} text */
export function containsIdentifiers(text) {
  const s = String(text || '');
  return maskIdentifiers(s) !== s || new RegExp(EMAIL_REGEX.source).test(s) || new RegExp(PHONE_REGEX.source).test(s);
}

/**
 * PKG-6 / D21 — a log MESSAGE string (logger.info('…')): same masking as values, longer bound. Before this, string-only log calls were not redacted at all.
 * @param {unknown} value
 */
export function redactText(value) {
  return sanitizeString(value, { maxLen: 2000 });
}

/**
 * Convenience for logger hooks: always returns a plain object suitable for JSON logs.
 *
 * @param {unknown} obj
 * @returns {Record<string, unknown>}
 */
export function redactForLog(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const redacted = redactValue(obj);
  return isPlainObject(redacted) ? redacted : { value: redacted };
}
