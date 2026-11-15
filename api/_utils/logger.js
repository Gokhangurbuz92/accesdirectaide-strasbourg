import pino from 'pino';
import { env } from './env.js';
import { redactForLog, redactText, redactValue } from './redact.js';
import { normalizeLogArgs } from './log-args.js';

const environment = env.runtime.vercelEnv;
const release = env.sentry.release;

const logger = pino({
    level: env.runtime.logLevel,
    base: {
        env: environment,
        service: 'api',
        release: release
    },
    formatters: {
        level: (label) => {
            return { level: label };
        },
    },
    hooks: {
        // Ensure every log line is safe: redact common secrets/PII and avoid logging bodies.
        logMethod(args, method) {
            /** @type {any[]} */ let out = args;
            try {
                // RA-02: `(message, object | Error)` is rewritten to pino's `(object, message)` — pino drops what follows a message without a placeholder.
                // Done BEFORE redaction, so the merged fields are masked like any object-first call.
                out = /** @type {any[]} */ (normalizeLogArgs(/** @type {unknown[]} */ (args)));
                if (out.length > 0 && out[0] && typeof out[0] === 'object') {
                    out[0] = redactForLog(out[0]);
                }
                // PKG-6 / D21: message strings (and printf arguments) are masked too. RA-02: an object given to a printf placeholder (%o, %j) as well.
                for (let i = 0; i < out.length; i += 1) {
                    if (typeof out[i] === 'string') out[i] = redactText(out[i]);
                    else if (i > 0 && out[i] && typeof out[i] === 'object') out[i] = redactValue(out[i]);
                }
            } catch {
                // Best-effort only: logging must never crash the request.
            }
            return method.apply(this, /** @type {any} */ (out));
        },
    },
    // Redact sensitive keys if necessary
    redact: {
        paths: [
            'email', 'citizenEmail', 'password', 'token', 'req.headers.authorization',
            'mfaSecret', 'outlookToken', 'phone'
        ],
        censor: '[MASQUÉ - RGPD]'
    }
});

export default logger;
