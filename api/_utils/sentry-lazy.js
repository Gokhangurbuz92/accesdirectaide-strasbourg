/**
 * Lazy Sentry Loader — Fluid Compute Optimization
 *
 * Defers @sentry/node initialization until the first error actually occurs.
 * This removes ~250KB of Sentry SDK from the cold-start critical path
 * while preserving full error tracking functionality.
 *
 * Usage:
 *   import { lazyCaptureException, lazyCaptureMessage } from '../../_utils/sentry-lazy.js';
 *
 *   catch (error) {
 *     await lazyCaptureException(error, { tags: { route: 'myRoute' } });
 *   }
 */

/** @type {typeof import('@sentry/node') | null} */
let _sentry = null;

/**
 * Lazily loads the initialized Sentry instance (cached after first call).
 * Imports from sentryServer.js which handles Sentry.init() + PII scrubbing.
 */
async function getSentry() {
  if (!_sentry) {
    const mod = await import('./sentryServer.js');
    _sentry = mod.default;
  }
  return _sentry;
}

/**
 * Lazily captures an exception with Sentry.
 * @param {Error} error
 * @param {import('@sentry/node').CaptureContext} [context]
 */
export async function lazyCaptureException(error, context) {
  try {
    const Sentry = await getSentry();
    Sentry.captureException(error, context);
  } catch {
    // Sentry itself failed — don't crash the handler
  }
}

/**
 * Lazily captures a message with Sentry.
 * @param {string} message
 * @param {import('@sentry/node').CaptureContext} [context]
 */
export async function lazyCaptureMessage(message, context) {
  try {
    const Sentry = await getSentry();
    Sentry.captureMessage(message, context);
  } catch {
    // Sentry itself failed — don't crash the handler
  }
}

/**
 * Lazily runs a callback within a Sentry scope.
 * @param {(scope: import('@sentry/node').Scope) => void} callback
 */
export async function lazyWithScope(callback) {
  try {
    const Sentry = await getSentry();
    Sentry.withScope(callback);
  } catch {
    // Sentry itself failed — don't crash the handler
  }
}

export default { lazyCaptureException, lazyCaptureMessage, lazyWithScope, getSentry };
