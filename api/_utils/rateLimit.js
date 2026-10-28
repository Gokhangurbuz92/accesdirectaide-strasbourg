// @ts-nocheck
import logger from './logger.js';
// Rate Limiter: Upstash REST (Primary) + In-Memory Fallback
import crypto from 'crypto';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { env } from './env.js';
import { clientIp } from './client-ip.js';

// 1. Determine Backend Type
// STRICT: Only use REST API (Upstash / Vercel KV)
const envUrl = env.kv.url;
const envToken = env.kv.token;

// Robust check: must have URL starting with https:// and a token
const hasHttpKv = !!(envUrl && envUrl.startsWith('https://') && envToken);
const BACKEND_NAME = hasHttpKv ? "KV_REST_API" : "MEMORY";
const IS_PRODUCTION = env.runtime.vercelEnv === 'production';

logger.info(`[RateLimit] Init: Backend=${BACKEND_NAME} Env=${env.runtime.vercelEnv}`);

// 2. Initialize Clients
let redisClient = null; // Module-level singleton
const limiterCache = new Map(); // Cache for per-action limiters

if (hasHttpKv) {
    redisClient = new Redis({
        url: envUrl,
        token: envToken,
    });
}

// Fallback in-memory store
const memoryStore = new Map();

const CONFIG = {
    OTP_GEN: { limit: 3, window: 60 },      // 3 per min
    OTP_VERIFY: { limit: 5, window: 60 },   // 5 per min
    BOOK: { limit: 10, window: 3600 },      // 10 per hour
    CONFIRM: { limit: 10, window: 3600 },   // 10 per hour
    FEEDBACK: { limit: 6, window: 600 },    // 6 per 10 min
    CONTACT_FORM: { limit: 5, window: 3600 }, // PKG-11 / P20: public contact form, 5 per hour per IP
    CSP_REPORT: { limit: 20, window: 60 },
    EMAIL_CHANGE: { limit: 3, window: 3600 },  // launch-readiness item 66: address change requests, 3 per hour per account    // launch-readiness item 49: browser CSP violation reports, 20 per minute per IP (logged, never stored)
    DSR_EXPORT: { limit: 10, window: 3600 },  // PKG-11 audit: each export files a DSR request
    // Auth
    LOGIN_PRO: { limit: 5, window: 900 },   // 5 per 15 min
    REGISTER_PRO: { limit: 5, window: 3600 },  // 5 per hour
    MFA_VERIFY_PRO: { limit: 5, window: 900 }, // 5 per 15 min
    REGISTER_INVITE: { limit: 5, window: 3600 }, // 5 per hour
    REFRESH_PRO: { limit: 10, window: 900 },  // 10 per 15 min
    LOGIN_USER: { limit: 8, window: 900 },  // 8 per 15 min
    SIGNUP_USER: { limit: 5, window: 3600 }, // 5 per hour
    RESEND_VERIFY: { limit: 5, window: 3600 }, // 5 per hour
    FORGOT_USER: { limit: 5, window: 3600 }, // 5 per hour
    RESET_USER: { limit: 5, window: 3600 }, // 5 per hour
    RESET_PASSWORD: { limit: 3, window: 3600 }, // 3 per hour
    RDV_PUBLIC_READ: { limit: 60, window: 60 }, // 60/min per authenticated user+ip
    RDV_PUBLIC_WRITE: { limit: 10, window: 60 }, // 10/min per authenticated user+ip
    MESSAGE_USER_READ: { limit: 60, window: 60 }, // 60/min per user+ip
    MESSAGE_USER_SEND: { limit: 10, window: 300 }, // 10/5min per user+conversation+ip
    MESSAGE_USER_WRITE: { limit: 20, window: 300 }, // helper actions (create/get conversation)
    MESSAGE_PRO_READ: { limit: 120, window: 60 }, // 120/min per pro+ip
    MESSAGE_PRO_SEND: { limit: 20, window: 300 }, // 20/5min per pro+conversation+ip
    DOSSIER_REDEEM: { limit: 20, window: 300 },   // RC5: share-token redemption per pro+ip
    SHARE_CREATE: { limit: 60, window: 600 },     // PKG-11 / PUB-6: public dossier creation per address (native QA peak: 42 in 10 min)
    DOSSIER_REVOKE: { limit: 10, window: 300 },   // RC5: owner revocation per dossier+ip
    DOSSIER_GRANTS: { limit: 30, window: 300 },   // RC5: owner grant management per dossier+ip
    // Search & Taxonomy
    SEARCH_AIDES: { limit: 30, window: 60 },      // 30 per min
    SEARCH_STRUCTURES: { limit: 30, window: 60 }, // 30 per min
    SEARCH_RESSOURCES: { limit: 60, window: 60 }, // 60 per min
    DREES_API: { limit: 30, window: 60 },         // 30 per min
    TAXONOMY: { limit: 60, window: 60 },          // 60 per min
    // Assistant (AI)
    ASSISTANT_CHAT: { limit: 10, window: 60 },    // 10 per min
    ASSISTANT_RECOS: { limit: 15, window: 60 },   // 15 per min
    // Diagnostic (OpenFisca)
    DIAGNOSTIC: { limit: 30, window: 60 },        // 30 per min (was 10; raised to avoid E2E 429)
    // Admin
    ADMIN_API: { limit: 60, window: 60 },          // 60 per min per IP
    // PKG-1 citizen account (per user + ip)
    CITIZEN_ACCOUNT_READ: { limit: 60, window: 60 },
    CITIZEN_ACCOUNT_WRITE: { limit: 30, window: 60 },
    // R12: endpoints that called a provider, a model or the mailer without any limit
    ASSISTANT_FEEDBACK: { limit: 20, window: 600 },
    PDF_EXPORT: { limit: 30, window: 60 },        // public record PDF, per IP (CPU)
    FALC_SUMMARIZE: { limit: 10, window: 60 },    // model call, per IP
    PRO_INVITE: { limit: 30, window: 3600 },      // invitation e-mails, per member
};

