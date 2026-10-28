// @ts-nocheck
import { getCronAuth } from '../../_utils/cronAuth.js';
import { logger } from '../../lib/logger.js';
import { runLinkCheck } from '../../_services/link-check.js';

/**
 * Link check cron (api/_services/link-check.js). It contacts external OFFICIAL sites (allow-list only, bounded, spaced), so it runs only when the owner enables it:
 * LINK_CHECK_ENABLED=1. Otherwise it answers that it is disabled and requests nothing.
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res, deps = {}) {
    const auth = getCronAuth(req);
    if (!auth.ok) {
        if (auth.reason === 'missing_secret') return res.status(500).json({ error: 'CRON_SECRET is not configured' });
        logger.warn('Unauthorized link-check attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (process.env.LINK_CHECK_ENABLED !== '1') return res.status(200).json({ success: true, skipped: 'disabled', message: 'Vérification des liens désactivée (LINK_CHECK_ENABLED).' });
    try {
        const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 500, 1), 2000);
        const stats = await runLinkCheck({ limitPerKind: limit, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.spacingMs !== undefined ? { spacingMs: deps.spacingMs } : {}) });
        logger.info('LINK_CHECK_END', { stats });
        return res.status(200).json({ success: true, ...stats });
    } catch (error) {
        logger.error('LINK_CHECK_FATAL', { name: error?.name });
        return res.status(500).json({ error: 'Link check failed' });
    }
}
