/**
 * RA-02 — one place that accepts both call orders of the two project loggers, so no call site loses its data.
 *
 * The pino logger (api/_utils/logger.js) is `(object, message)`; pino silently DROPS what follows a message without a printf placeholder, so
 * `logger.error('CRITICAL HANDLER CRASH:', err)` printed the sentence and nothing else (api/index.js is byte-pinned and calls it that way). The console
 * logger (api/lib/logger.js) is `(message, data)`; called pino-style it printed « [WARN] [object Object] ». Both now go through the functions below
 * BEFORE redaction: what is merged here is masked exactly like an object passed in the canonical order.
 *
 * Canonical form for new code: `logger.info({ fields }, 'message')` with api/_utils/logger.js (tests/unit/ra02-logger-call-order.test.js holds a ratchet).
 */

const LEVEL_PLACEHOLDER = /%[sdoOjif]/;

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isPlain = (v) => { if (!v || typeof v !== 'object') return false; const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };

/**
 * Trailing arguments of a string-first call, folded into one object and a text suffix.
 * @param {unknown[]} rest @returns {{ fields: Record<string, unknown> | null, text: string[] }}
 */
function fold(rest) {
  /** @type {Record<string, unknown>} */ const fields = {}; /** @type {string[]} */ const text = []; let n = 0;
  const put = (/** @type {string} */ key, /** @type {unknown} */ value) => { let k = key; while (k in fields) { n += 1; k = `${key}${n + 1}`; } fields[k] = value; };
  for (const a of rest) {
    if (a === undefined || a === null) continue;
    if (a instanceof Error) put('err', a);
    else if (isPlain(a)) { for (const [k, v] of Object.entries(a)) put(k, v); }
    else if (typeof a === 'object') put('data', a);
    else if (typeof a === 'function' || typeof a === 'symbol') continue;
    else text.push(String(a));
  }
  return { fields: Object.keys(fields).length ? fields : null, text };
}

/**
 * pino call arguments → `[object, message]` (or `[message]`). Untouched: object-first calls, a lone message, and printf-style messages (`%s %d %o %j`),
 * which pino formats itself. @param {unknown[]} args @returns {unknown[]}
 */
export function normalizeLogArgs(args) {
  if (!Array.isArray(args) || args.length < 2 || typeof args[0] !== 'string') return args;
  if (LEVEL_PLACEHOLDER.test(args[0])) return args;
  const { fields, text } = fold(args.slice(1));
  const message = [args[0], ...text].join(' ');
  return fields ? [fields, message] : [message];
}

/**
 * `(message, data)` logger arguments, in either order → { message, data }. An object-first call keeps its object as data and takes the string that follows
 * (or the object's own `msg`) as the message; the message is never an object. @param {unknown} a @param {unknown} [b] @returns {{ message: string, data: unknown }}
 */
export function normalizeMessageData(a, b) {
  if (a !== null && typeof a === 'object') {
    if (typeof b === 'string') return { message: b, data: a };
    const own = !(a instanceof Error) && typeof (/** @type {any} */ (a)).msg === 'string' ? /** @type {any} */ (a).msg : '';
    const data = b !== undefined && b !== null && isPlain(a) && isPlain(b) ? { ...a, ...b } : a;
    return { message: a instanceof Error ? (a.name || 'Error') : own, data };
  }
  return { message: a === undefined || a === null ? '' : String(a), data: b === undefined ? null : b };
}