function hashKey(/** @type {string} */ key) {
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 8);
}


// Action Classifications for Graceful Degradation
const PUBLIC_READ_ACTIONS = new Set([
    'SEARCH_AIDES', 'SEARCH_STRUCTURES', 'SEARCH_RESSOURCES', 
    'DREES_API', 'TAXONOMY', 'RDV_PUBLIC_READ', 'MESSAGE_USER_READ', 
    'MESSAGE_PRO_READ', 'ASSISTANT_CHAT', 'ASSISTANT_RECOS', 'DIAGNOSTIC', 'PDF_EXPORT'
]);

const AUTH_OR_SENSITIVE_MUTATION = new Set([
    'OTP_GEN', 'OTP_VERIFY', 'LOGIN_PRO', 'REGISTER_PRO', 'MFA_VERIFY_PRO',
    'REGISTER_INVITE', 'REFRESH_PRO', 'LOGIN_USER', 'SIGNUP_USER', 
    'RESEND_VERIFY', 'FORGOT_USER', 'RESET_USER', 'RESET_PASSWORD',
    'BOOK', 'CONFIRM', 'FEEDBACK', 'CONTACT_FORM', 'DSR_EXPORT', 'RDV_PUBLIC_WRITE', 
    'MESSAGE_USER_SEND', 'MESSAGE_USER_WRITE', 'MESSAGE_PRO_SEND', 'ADMIN_API', 'CITIZEN_ACCOUNT_READ', 'CITIZEN_ACCOUNT_WRITE', 'SHARE_CREATE'
]);

/**
 * @param {string} action
 */
function shouldFailClosed(action) {
    if (!IS_PRODUCTION) return false;
    // Explicitly allow public reads to fail open
    if (PUBLIC_READ_ACTIONS.has(action)) return false;
    // Auth, sensitive mutations, and UNKNOWN actions fail closed
    return true;
}

// Internal: In-Memory Implementation
function checkRateLimitInMemory(action, /** @type {string | number | boolean | null | undefined} */ identifier) {
    // @ts-ignore
    const config = CONFIG[action] || DEFAULT_RATE_LIMIT;   // an unknown action uses the default instead of throwing
    const now = Date.now();
    const key = `${action}:${identifier}`;
    const hashedKey = hashKey(key);
    // Convert seconds to ms for memory check
    const windowMs = config.window * 1000;

    const record = memoryStore.get(key) || { count: 0, startTime: now };

    if (now - record.startTime > windowMs) {
        record.count = 0;
        record.startTime = now;
    }

    record.count++;
    memoryStore.set(key, record);

    if (record.count > config.limit) {
        logger.warn(`[AUDIT] Rate Limit Denied: Backend=${BACKEND_NAME} Action=${action} KeyHash=${hashedKey} Count=${record.count}`);
        return { allowed: false, error: getErrorObject() };
    }
    return { allowed: true };
}

