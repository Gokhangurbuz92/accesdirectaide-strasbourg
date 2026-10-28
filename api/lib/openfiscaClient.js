// @ts-nocheck
import { logger } from './logger.js';
import * as Sentry from '@sentry/node';
import { captureSafe, classifyError } from './diagnosticErrors.js';

/**
 * OpenFisca France API client with Circuit Breaker and Strict Timeout.
 * Encapsulates /calculate and /trace calls with PII protection.
 */

// Canonical key is OPENFISCA_URL. Aliases OPENFISCA_API_URL and OPENFISCA_URL are supported for backward compatibility.
const RAW_URL = process.env.OPENFISCA_URL || process.env.OPENFISCA_API_URL || process.env.OPENFISCA_URL || 'https://api.fr.openfisca.org/latest';
const OPENFISCA_URL = RAW_URL.replace(/\/+$/, ''); // normalise: strip trailing slash(es)
const OPENFISCA_TIMEOUT_MS = 5000; // Strict 5000ms timeout
const OPENFISCA_ENABLE_TRACE = process.env.OPENFISCA_ENABLE_TRACE === 'true';

// Enforce Public Prototype Safety Gate
if (OPENFISCA_URL.includes('api.fr.openfisca.org')) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('OPENFISCA_PROTOTYPE_ENDPOINT_FORBIDDEN_IN_PRODUCTION: The public api.fr.openfisca.org endpoint is unstable and strictly forbidden in production. You MUST host your own OpenFisca instance and set OPENFISCA_URL.');
    }
    if (process.env.ALLOW_OPENFISCA_PUBLIC_PROTOTYPE !== 'true') {
        throw new Error('OPENFISCA_PROTOTYPE_ENDPOINT_BLOCKED: Using the public api.fr.openfisca.org endpoint requires explicit opt-in via ALLOW_OPENFISCA_PUBLIC_PROTOTYPE=true in development.');
    }
}

/* ── Health probe cache (60 s TTL) ─────────────────────────── */
const HEALTH_CACHE_TTL_MS = 60_000;
let _healthCache = { available: null, checkedAt: 0 };

/* ── Circuit Breaker State ─────────────────────────── */
let _circuitBreaker = {
    failures: 0,
    lastFailureTime: 0,
    isOpen: false
};
const CB_THRESHOLD = 5;
const CB_RESET_TIMEOUT_MS = 30_000; // 30s half-open

/**
 * @param {string} endpoint
 */
function recordFailure(endpoint) {
    _circuitBreaker.failures++;
    _circuitBreaker.lastFailureTime = Date.now();
    if (_circuitBreaker.failures >= CB_THRESHOLD && !_circuitBreaker.isOpen) {
        logger.warn(`[OpenFisca] Circuit Breaker OPENED after ${_circuitBreaker.failures} failures`);
        _circuitBreaker.isOpen = true;
    }
}

function resetCircuitBreaker() {
    if (_circuitBreaker.failures > 0) {
        _circuitBreaker.failures = 0;
        if (_circuitBreaker.isOpen) {
            logger.info('[OpenFisca] Circuit Breaker CLOSED (recovery)');
            _circuitBreaker.isOpen = false;
        }
    }
}

/**
 * Make a POST request to OpenFisca with strict timeout and Circuit Breaker.
 * @param {string} endpoint - '/calculate' or '/trace'
 * @param {object} payload - OpenFisca situation JSON
 * @returns {Promise<object>} OpenFisca response
 */
async function post(endpoint, payload) {
    const now = Date.now();

    // Circuit Breaker check
    if (_circuitBreaker.isOpen) {
        if (now - _circuitBreaker.lastFailureTime > CB_RESET_TIMEOUT_MS) {
            _circuitBreaker.isOpen = false; // Half-open, let one pass
        } else {
            const err = new Error("Le simulateur national des aides est momentanément indisponible. Veuillez réessayer plus tard.");
            err.fallback = true;
            err.status = 503;
            err.code = 'OPENFISCA_CIRCUIT_BREAKER_OPEN';
            throw err;
        }
    }

    const url = `${OPENFISCA_URL}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPENFISCA_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const err = new Error(`OpenFisca ${endpoint} returned ${res.status}`);
            err.status = res.status;
            err.code = 'OPENFISCA_HTTP_ERROR';
            err.detail = text.slice(0, 200); // limit logged detail
            
            if (res.status >= 500) recordFailure(endpoint);
            throw err;
        }

        resetCircuitBreaker();
        return await res.json();
    } catch (err) {
        clearTimeout(timer);
        recordFailure(endpoint);

        // Privacy (DTA S1 stage 2a): the raw error is NEVER forwarded — `err.detail` is the first 200 chars of the upstream response body, which may echo the
        // request, and exception messages are not covered by the Sentry key-based scrubber.  Only a closed-vocabulary code and the endpoint name are sent.
        captureSafe(Sentry, classifyError(err), { phase: String(endpoint).replace(/[^a-z/]/gi, '').slice(0, 32), level: 'warning' });

        // Return friendly 503 instead of crashing
        const friendlyErr = new Error("Le simulateur national des aides est momentanément indisponible. Veuillez réessayer plus tard.");
        friendlyErr.fallback = true;
        friendlyErr.status = 503;
        friendlyErr.code = /** @type {Error} */ (err).name === 'AbortError' ? 'OPENFISCA_TIMEOUT' : 'OPENFISCA_NETWORK_ERROR';
        throw friendlyErr;
    }
}

/**
 * Calculate rights via OpenFisca /calculate.
 * @param {object} situation - Full OpenFisca situation JSON (individus, familles, menages, foyers_fiscaux)
 * @returns {Promise<object>} OpenFisca calculation result
 */
export async function calculate(situation) {
    // Log without PII — only structure info
    logger.info('[OpenFisca] calculate request', {
        individuCount: Object.keys(situation.individus || {}).length,
        hasFamily: !!situation.familles,
    });

    const result = await post('/calculate', situation);

    logger.info('[OpenFisca] calculate success');
    return result;
}

/**
 * Get trace via OpenFisca /trace (for pro/admin debugging).
 * Only enabled when OPENFISCA_ENABLE_TRACE=true or explicitly requested.
 * @param {object} situation - Full OpenFisca situation JSON
 * @returns {Promise<object>} OpenFisca trace result
 */
export async function trace(situation) {
    if (!OPENFISCA_ENABLE_TRACE) {
        const err = new Error('OpenFisca trace is disabled in this environment');
        err.code = 'OPENFISCA_TRACE_DISABLED';
        throw err;
    }

    logger.info('[OpenFisca] trace request');
    const result = await post('/trace', situation);

    logger.info('[OpenFisca] trace success');
    return result;
}

/**
 * Check if OpenFisca is reachable (health check).
 * Uses a 60-second TTL cache to avoid hammering the upstream on every request.
 * @returns {Promise<boolean>}
 */
export async function isAvailable() {
    const now = Date.now();
    if (_healthCache.available !== null && (now - _healthCache.checkedAt) < HEALTH_CACHE_TTL_MS) {
        return _healthCache.available;
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${OPENFISCA_URL}/spec`, {
            signal: controller.signal,
        });
        clearTimeout(timer);
        _healthCache = { available: res.ok, checkedAt: now };
        return res.ok;
    } catch {
        _healthCache = { available: false, checkedAt: now };
        return false;
    }
}

export default { calculate, trace, isAvailable };
