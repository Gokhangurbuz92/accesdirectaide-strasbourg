// @ts-nocheck
import { routes } from './routes.js';
import { csrfCheck, ensureCsrfCookie } from './_utils/csrf.js';
import Sentry from './_utils/sentry.js';
import logger from './_utils/logger.js';
import { randomUUID } from 'crypto';
import { attachNoStoreOnError } from "./_utils/cache.js";
import { applyCachePolicy } from "./_utils/cachePolicy.js";
import { env, getEnv } from './_utils/env.js';
import { applyNoIndex, isTechnicalNoIndexPath } from './_utils/robots.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from './_utils/rateLimit.js';
import { waitUntil } from '@vercel/functions';
import { validationRegistry } from './_utils/validation-registry.js';
import { z } from 'zod';

import { applySecurityHeaders } from './_utils/security.js';
import { isPublicBetaRestricted, isAllowedInPublicBeta, PUBLIC_BETA_MESSAGE } from './_utils/public-beta.js';

// Vercel Serverless Function config — Pro plan supports up to 300s
export const config = {
    maxDuration: 300,
};

/** @param {unknown} value */
function normalizeRequestId(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.length > 64) return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return null;
    return trimmed;
}

/**
 * Avoid leaking secrets in logs.
 * We redact common sensitive query keys (exact or substring match).
 *
 * @param {URLSearchParams} searchParams
 * @returns {Record<string, string>}
 */
function redactQueryParams(searchParams) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const [key, value] of searchParams.entries()) {
        const k = String(key || '').toLowerCase();
        const isSensitive =
            k.includes('secret') ||
            k.includes('token') ||
            k.includes('password') ||
            k === 'key' ||
            k.includes('auth');

        const s = String(value || '');
        const truncated = s.length > 80 ? `${s.slice(0, 80)}...` : s;

        out[key] = isSensitive ? '[REDACTED]' : truncated;
    }
    return out;
}

/**
 * @param {string} path
 * @returns {'public' | 'admin' | 'cron' | 'monitor' | 'health' | 'other'}
 */
