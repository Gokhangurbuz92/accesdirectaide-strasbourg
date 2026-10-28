// @ts-nocheck
import { db } from '../../../src/db/index.js';
import crypto from 'node:crypto';
import { createPrivacyRightsService } from '../../_services/privacy.js';
import { resolveCitizen } from '../../_utils/citizen-auth.js';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import * as Sentry from '@sentry/node';

export default async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // PKG-11 audit: the account behind the session is re-read (exists, verified, same e-mail) — a session token alone used to download the full export even after
    // an ownership recovery changed the e-mail to cut the old sessions
    const citizen = await resolveCitizen(req);
    if (!citizen) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = citizen.id;
    const limit = await checkRateLimit('DSR_EXPORT', `user:${userId}`);   // every export files a DSR request: bounded
    if (!limit.allowed) return res.status(getRateLimitStatus(limit)).json(limit.error || { error: 'Too many requests' });

    try {
        logger.info('[GDPR] Data export requested');

        const privacyService = createPrivacyRightsService({ db, cryptoLib: crypto });
        const { requestId, exportData } = await privacyService.executeExportRequest(userId);

        const filename = `export-donnees-${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('X-DSR-Request-Id', requestId);

        logger.info('[GDPR] Data export completed', { requestId });

        return res.status(200).json(exportData);
    } catch (error) {
        if (error?.code === 'SUBJECT_NOT_FOUND') {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        // @ts-ignore
        logger.error('[GDPR] Data export failed', { code: error?.code || 'UNEXPECTED_ERROR' });
        Sentry.captureException(error);
        return res.status(500).json({ error: 'Erreur lors de l\'export des données' });
    }
}
