// @ts-nocheck
import crypto from 'crypto';
import { requireProAuth } from './auth.js';
import { enforceProRdvRateLimit } from './pro-rdv-rate-limit.js';
import Sentry from './sentry.js';
import logger from './logger.js';

/**
 * @param {string | undefined | null} value
 * @returns {string}
 */
function hashProUserId(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

/**
 * @param {unknown} error
 * @param {{
 *  handlerName: string,
 *  requestId: string,
 *  route: string,
 *  method: string,
 *  statusCode: number,
 *  structureId: string,
 *  proUserId: string,
 * }} context
 */
async function captureProRdvError(error, context) {
  try {
    Sentry.withScope((scope) => {
      scope.setTag('module', 'rdv');
      scope.setTag('surface', 'pro');
      scope.setTag('handler', context.handlerName);
      scope.setTag('route', context.route);
      scope.setTag('http.method', context.method);
      scope.setTag('http.status_code', String(context.statusCode));
      scope.setTag('request_id', context.requestId);

      scope.setContext('rdv', {
        requestId: context.requestId,
        route: context.route,
        structureId: context.structureId,
        proUserIdHash: hashProUserId(context.proUserId),
      });

      Sentry.captureException(error);
    });

    await Sentry.flush(1500);
  } catch {
    // best-effort: never break request flow because Sentry failed
  }
}

/**
 * Pro RDV wrapper:
 * - strict pro-only auth
 * - tenant-scoped rate limiting (read/write quotas)
 * - safe Sentry capture for unhandled exceptions
 *
 * @param {string} handlerName
 * @param {(req: import('./http-types').ApiRequest, res: import('./http-types').ApiResponse) => Promise<any>} handler
 */
export function withProRdvHandler(handlerName, handler) {
  return requireProAuth(async function wrapped(/** @type {import('./http-types').ApiRequest} */ req, /** @type {import('./http-types').ApiResponse} */ res) {
    const requestId = typeof req.requestId === 'string' ? req.requestId : crypto.randomUUID();
    const route = String(req.url || '').split('?')[0] || '/api/pro';
    const method = String(req.method || 'GET').toUpperCase();
    const structureId = String(req.user?.structureId || '').trim();
    const proUserId = String(req.user?.userId || '').trim();

    const rateLimit = await enforceProRdvRateLimit(req, res, { handlerName });
    if (!rateLimit.allowed) {
      return;
    }

    try {
      return await handler(req, res);
    } catch (error) {
      const statusCode =
        error && typeof error === 'object' && typeof error.statusCode === 'number'
          ? Number(error.statusCode)
          : 500;

      await captureProRdvError(error, {
        handlerName,
        requestId,
        route,
        method,
        statusCode,
        structureId,
        proUserId,
      });

      logger.error(
        {
          requestId,
          handler: handlerName,
          route,
          method,
          statusCode,
          structureId,
          err: error.stack,
        },
        'pro.rdv.handler.error',
      );

      if (!res.headersSent) {
        return res.status(500).json({
          error: 'Internal Server Error',
          requestId,
        });
      }
    }
  });
}
