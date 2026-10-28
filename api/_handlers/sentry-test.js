// PKG-6 / D21: this diagnostic endpoint used to call Sentry.init() itself, at import time and WITHOUT the scrubber — importing it would have replaced the
// scrubbed client of the whole process. It now uses the single central client (api/_utils/sentryServer.js: beforeSend = sanitizeSentryEvent).
import Sentry from '../_utils/sentryServer.js';
import { env } from '../_utils/env.js';

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    if (!env.flags.publicDiagnostics) {
        return res.status(404).send('Not Found');
    }
    try {
        throw new Error("Sentry Server Test Error: Manually triggered.");
    } catch (error) {
        Sentry.captureException(error);
        // Flush to ensure event is sent before serverless function freezes
        await Sentry.flush(2000);

        return res.status(500).json({
            error: "Manually triggered error reported to Sentry.",
            message: (/** @type {Error} */ (error)).message
        });
    }
}
