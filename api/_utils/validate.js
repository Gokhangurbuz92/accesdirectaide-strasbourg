import { z } from 'zod';
import logger from './logger.js';

/**
 * 💎 VALIDATEUR UNIVERSEL ZOD
 * 
 * Wrapper qui valide automatiquement les entrées HTTP contre un schéma Zod
 * avant d'exécuter le handler. Supporte GET (query) et POST/PUT/PATCH (body).
 *
 * @example
 * import { validate } from '../../_utils/validate.js';
 * import { z } from 'zod';
 *
 * const schema = z.object({ email: z.string().email(), name: z.string().min(1) });
 *
 * export default validate(schema, async (req, res) => {
 *     // req.body is guaranteed to match the schema
 *     const { email, name } = req.body;
 *     res.status(200).json({ ok: true });
 * });
 */

/**
 * @template {z.ZodTypeAny} T
 * @param {T} schema - Zod schema to validate against
 * @param {Function} handler - The actual route handler
 * @returns {Function} Wrapped handler with input validation
 */
export function validate(schema, handler) {
    return async (/** @type {import('./http-types').ApiRequest} */ req, /** @type {import('./http-types').ApiResponse} */ res) => {
        try {
            if (req.method === 'GET' || req.method === 'HEAD') {
                req.validatedQuery = schema.parse(req.query || {});
            } else {
                // For POST/PUT/PATCH/DELETE — validate body
                const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
                req.validatedBody = schema.parse(body);
            }
            return handler(req, res);
        } catch (error) {
            if (error instanceof z.ZodError) {
                const requestId = req.requestId || 'unknown';
                logger.warn({
                    msg: 'validation_failed',
                    requestId,
                    errors: error.issues.map(e => ({ path: e.path.join('.'), message: e.message })),
                });
                return res.status(400).json({
                    error: 'validation_failed',
                    requestId,
                    details: error.issues.map(e => ({
                        field: e.path.join('.'),
                        message: e.message,
                        code: e.code,
                    })),
                });
            }
            // JSON parse errors
            if (error instanceof SyntaxError) {
                return res.status(400).json({
                    error: 'invalid_json',
                    message: 'Request body is not valid JSON',
                });
            }
            throw error; // Re-throw unexpected errors
        }
    };
}
