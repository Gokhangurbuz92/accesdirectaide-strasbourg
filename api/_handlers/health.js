// @ts-nocheck
import { randomUUID } from 'crypto';
import { db } from '../../src/db/index.js';
import { sql } from 'drizzle-orm';
import logger from '../_utils/logger.js';
import { kv } from '../_utils/kv.js';
import { env } from '../_utils/env.js';
import { getMailerStatus } from '../_utils/mailer.js';

/**
 * Health Endpoints
 * /api/health/live -> Returns 200 immediately if process is up.
 * /api/health/ready -> Returns 200 if DB is reachable, else 503 (no raw errors leaked).
 */
export default async function handler(/** @type {import('../_utils/http-types').ApiRequest} */ req, /** @type {import('../_utils/http-types').ApiResponse} */ res) {
    const requestId =
        typeof req?.requestId === 'string' && req.requestId
            ? req.requestId
            : typeof req?.headers?.['x-request-id'] === 'string' && req.headers['x-request-id']
            ? req.headers['x-request-id']
            : randomUUID();

    if (typeof res?.setHeader === 'function') {
        res.setHeader('x-request-id', requestId);
        res.setHeader('Cache-Control', 'no-store');
    }

    const rawUrl = typeof req?.url === 'string' ? req.url : '';
    const path = rawUrl.split('?')[0].replace(/^\/?api\//, '').replace(/^\//, '');
    const now = new Date().toISOString();

    // /api/health/live
    if (path === 'health/live') {
        return res.status(200).json({
            ok: true,
            status: 'live',
            service: 'acces-direct-aide',
            time: now,
            timestamp: now,
            requestId,
        });
    }

    // /api/health/ready
    if (path === 'health/ready') {
        try {
            await db.execute(sql`SELECT 1`);
            // In production, outgoing mail must be deliverable: e-mail verification gates booking, so a
            // `noop`/unwired provider means the citizen journey cannot complete (fail closed, no secrets in the response).
            const mail = getMailerStatus();
            const isProduction = String(process.env.VERCEL_ENV || process.env.NODE_ENV || '').toLowerCase() === 'production';
            if (isProduction && !mail.deliverable) {
                logger.error({ msg: 'readiness.mail_undeliverable', provider: mail.provider, reason: mail.reason }, 'Readiness: mail delivery unavailable');
                return res.status(503).json({
                    ok: false,
                    status: 'not_ready',
                    error: 'mail_delivery_unavailable',
                    checks: { database: 'ok', mail: 'undeliverable' },
                    service: 'acces-direct-aide',
                    time: now,
                    timestamp: now,
                    requestId,
                });
            }
            return res.status(200).json({
                ok: true,
                status: 'ready',
                checks: { database: 'ok', mail: mail.deliverable ? 'ok' : 'undeliverable (non-production)' },
                service: 'acces-direct-aide',
                time: now,
                timestamp: now,
                requestId,
            });
        } catch (e) {
            // Do NOT leak raw database error messages
            logger.error('Readiness probe failed', { error: e.message });
            return res.status(503).json({
                ok: false,
                status: 'not_ready',
                error: 'database_unavailable',
                service: 'acces-direct-aide',
                time: now,
                timestamp: now,
                requestId,
            });
        }
    }

    // /api/health/diagnostic is handled by health-deep.js which requires authentication.
    if (path === 'health/diagnostic' || path === 'health/deep') {
        return res.status(401).json({
            error: 'Use protected /api/health-deep for diagnostics',
            requestId,
        });
    }

    // Default or /api/healthz (legacy)
    return res.status(200).json({
        ok: true,
        status: 'ok',
        service: 'acces-direct-aide',
        time: now,
        timestamp: now,
        requestId,
        endpoint: path || 'health',
    });
}