function getRouteGroup(path) {
    if (!path) return 'other';
    if (path.startsWith('admin/')) return 'admin';
    if (path.startsWith('cron/')) return 'cron';
    if (path.startsWith('monitor/')) return 'monitor';
    if (path === 'health' || path === 'healthz' || path.startsWith('health/')) return 'health';

    const publicPrefixes = [
        'aides',
        'aids',
        'actualites',
        'appointments',
        'assistant/',
        'auth/',
        'citizen/',
        'demarches',
        'dispositifs',
        'download',
        'drees',
        'feedback',
        'guides',
        'login-pro-guard',
        'pdf',
        'pro/',
        'public/',
        'reports',
        'rdv',
        'ressources',
        'robots',
        'search',
        'sitemap',
        'structures',
        'taxonomy',
        'tools',
        'upload',
    ];

    if (publicPrefixes.some((prefix) => path === prefix || path.startsWith(prefix))) {
        return 'public';
    }

    return 'other';
}
/**
 * @param {import('./_utils/http-types').ApiRequest} req
 * @param {import('./_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    let requestId = "init-" + Math.random().toString(36).substring(7);
    let log = logger; // Default fallback

    try {
        const startTime = Date.now();

        requestId = normalizeRequestId(req.headers?.['x-request-id']) || randomUUID();
        req.requestId = requestId;

        // 1. Initialize Logger with Fallback
        try {
            log = logger.child({ requestId });
        } catch (e) {
            logger.error("Logger init failed, using root logger fallback:", e);
            log = logger;
        }

        // 2. CORS Headers — dynamic whitelist (SEC-01)
        const origin = req.headers?.origin || '';
        let appBaseOrigin = '';
        try { const u = new URL(env.runtime.appBaseUrl || ''); if (u.protocol === 'https:') appBaseOrigin = u.origin; } catch { /* unset or invalid */ }
        const isAllowedOrigin =
            origin === 'https://accesdirectaide.fr' ||
            origin === 'https://www.accesdirectaide.fr' ||
            // Public beta (owner directive 29/10/2026): the deleted legacy Vercel project is no longer trusted; the only other
            // allowed origin is the deployment's own APP_BASE_URL (exact https origin, no wildcard)
            (!!appBaseOrigin && origin === appBaseOrigin) ||
            (env.runtime.nodeEnv !== 'production' && (
                origin === 'http://localhost:5173' ||
                origin === 'http://localhost:3000' ||
                origin === 'http://127.0.0.1:5173' ||
                origin === 'http://127.0.0.1:3000'
            ));

        if (isAllowedOrigin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-secret, x-csrf-token');
        res.setHeader('x-request-id', requestId);

        // 2b. OWASP Security Headers (SEC-02)
        applySecurityHeaders(res, origin);

        const vercelGitSha = getEnv('VERCEL_GIT_COMMIT_SHA');
        if (vercelGitSha) {
            res.setHeader('x-release-sha', vercelGitSha);
        }

        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }

        // 2c. CSRF Protection — block mutating requests from unknown origins (SEC-03)
        // Cron jobs and monitors have no browser origin, so we allow them
        const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
        const hasBearerToken = (req.headers?.authorization || '').startsWith('Bearer ');
        const hasCronSecret = !!req.headers?.['x-cron-secret'];
        if (isMutating && origin && !isAllowedOrigin && !hasBearerToken && !hasCronSecret) {
            log.warn({ msg: 'CSRF blocked', origin, method: req.method });
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Origin not allowed (CSRF protection — SEC-03)',
                requestId,
            });
        }

        // 2d. CSRF Double-Submit Cookie (SEC-04)
        const csrf = csrfCheck(req, res);
        if (!csrf.ok) {
            log.warn({ msg: 'CSRF double-submit rejected', method: req.method });
            return res.status(403).json({
                error: 'Forbidden',
                message: csrf.error,
                requestId,
            });
        }
        // Ensure CSRF cookie is set for browser clients
        ensureCsrfCookie(req, res);

        // 3. Request Logging
        const urlObj = new URL(req.url, `https://${req.headers.host}`);
        let path = urlObj.pathname || "";

        // Normalize path
        path = path.replace(/^\/api(\/|$)/, "/");
        path = path.replace(/^\/+/, "");
        path = path.replace(/\/+$/, "");
        const routeGroup = getRouteGroup(path);

        if (isTechnicalNoIndexPath(path)) {
            applyNoIndex(res);
        }

        log.info({
            msg: "Incoming Request",
            method: req.method,
            path: path,
            routeGroup,
            query: redactQueryParams(urlObj.searchParams),
            userAgent: req.headers['user-agent']
        });

        // 3a. Restricted public beta: only the public read-only information routes (allowlist, server-side)
        if (isPublicBetaRestricted() && !isAllowedInPublicBeta(req.method, path)) {
            res.setHeader('Cache-Control', 'no-store');
            return res.status(503).json({ error: 'PUBLIC_BETA_RESTRICTED', message: PUBLIC_BETA_MESSAGE, requestId });
        }

        // ── FAST PATH: Health endpoints bypass Sentry/cache/rate-limit ──
        // This guarantees /api/health can NEVER return 500 from infra failures.
        // Fix for Issue #338: smoke test expects 200, Sentry crash caused 500.
        if (routeGroup === 'health') {
            try {
                const route = routes.find(r => r.path === path && r.match === 'exact');
                if (route) {
                    const mod = await route.handler();
                    const healthHandler = mod.default || mod;
                    await healthHandler(req, res);
                    return;
                }
            } catch (healthErr) {
                const msg = healthErr instanceof Error ? healthErr.message : String(healthErr);
                log.error({ msg: 'health.crash', error: msg });
                if (!res.headersSent) {
                    res.setHeader('Cache-Control', 'no-store');
                    res.setHeader('x-robots-tag', 'noindex, nofollow');
                    return res.status(200).json({
                        ok: false,
                        status: 'degraded',
                        error: env.runtime.nodeEnv === 'production' ? 'health_check_error' : msg,
                        time: new Date().toISOString(),
                    });
                }
                return;
            }
        }

        // 3b. Admin Rate Limiting (SEC-01)
        if (routeGroup === 'admin') {
            const ip = getClientIp(req);
            const rl = await checkRateLimit('ADMIN_API', ip);
            if (!rl.allowed) {
                log.warn({ msg: 'Admin rate limit exceeded', ip: ip.substring(0, 8) + '...' });
                return res.status(getRateLimitStatus(rl)).json(rl.error || { error: 'Rate limited' });
            }
        }

        // 4. Route Matching (Inner Block)
        // Security check for __dev
        if ((path.startsWith('__dev') || req.url.includes('/__dev/')) &&
            (env.runtime.vercelEnv === 'production' || env.runtime.vercelEnv === 'preview')) {
            log.warn({ msg: "Blocked access to __dev", path });
            return res.status(403).json({ error: "Forbidden" });
        }

        // --- CACHE CONTROL (CENTRALIZED) ---
        // 1. Guard against error caching
        attachNoStoreOnError(res);
        // 2. Apply whitelist policy
        applyCachePolicy(req, res);
        // -----------------------------------

        let routeHandler = null;
        const route = routes.find(r => {
            if (r.match === 'exact') return r.path === path;
            if (r.match === 'prefix') return path.startsWith(r.path) || path.startsWith(r.path + '/');
            return false;
        });

        if (route) {
            // Lazy-loaded routes: handler is () => import('./module.js')
            // Resolve to the default export of the dynamically imported module
            const mod = await route.handler();
            routeHandler = mod.default || mod;
        }

        if (!routeHandler) {
            log.warn({ msg: "Route Not Found", path });
            return res.status(404).json({ error: "Not Found" });
        }

        // 4b. Auto-validate input via registry (SEC-05)
        const routeSchema = validationRegistry[path];
        if (routeSchema && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            try {
                const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
                req.validatedBody = routeSchema.parse(body);
            } catch (valErr) {
                if (valErr instanceof z.ZodError) {
                    log.warn({ msg: 'input_validation_failed', path, errors: valErr.errors.length });
                    return res.status(400).json({
                        error: 'validation_failed',
                        requestId,
                        details: valErr.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message,
                            code: e.code,
                        })),
                    });
                }
                if (valErr instanceof SyntaxError) {
                    return res.status(400).json({ error: 'invalid_json', requestId });
                }
                throw valErr;
            }
        }

        // 5. Execute Handler
        // Wrap response to log duration on finish
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            log.info({
                msg: "Request Completed",
                status: res.statusCode,
                duration,
                routeGroup,
            });
        });

        // PIPELINE SENTINEL: Route Level
        if (path === 'cron/pipeline') {
            const runId = req.query.runId || req.headers['x-run-id'] || 'N/A';
            const source = req.query.source || 'N/A';
            logger.info(`PIPELINE_ROUTE_ENTER source=${source} runId=${runId}`);
        }

        // Execute with Sentry scope if available, fallback to naked execution
        async function executeHandler() {
            try {
                await routeHandler(req, res);
            } catch (routeError) {
                const message = routeError instanceof Error ? routeError.message : String(routeError);
                log.error({ msg: 'Handler crashed', error: message }, 'Unhandled handler error');

                try {
                    Sentry.captureException(routeError, {
                        tags: {
                            requestId,
                            route: path,
                            routeGroup,
                            phase: 'handler',
                            vercelEnv: env.runtime.vercelEnv,
                            'http.method': String(req.method || 'GET').toUpperCase(),
                            'http.status_code': '500',
                        },
                    });
                    waitUntil(Sentry.flush(2000));
                } catch {
                    // best-effort
                }

                if (!res.headersSent) {
                    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
                    res.setHeader("x-error-source", "handler-guard");
                    res.status(500).json({
                        error: "Internal Server Error",
                        requestId,
                        message: env.runtime.nodeEnv === 'production' ? "Internal Error" : String(message),
                    });
                }
            }
        }

        try {
            await Sentry.withScope(async (scope) => {
                scope.setTag('request_id', requestId);
                scope.setTag('route', path);
                scope.setTag('route_group', routeGroup);
                scope.setTag('vercel_env', env.runtime.vercelEnv);
                scope.setTag('release', env.sentry.release);
                scope.setTag('http.method', String(req.method || 'GET').toUpperCase());
                scope.setContext('http', {
                    method: String(req.method || 'GET').toUpperCase(),
                    path: `/${path}`,
                });

                await executeHandler();
            });
        } catch (sentryError) {
            // Sentry.withScope itself crashed — run handler without Sentry
            log.warn({ msg: 'Sentry.withScope crashed, running handler naked', error: String(sentryError) });
            await executeHandler();
        }

    } catch (bootError) {
        // GLOBAL CATCH: Catches errors before the handler specific try/catch or if it bubble up
        // This prevents "FUNCTION_INVOCATION_FAILED" generic errors
        logger.error("CRITICAL HANDLER CRASH:", bootError);
        const bootMessage = bootError instanceof Error ? bootError.message : String(bootError);

        if (!res.headersSent) {
            try {
                res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
                res.setHeader("x-error-source", "boot-guard");
                // Only expose error details in header for non-production (prevent stack/message leakage)
                if (env.runtime.nodeEnv !== 'production') {
                    res.setHeader("x-boot-error", String(bootMessage).slice(0, 200));
                }
                res.status(500).json({
                    error: "Server Boot Error",
                    requestId,
                    message: env.runtime.nodeEnv === 'production' ? "Internal Error" : bootMessage
                });
            } catch (inner) {
                logger.error("Error sending 500 response:", inner);
                res.end('{"error": "Critical Failure"}');
            }
        }

        // Try to capture in Sentry if possible
        try {
            Sentry.captureException(bootError, { tags: { requestId, phase: "boot" } });
            waitUntil(Sentry.flush(2000));
        } catch {
            // Intentionally ignore: Sentry reporting is best-effort, failure should not block response
        }
    }
}
