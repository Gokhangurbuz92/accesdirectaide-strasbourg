/**
 * @ada/shared/logger — Lightweight Structured Logger
 *
 * For use in packages/ (which don't have access to api/_utils/logger.js).
 * Outputs JSON lines compatible with Pino format for unified log analysis.
 *
 * In production, api/ continues using its full Pino logger with Sentry + PII redaction.
 * This logger is for packages/ai-engine, packages/legal-tools, etc.
 *
 * Usage:
 *   import { logger } from '@ada/shared/logger';
 *   logger.info('Embedding generated', { model: 'gemini-embedding-001', dims: 768 });
 *   logger.audit('user_123', 'diagnostic_run', 'openfisca');
 */

const SERVICE = process.env.SERVICE_NAME || 'ada-packages';

/**
 * @param {'info' | 'warn' | 'error' | 'debug' | 'audit'} level
 * @param {string} msg
 * @param {object} [meta]
 */
function log(level, msg, meta = {}) {
    const entry = {
        level,
        time: Date.now(),
        service: SERVICE,
        msg,
        ...meta,
    };

    switch (level) {
        case 'error':
            console.error(JSON.stringify(entry));
            break;
        case 'warn':
            console.warn(JSON.stringify(entry));
            break;
        case 'debug':
            if (process.env.NODE_ENV === 'development' || process.env.LOG_LEVEL === 'debug') {
                console.debug(JSON.stringify(entry));
            }
            break;
        default:
            console.log(JSON.stringify(entry));
    }
}

export const logger = {
    /**
     * @param {string} msg
     * @param {object} [meta]
     */
    info: (msg, meta) => log('info', msg, meta),

    /**
     * @param {string} msg
     * @param {object} [meta]
     */
    warn: (msg, meta) => log('warn', msg, meta),

    /**
     * @param {string} msg
     * @param {Error | object} [error]
     */
    error: (msg, error) =>
        log('error', msg, {
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
        }),

    /**
     * @param {string} msg
     * @param {object} [meta]
     */
    debug: (msg, meta) => log('debug', msg, meta),

    /**
     * RGPD-compliant audit log.
     * @param {string} userId — Anonymized user identifier
     * @param {string} action — What was done (e.g. 'diagnostic_run')
     * @param {string} resource — What was accessed (e.g. 'openfisca')
     */
    audit: (userId, action, resource) =>
        log('audit', `${action}:${resource}`, { userId, action, resource }),
};

export default logger;