// Internal: Vercel KV / Upstash REST Implementation
// @ts-ignore
async function checkRateLimitKV(action, /** @type {string | number | boolean | null | undefined} */ identifier) {
    // @ts-ignore
    const config = CONFIG[action] || DEFAULT_RATE_LIMIT;
    const key = `${action}:${identifier}`;
    const hashedKey = hashKey(key);

    try {
        // Reuse or Create Limiter for this Action
        let actionLimiter = limiterCache.get(action);

        if (!actionLimiter) {
            actionLimiter = new Ratelimit({
                redis: redisClient, // Reuse singleton client
                limiter: Ratelimit.slidingWindow(config.limit, `${config.window} s`),
                analytics: false,
                prefix: "@upstash/ratelimit"
            });
            limiterCache.set(action, actionLimiter);
        }

        const { success, limit, remaining } = await actionLimiter.limit(key);

        if (!success) {
            logger.warn(`[AUDIT] Rate Limit Denied: Backend=${BACKEND_NAME} Action=${action} KeyHash=${hashedKey} Remaining=${remaining}`);
            return { allowed: false, error: getErrorObject() };
        }

        return { allowed: true };

    } catch (e) {
        logger.error(`[RateLimit] KV REST Error:`, e);

        // P0.4: FAIL-CLOSED in PRODUCTION for critical Auth actions only
        if (shouldFailClosed(action)) {
            logger.error(`[RateLimit] CRITICAL: Fail-Closed triggered for ${action} in Production. Blocking request.`);
            return {
                allowed: false,
                error: {
                    error: "Service indisponible",
                    message: "Une vérification de sécurité a échoué. Veuillez réessayer.",
                    code: "RATE_LIMIT_ERROR"
                },
                status: 503
            };
        }

        // Allow fallback in Dev/Preview
        logger.warn(`[RateLimit] Falling back to Memory Store (Non-Production)`);
        return checkRateLimitInMemory(action, identifier);
    }
}

/**
* @param {{ [x: string]: any; method?: string; url?: string; headers: any; query?: Record<string, any>; body?: any; cookies?: Record<string, any>; socket?: any; }} req
*/
export function getClientIp(req) {
    return clientIp(req, '127.0.0.1');   // launch-readiness item 48: the platform header on Vercel, address-shaped values only
}

function getErrorObject() {
    return {
        error: "Trop de tentatives.",
        message: "Veuillez patienter quelques minutes avant de réessayer.", // FALC
        code: "RATE_LIMITED"
    };
}

// Default fallback config for unknown actions — never crash
const DEFAULT_RATE_LIMIT = { limit: 30, window: 60 };

// @ts-ignore
export async function checkRateLimit(action, /** @type {string | number | boolean | null | undefined} */ identifier) {
    // @ts-ignore
    let config = CONFIG[action];
    if (!config) {
        logger.warn(`[RateLimit] Unknown action "${action}" — using default (${DEFAULT_RATE_LIMIT.limit}/${DEFAULT_RATE_LIMIT.window}s)`);
        config = DEFAULT_RATE_LIMIT;
    }

    if (hasHttpKv) {
        return checkRateLimitKV(action, identifier);
    } else {
        // P0.4: If KV is missing entirely in PRODUCTION
        if (shouldFailClosed(action)) {
            logger.error(`[RateLimit] CRITICAL: KV Credentials missing in Production for action ${action}. Fail-Closed.`);
            return {
                allowed: false,
                error: {
                    error: "Service indisponible",
                    message: "Configuration serveur incomplète.",
                    code: "RATE_LIMIT_CONFIG_ERROR"
                },
                status: 503
            };
        }

        // Fallback for Dev/Preview without credentials
        return checkRateLimitInMemory(action, identifier);
    }
}

/**
 * @param {{ status?: number } | null | undefined} result
 * @returns {number}
 */
export function getRateLimitStatus(result) {
    return typeof result?.status === 'number' ? result.status : 429;
}
