/** @typedef {import('./http-types').ApiRequest} ApiRequest */
/** @typedef {import('./http-types').ApiResponse} ApiResponse */

import { getEnv } from './env.js';

/** @param {ApiResponse} res @param {string} key */
export function getHeader(res, key) {
    try {
        if (typeof res.getHeader === "function") return res.getHeader(key);
    } catch {
        // Intentionally ignore: res object may not support getHeader in all environments
    }
    return undefined;
}

/** @param {ApiResponse} res @param {string} key @param {any} value */
export function setHeader(res, key, value) {
    try {
        if (typeof res.setHeader === "function") return res.setHeader(key, value);
        if (typeof res.set === "function") return res.set(key, value);
    } catch {
        // Intentionally ignore: res object may not support setHeader/set in all environments
    }
}

/** @param {ApiResponse} res @param {string} value */
export function setCachePolicyTag(res, value) {
    // Only send debug headers if explicitly enabled or not in production
    // (Defaults to hidden in prod for cleanliness)
    const vercelEnv = getEnv('VERCEL_ENV') || getEnv('VITE_ENV');
    const showDebug = getEnv('CACHE_DEBUG_HEADERS') === 'true' || (vercelEnv && vercelEnv !== 'production');

    if (!showDebug) return;

    try {
        if (typeof res.setHeader === "function") return res.setHeader("x-cache-policy", value);
        if (typeof res.set === "function") return res.set("x-cache-policy", value);
    } catch {
        // Intentionally ignore: debug header is optional, failure is non-critical
    }
}

/** @param {ApiRequest} req */
export function hasAuthHeader(req) {
    const h = req?.headers || {};
    return Boolean(h.authorization || h.Authorization);
}

/** @param {ApiResponse} res */
export function setNoStore(res) {
    // private prevents shared caches from storing
    setHeader(res, "Cache-Control", "private, no-store, max-age=0, must-revalidate");
    setHeader(res, "Pragma", "no-cache");
}

/** @param {ApiResponse} res */
export function applyNoStore(res) {
    setNoStore(res);
}

/** @param {ApiResponse} res @param {{ sMaxage?: number, swr?: number }=} policy */
export function setPublicCache(res, { sMaxage = 600, swr = 86400 } = {}) {
    setHeader(res, "Cache-Control", `public, max-age=0, s-maxage=${sMaxage}, stale-while-revalidate=${swr}`);
}

/**
 * Apply CDN-friendly cache ONLY for successful responses.
 * If status is already an error (>=400), force no-store.
 *
 * @param {ApiResponse} res
 * @param {{ sMaxAge?: number, swr?: number }=} policy
 */
export function applyPublicCache(res, { sMaxAge = 600, swr = 86400 } = {}) {
    const status = Number(res?.statusCode || 200);
    if (status >= 400) {
        setNoStore(res);
        return false;
    }
    setPublicCache(res, { sMaxage: sMaxAge, swr });
    return true;
}

// Safety: if request is authorized, never public-cache it.
/** @param {ApiRequest} req @param {ApiResponse} res @param {{ sMaxage?: number, swr?: number }=} policy */
export function setAnonymousPublicCache(req, res, policy) {
    if (hasAuthHeader(req)) {
        setNoStore(res);
        return false;
    }
    setPublicCache(res, policy);
    return true;
}

// Guard: if handler returns 4xx/5xx, force no-store (avoid caching errors).
/** @param {ApiResponse} res */
export function attachNoStoreOnError(res) {
    // Wrap writeHead (Node)
    if (typeof res.writeHead === "function") {
        const _writeHead = res.writeHead.bind(res);
        res.writeHead = (statusCode, headers) => {
            if (Number(statusCode) >= 400) setNoStore(res);
            return _writeHead(statusCode, headers);
        };
    }

    // Wrap status() (Express-like)
    if (typeof res.status === "function") {
        const _status = res.status.bind(res);
        res.status = (code) => {
            if (Number(code) >= 400) setNoStore(res);
            return _status(code);
        };
    }

    // Wrap json() (Express-like)
    if (typeof res.json === "function") {
        const _json = res.json.bind(res);
        res.json = (body) => {
            const code = Number(res.statusCode || 200);
            if (code >= 400) setNoStore(res);
            return _json(body);
        };
    }

    // Wrap end() (Node) — last line of defense
    if (typeof res.end === "function") {
        const _end = res.end.bind(res);
        res.end = (...args) => {
            const code = Number(res.statusCode || 200);
            if (code >= 400) setNoStore(res);
            return _end(...args);
        };
    }

    return res;
}
