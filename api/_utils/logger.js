import pino from 'pino';
import { env } from './env.js';
import { redactForLog, redactText } from './redact.js';

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
            try {
                if (args && args.length > 0 && args[0] && typeof args[0] === 'object') {
                    args[0] = redactForLog(args[0]);
                }
                // PKG-6 / D21: message strings (and printf arguments) are masked too.
                for (let i = 0; i < (args ? args.length : 0); i += 1) {
                    if (typeof args[i] === 'string') args[i] = redactText(args[i]);
                }
            } catch {
                // Best-effort only: logging must never crash the request.
            }
            return method.apply(this, args);
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
