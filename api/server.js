// @ts-nocheck
/**
 * Standalone HTTP server for Docker deployment.
 *
 * Wraps the Vercel-style handler from api/index.js into a standard
 * Node.js HTTP server, polyfilling Vercel's Express-like res API:
 *   res.status(code)  → sets status code, returns res (chainable)
 *   res.json(obj)     → sends JSON response
 *   res.send(data)    → sends string/buffer response
 *
 * Usage:
 *   node api/server.js
 */

import { createServer } from 'node:http';
import { parse } from 'node:url';
import { logger } from './lib/logger.js';

// Dynamic import to handle top-level await in the handler module
const { default: handler } = await import('./index.js');

// @ts-ignore
const PORT = parseInt(process.env.PORT || '3000', 10);

/**
 * Polyfill Vercel/Express-like response methods onto native ServerResponse.
 * @param {import('node:http').ServerResponse} res
 */
function polyfillResponse(res) {
    if (typeof res.status !== 'function') {
        res.status = function (/** @type {string | number | boolean | null | undefined} */ code) {
            this.statusCode = code;
            return this;
        };
    }

    if (typeof res.json !== 'function') {
        res.json = function (/** @type {string | number | boolean | null | undefined} */ data) {
            const body = JSON.stringify(data);
            if (!this.headersSent) {
                this.setHeader('Content-Type', 'application/json; charset=utf-8');
                this.setHeader('Content-Length', Buffer.byteLength(body));
            }
            this.end(body);
            return this;
        };
    }

    if (typeof res.send !== 'function') {
        res.send = function (/** @type {null} */ data) {
            if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
                return this.json(data);
            }
            const body = typeof data === 'string' ? data : String(data);
            if (!this.headersSent) {
                if (!this.getHeader('Content-Type')) {
                    this.setHeader('Content-Type', 'text/plain; charset=utf-8');
                }
                this.setHeader('Content-Length', Buffer.byteLength(body));
            }
            this.end(body);
            return this;
        };
    }

    if (typeof res.redirect !== 'function') {
        res.redirect = function (/** @type {string | number | boolean | null | undefined} */ statusOrUrl, /** @type {string | number} */ url) {
            const code = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
            const location = typeof statusOrUrl === 'string' ? statusOrUrl : url;
            this.writeHead(code, { Location: location });
            this.end();
            return this;
        };
    }
}

const server = createServer(async (req, res) => {
    // Parse URL and attach query/pathname to req (Vercel compat)
    const parsed = parse(req.url || '/', true);
    req.query = parsed.query;

    // Polyfill Vercel response API
    polyfillResponse(res);

    try {
        await handler(req, res);
    } catch (err) {
        logger.error('[server] Unhandled error', err);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
    }
});

server.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 ADA API server listening on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
// @ts-ignore
process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down...');
    server.close(() => process.exit(0));
});
