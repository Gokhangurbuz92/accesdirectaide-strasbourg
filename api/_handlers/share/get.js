import logger from '../../_utils/logger.js';
import crypto from 'node:crypto';
import { db } from '../../../src/db/index.js';
import { SharedDiagnostic } from '../../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { legacyShareReadEnabled } from '../../_utils/share-access.js';
import { presentResults } from '../../lib/shareResults.js';

/**
 * @param {string} rawCapability
 * @param {string | null} expectedHash
 */
function verifyCapability(rawCapability, expectedHash) {
    const capability = String(rawCapability || '').trim();
    const stored = String(expectedHash || '').trim().toLowerCase();
    if (!capability || capability.length > 512 || !/^[a-f0-9]{64}$/.test(stored)) return false;
    const actual = crypto.createHash('sha256').update(capability, 'utf8').digest();
    const expected = Buffer.from(stored, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * POST /api/share/get
 *
 * Retrieves a shared diagnostic only when the fragment-derived capability is
 * presented in the request body. Invalid ID/capability pairs fail closed.
 */
export default async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const id = String(req.body?.id || '').trim();
    const capability = String(req.body?.capability || '').trim();
    if (!id || !capability) {
        return res.status(404).json({
            error: 'not_found',
            message: 'Ce dossier est introuvable ou inaccessible.',
        });
    }

    try {
        const shared = await db.query.SharedDiagnostic.findFirst({
            where: eq(SharedDiagnostic.id, id),
        });

        // RC5: the SHARE token (read-only). Rows created before RC5 have no distinct token: their single link secret is accepted (until the 7-day expiry).
        if (!shared || !verifyCapability(capability, shared.shareTokenHash || (legacyShareReadEnabled() ? shared.rightsSecretHash : null))) {
            return res.status(404).json({
                error: 'not_found',
                message: 'Ce dossier est introuvable ou inaccessible.',
            });
        }

        if (new Date() > new Date(shared.expiresAt)) {
            return res.status(410).json({
                error: 'expired',
                message: 'Ce lien de partage a expiré. Demandez un nouveau lien à l\'usager.',
            });
        }

        db.update(SharedDiagnostic)
            .set({ viewCount: sql`${SharedDiagnostic.viewCount} + 1` })
            .where(eq(SharedDiagnostic.id, id))
            .execute()
            .catch(() => { });

        const currentViewCount = Number(shared.viewCount || 0);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        return res.status(200).json({
            success: true,
            data: {
                id: shared.id,
                createdAt: shared.createdAt,
                expiresAt: shared.expiresAt,
                situation: shared.situation,
                results: presentResults(shared.results),                          // DTA S1 2b-2: legacy eligible flags / amounts of older rows are never handed out
                viewCount: currentViewCount + 1,
            },
        });
    } catch (error) {
        logger.error({
            err: {
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error ? error.message : 'Share retrieval failed',
            },
        }, '[Share Get Error]');
        return res.status(500).json({
            error: 'fetch_failed',
            message: 'Impossible de récupérer le dossier.',
        });
    }
}
