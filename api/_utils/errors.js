export class AppError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code
   * @param {string | undefined} message
   */
  constructor(statusCode, code, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'AppError';
  }
}

export const errorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_SERVER_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
};

/**
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 * @param {null | undefined} [details]
 */
export function createError(statusCode, code, message, details) {
  return new AppError(statusCode, code, message, details);
}

/**
 * Loggable shape of a database error. drizzle wraps the driver error as `Failed query: <sql>\nparams: <values>`: keep the SQL shape and the database's own
 * diagnosis (SQLSTATE, constraint, driver message), never the parameter values; the driver `detail` (which carries key values) is not read at all.
 * @param {any} error
 * @returns {{ name: string | undefined, message: string, cause: { code: string | undefined, constraint: string | undefined, message: string } | undefined }}
 */
export function describeDbError(error) {
  const cause = error?.cause;
  return {
    name: error?.name,
    message: String(error?.message || '').split('\nparams:')[0].slice(0, 300),
    cause: cause ? { code: cause.code, constraint: cause.constraint, message: String(cause.message || '').slice(0, 200) } : undefined,
  };
}
