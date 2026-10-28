// @ts-nocheck
/**
 * Privacy-safe error boundary for /api/diagnostic (DTA S1 stage 2a).
 *
 * Root cause it removes (N9, FAIL_VERIFIED): the handler copied `err.message` into logger.error, SyncRun.error (a database row) and Sentry.
 * `JSON.parse` messages QUOTE a ~10-character window of the request body, upstream errors can carry response text (`err.detail`), and the Sentry
 * scrubber (sanitizeSentryEvent) only redacts extra/request/tags by KEY name — it never touches exception.values[].value.
 *
 * Rule: nothing derived from the request body, an upstream response, `err.message`, `err.detail`, `err.stack` or `err.cause` leaves the process.
 * Only the closed vocabulary below (code + fixed HTTP status) and an opaque request id are logged, stored or sent to telemetry.
 * PURE: no I/O (the Sentry client is injected by the caller).
 */
export const ERROR_CODES = Object.freeze({
  INVALID_JSON: 'INVALID_JSON',
  INVALID_BODY: 'INVALID_BODY',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INPUT_NOT_SUPPORTED: 'INPUT_NOT_SUPPORTED',
  ENGINE_UNAVAILABLE: 'ENGINE_UNAVAILABLE',
  ENGINE_TIMEOUT: 'ENGINE_TIMEOUT',
  ENGINE_NETWORK_ERROR: 'ENGINE_NETWORK_ERROR',
  ENGINE_CIRCUIT_OPEN: 'ENGINE_CIRCUIT_OPEN',
  ENGINE_HTTP_ERROR: 'ENGINE_HTTP_ERROR',
  TRACE_DISABLED: 'TRACE_DISABLED',
  HEALTHCHECK_FAILED: 'HEALTHCHECK_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});
const CODE_SET = new Set(Object.values(ERROR_CODES));
/** Faults of the caller: not an incident, nothing is sent to telemetry. */
const CLIENT_FAULT = new Set([ERROR_CODES.INVALID_JSON, ERROR_CODES.INVALID_BODY, ERROR_CODES.VALIDATION_ERROR, ERROR_CODES.INPUT_NOT_SUPPORTED, ERROR_CODES.TRACE_DISABLED]);

// the ONLY message text this module ever inspects: the fixed string thrown by openfiscaClient.trace() when tracing is switched off (no user data)
const TRACE_DISABLED_MESSAGE = 'OpenFisca trace is disabled in this environment';
const BY_ERROR_CODE = Object.freeze({
  INVALID_JSON_BODY: ERROR_CODES.INVALID_JSON,                 // thrown by parseJsonBody() below; a bare SyntaxError from anywhere else is an INTERNAL_ERROR, not a client fault
  LOCAL_SIMULATION_INVALID_INPUT: ERROR_CODES.INPUT_NOT_SUPPORTED,
  OPENFISCA_TIMEOUT: ERROR_CODES.ENGINE_TIMEOUT,
  OPENFISCA_NETWORK_ERROR: ERROR_CODES.ENGINE_NETWORK_ERROR,
  OPENFISCA_CIRCUIT_BREAKER_OPEN: ERROR_CODES.ENGINE_CIRCUIT_OPEN,
  OPENFISCA_HTTP_ERROR: ERROR_CODES.ENGINE_HTTP_ERROR,
});

/**
 * JSON.parse for request bodies that discards the original SyntaxError: V8 quotes a window of the body in its message, so the original must never
 * travel further.  Throws a fresh error carrying only the fixed code.
 */
export function parseJsonBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    const e = new Error(ERROR_CODES.INVALID_JSON);
    e.code = 'INVALID_JSON_BODY';
    throw e;
  }
}

/** Map ANY thrown value to a code of the closed vocabulary.  Never returns, copies or logs a message. */
export function classifyError(err) {
  if (err && typeof err === 'object' && err.name === 'AbortError') return ERROR_CODES.ENGINE_TIMEOUT;
  const c = err && typeof err === 'object' ? err.code : undefined;
  if (typeof c === 'string' && Object.prototype.hasOwnProperty.call(BY_ERROR_CODE, c)) return BY_ERROR_CODE[c];
  if (err && typeof err === 'object' && err.message === TRACE_DISABLED_MESSAGE) return ERROR_CODES.TRACE_DISABLED;
  if (err && typeof err === 'object' && err.fallback === true) return ERROR_CODES.ENGINE_UNAVAILABLE;
  return ERROR_CODES.INTERNAL_ERROR;
}
export const isClientFault = (code) => CLIENT_FAULT.has(code);

/** Fixed, caller-safe text for the same-name response fields (identical to the strings the API already returned). */
export const SAFE_MESSAGES = Object.freeze({
  ENGINE_FALLBACK: 'Le simulateur national des aides est momentanément indisponible. Veuillez réessayer plus tard.',
});

/**
 * Sanitized telemetry: a synthetic Error whose message IS the allowlisted code (no stack/cause/detail of the original), plus tags/extra restricted to
 * allowlisted scalars.  The original exception object is never passed to Sentry.
 */
export function captureSafe(Sentry, code, { requestId = null, phase = null, durationMs = null, level = 'error' } = {}) {
  if (!CODE_SET.has(code) || isClientFault(code)) return false;
  const e = new Error(code);
  e.name = 'DiagnosticError';
  Sentry.captureException(e, {
    level,
    tags: { service: 'diagnostic', errorCode: code },
    extra: { requestId: typeof requestId === 'string' ? requestId.slice(0, 64) : null, phase: typeof phase === 'string' ? phase.slice(0, 32) : null, duration_ms: Number.isFinite(durationMs) ? durationMs : null },
  });
  return true;
}
