
import crypto from 'crypto';
import { env } from './env.js';

/**
 * Helper to retrieve a header safely from Vercel Request or Node Request
 */
/**
 * @param {import('./http-types').ApiRequest} req
 * @param {string} name
 */
export function getHeader(req, name) {
    if (!req) return undefined;
    const n = name.toLowerCase();
    const h = req.headers;

    // Fetch/Edge style (Headers object)
    if (h && typeof h.get === "function") {
        return h.get(name) ?? h.get(n) ?? undefined;
    }

    // Node/Express style (Plain object)
    if (h && typeof h === "object") {
        return h[n] ?? h[name] ?? undefined;
    }
    return undefined;
}

/**
 * Extract Bearer token from Authorization header
 */
/** @param {import('./http-types').ApiRequest} req */
export function getBearer(req) {
    const h = getHeader(req, 'authorization');
    if (!h) return null;
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? m[1].trim() : null;
}

/**
 * Extract cron secret from supported inputs, in priority order:
 * 1) x-cron-secret header (preferred, avoids proxy/header stripping issues)
 * 2) Authorization: Bearer <token>
 * 3) ?secret=<token> (legacy fallback; avoid in production because it may appear in logs)
 *
 * @param {any} req
 * @returns {string|null}
 */
export function getCronToken(req) {
    const headerSecret = getHeader(req, 'x-cron-secret');
    if (headerSecret != null) {
        const s = String(headerSecret).trim();
        if (s) return s;
    }

    const bearer = getBearer(req);
    if (bearer) return bearer;

    // Legacy: query param (supports generic Node req or Vercel req.query) — never in production: a URL lands in access logs, proxies and browser history
    if (isProductionRuntime()) return null;
    let secretQuery = req?.query?.secret;
    if (!secretQuery && req?.url) {
        // Fallback parsing for manual calls or raw URLs
        try {
            const proto = getHeader(req, 'x-forwarded-proto') || 'http';
            const host = getHeader(req, 'host') || 'localhost';
            secretQuery = new URL(req.url, `${proto}://${host}`).searchParams.get('secret');
        } catch {
            // ignore URL parse errors
        }
    }

    if (secretQuery != null) {
        const s = String(secretQuery).trim();
        if (s) return s;
    }

    return null;
}

/** production runtime (Vercel previews included: NODE_ENV is production there) */
function isProductionRuntime() {
    return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

/**
 * The trigger label of a run that is ALREADY authorized by the secret. Vercel Cron sends the secret itself (`Authorization: Bearer <CRON_SECRET>`, when the
 * project defines CRON_SECRET) with a `vercel-cron/…` user-agent: the user-agent names the scheduler, it never proves anything (anyone can send it).
 * @param {import('./http-types').ApiRequest} req
 */
export function scheduledByVercel(req) {
    return String(getHeader(req, 'user-agent') || '').startsWith('vercel-cron/');
}

/**
 * Standardized Cron Authorization Check
 * Accepts:
 * 1. x-cron-secret: <CRON_SECRET>
 * 2. Authorization: Bearer <CRON_SECRET>
 * 3. ?secret=<CRON_SECRET> (legacy fallback)
 */
/** @param {import('./http-types').ApiRequest} req */
export function isCronAuthorized(req) {
    return getCronAuth(req).ok;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEquals(a, b) {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Detailed cron authorization result so handlers can fail closed.
 *
 * @param {any} req
 * @returns {{ ok: true } | { ok: false, reason: 'missing_secret' | 'unauthorized' }}
 */
export function getCronAuth(req) {
    const cronSecret = env.secrets.cronSecret;
    if (!cronSecret) {
        return { ok: false, reason: 'missing_secret' };
    }

    const token = getCronToken(req);
    if (token && timingSafeEquals(token, cronSecret)) {
        return { ok: true };
    }

    return { ok: false, reason: 'unauthorized' };
}
