import logger from '../_utils/logger.js';
import { createHash, timingSafeEqual } from 'crypto';
/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
import { env, getEnv } from '../_utils/env.js';

export default async function handler(/** @type {import('../_utils/http-types').ApiRequest} */ req, /** @type {import('../_utils/http-types').ApiResponse} */ res) {
    const debugToken = env.secrets.debugToken;
    const requestToken = req.headers['x-debug-token'];

    // Strict security: if DEBUG_TOKEN is not set, disable the endpoint
    if (!debugToken) {
         logger.warn("DEBUG_TOKEN not set in environment.");
         return res.status(503).json({ error: 'Debug token not configured on server' });
    }

    // launch-readiness item 48: constant-time comparison (a plain !== leaks, through its timing, how many leading characters were right)
    const given = createHash('sha256').update(String(requestToken || '')).digest();
    const expected = createHash('sha256').update(String(debugToken)).digest();
    if (!requestToken || !timingSafeEqual(given, expected)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const dbUrl = env.db.databaseUrl || getEnv('POSTGRES_PRISMA_URL');
    let dbHost = 'unknown';
    if (dbUrl) {
        try {
            // Masking: postgres://user:pass@hostname:port/db
            const parsed = new URL(dbUrl);
            const host = parsed.hostname;
            // Show only first 2 chars of host or "lo...st"
            dbHost = host.length > 4 ? `${host.substring(0, 2)}...${host.substring(host.length - 2)}` : 'masked';
        } catch {
            dbHost = 'invalid-url';
        }
    }

    let buildTime = new Date().toISOString();
    try {
        const buildInfo = await import('../_utils/build-info.js');
        if (buildInfo.buildTime) {
            buildTime = buildInfo.buildTime;
        }
    } catch {
        // Fallback to runtime time if build info missing
        logger.warn("Could not load build-info.js");
    }

    const info = {
        commitSha: env.sentry.release,
        buildTime: buildTime,
        vercelEnv: env.runtime.vercelEnv,
        effectiveBaseUrl: `https://${req.headers.host}`,
        dbHost: dbHost,
    };

    return res.status(200).json(info);
}
