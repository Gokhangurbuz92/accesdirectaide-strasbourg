// @ts-nocheck
import { ZodError } from 'zod';
import SentryClient from './sentry.js';
import { AppError, errorCodes } from './errors.js';
import crypto from 'crypto';
import { env } from './env.js';
import logger from './logger.js';

export function createHandler(/** @type {(...args: unknown[]) => unknown} */ handler, schemas = {}) {
  return async (/** @type {import('./http-types').ApiRequest} */ req, /** @type {import('./http-types').ApiResponse} */ res) => {
    // Generate Request ID
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();

    // Add requestId to Sentry Scope
    SentryClient.configureScope(scope => {
      scope.setTag("request_id", requestId);
    });

    try {
      // Validation
      let validatedQuery = req.query;
      let validatedBody = req.body;

      if (schemas.query) {
        // Zod parse returns the transformed data
        validatedQuery = schemas.query.parse(req.query);
      }
      if (schemas.body) {
        validatedBody = schemas.body.parse(req.body);
      }

      // Attach validated data to req
      req.validated = {
        query: validatedQuery,
        body: validatedBody
      };

      // Execute Handler
      const result = await handler(req, res);

      // If handler manually sent response, stop here.
      if (res.headersSent) return;

      // Default Response Structure
      const response = {
        data: result,
        meta: {
          requestId,
        },
        error: null
      };

      // Handle Pagination (Convention: result has { items, pagination })
      if (result && typeof result === 'object' && 'items' in result && 'pagination' in result) {
        response.data = result.items;
        response.meta.pagination = result.pagination;
      }

      return res.status(200).json(response);

    } catch (err) {
      logger.error(`[${requestId}] Error:`, err);

      let statusCode = 500;
      let errorResponse = {
        code: errorCodes.INTERNAL_ERROR,
        message: "Une erreur interne est survenue.",
        details: null
      };

      // 1. AppError
      if (err instanceof AppError) {
        statusCode = err.statusCode;
        errorResponse = {
          code: err.code,
          message: err.message,
          details: err.details
        };
      }
      // 2. Zod Error
      else if (err instanceof ZodError) {
        statusCode = 400;
        errorResponse = {
          code: errorCodes.VALIDATION_ERROR,
          message: "Données invalides.",
          details: err.issues
        };
      }
      // 3. PostgreSQL / Drizzle database error
      // Drizzle wraps pg driver errors in DrizzleQueryError — the native
      // PostgreSQL error code lives on error.cause, not on error directly.
      else if (err?.cause?.code || (typeof err?.code === 'string' && /^[0-9]{5}$/.test(err.code))) {
        const pgCode = err.cause?.code || err.code;
        // 23505: Unique constraint violation
        if (pgCode === '23505') {
          statusCode = 409;
          errorResponse.code = errorCodes.CONFLICT;
          errorResponse.message = "Ressource déjà existante.";
        }
        // 23503: Foreign key violation (record not found reference)
        else if (pgCode === '23503') {
          statusCode = 404;
          errorResponse.code = errorCodes.NOT_FOUND;
          errorResponse.message = "Ressource non trouvée.";
        }
        // Other DB errors
        else {
          if (env.runtime.vercelEnv !== 'production') {
            errorResponse.details = pgCode;
          }
        }
      }
      // 4. Fallback
      else {
        // Report to Sentry
        SentryClient.captureException(err);
        if (env.runtime.vercelEnv !== 'production') {
          // @ts-ignore
          errorResponse.details = err.message;
        }
      }

      return res.status(statusCode).json({
        data: null,
        meta: { requestId },
        error: errorResponse
      });
    }
  };
}
