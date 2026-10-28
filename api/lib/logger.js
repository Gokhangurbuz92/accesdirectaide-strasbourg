// @ts-nocheck

/**
 * GDPR Compliant Logger with LOG_LEVEL support
 * Ensures PII is masked before being written to stdout/logs.
 *
 * LOG_LEVEL env var controls verbosity:
 *   error > warn > info > debug
 * Default: 'info' in production, 'debug' in development
 */

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function getConfiguredLevel() {
    const env = (process.env.LOG_LEVEL || '').toLowerCase().trim();
    // @ts-ignore
    if (env && LOG_LEVELS[env] !== undefined) return LOG_LEVELS[env];
    // Default: info in prod, debug in dev
    return process.env.NODE_ENV === 'production' ? LOG_LEVELS.info : LOG_LEVELS.debug;
}

const CURRENT_LEVEL = getConfiguredLevel();

function shouldLog(level) {
    return (LOG_LEVELS[level] ?? LOG_LEVELS.info) <= CURRENT_LEVEL;
}

// Simple regex for emails
const EMAIL_REGEX = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
// Simple regex for phones (loose matching)
const PHONE_REGEX = /(\b(?:\+33|0)[1-9](?:[\s.-]*\d{2}){4}\b)/g;

/**
 * Masks an email address: jules@example.com -> j***@example.com
 * @param {string} email
 */
function maskEmail(email) {
    if (!email) return email;
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    const [local, domain] = parts;
    const maskedLocal = local.length > 1 ? local[0] + '***' : '***';
    return `${maskedLocal}@${domain}`;
}

/**
 * Masks a phone number: 0612345678 -> 06******78
 * @param {string} phone
 */
function maskPhone(phone) {
    if (!phone) return phone;
    const clean = phone.replace(/[\s.-]/g, '');
    if (clean.length < 6) return '******';
    return clean.substring(0, 2) + '******' + clean.substring(clean.length - 2);
}

/**
 * Recursively masks PII in objects/strings
 */
// @ts-ignore
export function mask(input) {
    if (!input) return input;

    if (typeof input === 'string') {
        let output = input.replace(EMAIL_REGEX, (match) => maskEmail(match));
        output = output.replace(PHONE_REGEX, (match) => maskPhone(match));
        return output;
    }

    if (Array.isArray(input)) {
        return input.map(mask);
    }

    if (typeof input === 'object') {
        if (input instanceof Date) return input;

        const copy = { ...input };
        for (const key in copy) {
            // Check for specific keys that might contain PII even if regex misses
            if (/email/i.test(key) && typeof copy[key] === 'string') {
                copy[key] = maskEmail(copy[key]);
            } else if (/(phone|tel|mobile)/i.test(key) && typeof copy[key] === 'string') {
                copy[key] = maskPhone(copy[key]);
            } else if (/(password|secret|token|key|auth|cookie|nir|iban|prompt|response|dossier|diagnostic)/i.test(key)) {
                copy[key] = '[REDACTED]';
            } else {
                copy[key] = mask(copy[key]);
            }
        }
        return copy;
    }

    return input;
}

/**
 * Truncate large data payloads to prevent Vercel log truncation (>4MB).
 * @param {unknown} data
 * @param {number} maxLen
 * @returns {string}
 */
function safeStringify(data, maxLen = 8000) {
    try {
        const str = JSON.stringify(mask(data), null, 2);
        if (str.length > maxLen) {
            return str.substring(0, maxLen) + '\n... [TRUNCATED]';
        }
        return str;
    } catch {
        return '[UNSERIALIZABLE]';
    }
}

/**
 * Logs a message with masked data.
 * @param {string} message
 * @param {any} data
 */
export function maskedLog(message, data = null) {
    if (data) {
        console.log(message, safeStringify(data));
    } else {
        console.log(message);
    }
}

export const logger = {
    // @ts-ignore
    info: (msg, data) => {
        if (shouldLog('info')) maskedLog(`[INFO] ${msg}`, data);
    },
    // @ts-ignore
    error: (msg, err) => {
        if (!shouldLog('error')) return;
        const maskedErr = err instanceof Error ? { message: mask(err.message), stack: err.stack } : mask(err);
        console.error(`[ERROR] ${msg}`, safeStringify(maskedErr));
    },
    // @ts-ignore
    warn: (msg, data) => {
        if (shouldLog('warn')) maskedLog(`[WARN] ${msg}`, data);
    },
    debug: (/** @type {string | number | boolean | null | undefined} */ msg, /** @type {string | number | boolean | null | undefined} */ data) => {
        if (shouldLog('debug')) maskedLog(`[DEBUG] ${msg}`, data);
    },
    mask
};
