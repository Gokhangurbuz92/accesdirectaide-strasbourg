// @ts-nocheck
import logger from './logger.js';
import crypto from 'crypto';
import { clientIp } from './client-ip.js';

/**
 * Request logging middleware for API routes
 * Adds requestId, logs request/response, and tracks duration
 */
export function withRequestLogging(/** @type {(...args: unknown[]) => unknown} */ handler) {
    // @ts-ignore
    return async (req, res) => {
        const startTime = Date.now();
        const requestId = crypto.randomUUID();
        
        // Attach requestId to request for downstream use
        req.requestId = requestId;
        
        // Log incoming request
        logger.info({
            requestId,
            method: req.method,
            path: req.url,
            userAgent: req.headers['user-agent'],
            ip: clientIp(req)
        }, 'Request received');

        // Intercept res.json to log response
        const originalJson = res.json.bind(res);
        res.json = function(/** @type {string | number | boolean | null | undefined} */ data) {
            const duration = Date.now() - startTime;
            
            logger.info({
                requestId,
                method: req.method,
                path: req.url,
                status: res.statusCode,
                duration_ms: duration
            }, 'Request completed');
            
            return originalJson(data);
        };

        try {
            return await handler(req, res);
        } catch (error) {
            const duration = Date.now() - startTime;
            
            logger.error({
                requestId,
                method: req.method,
                path: req.url,
                // @ts-ignore
                error: error.message,
                // @ts-ignore
                stack: error.stack,
                duration_ms: duration
            }, 'Request failed');
            
            // Re-throw to let error handler deal with it
            throw error;
        }
    };
}
