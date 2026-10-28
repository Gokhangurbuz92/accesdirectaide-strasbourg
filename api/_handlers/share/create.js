import logger from '../../_utils/logger.js';
import crypto from 'node:crypto';
import { db } from '../../../src/db/index.js';
import { SharedDiagnostic } from '../../../src/db/schema.js';
import { sanitizeResultsForStorage } from '../../lib/shareResults.js';
import { resolveCitizen } from '../../_utils/citizen-auth.js';

const SHARE_TTL_DAYS = 7;

/**
 * POST /api/share/create
 *
 * Creates a diagnostic share with TWO distinct secrets (RC5): the SHARE token (read-only public view; it NEVER authorizes an organization) goes into the link fragment, the OWNER secret
 * (destructive rights: revoke, passport, structure access) is returned once to the creator. Only SHA-256 digests are persisted.
 */
export default async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { situation, results } = req.body || {};
    if (!situation || !results) {
        return res.status(400).json({
            error: 'invalid_payload',
            message: 'Les champs "situation" et "results" sont requis.',
        });
    }

    // DTA S1 2b-2: only the assessment contract is stored (never legacy eligible flags / amounts / totals, never client-supplied `_…` server keys).
    const cleaned = sanitizeResultsForStorage(results);
    if (!cleaned.ok) {
        return res.status(400).json({
            error: 'invalid_payload',
            message: 'Le champ "results" n\'est pas conforme.',
        });
    }

    try {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + SHARE_TTL_DAYS);

        // PKG-1 / K0: a dossier created under a verified citizen session is owned by that account too (the owner secret still works); otherwise it stays account-free.
        const citizen = await resolveCitizen(req).catch(() => null);
        const shareToken = crypto.randomBytes(32).toString('base64url');
        const ownerSecret = crypto.randomBytes(32).toString('base64url');
        const sha256 = (/** @type {string} */ v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');

        const [shared] = await db.insert(SharedDiagnostic).values({
            id: crypto.randomUUID(),
            situation,
            results: cleaned.value,
            expiresAt,
            viewCount: 0,
            rightsSecretHash: sha256(ownerSecret),
            shareTokenHash: sha256(shareToken),
            subjectType: citizen ? 'CITIZEN_SHARE' : 'GUEST_SHARE',
            ownerCitizenId: citizen ? citizen.id : null,
            privacySubjectId: citizen ? citizen.id : null,
        }).returning();

        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        return res.status(200).json({
            success: true,
            shareId: shared.id,
            shareUrl: `/share/${shared.id}#capability=${encodeURIComponent(shareToken)}`,
            ownerSecret,
            passportUrl: `/passport/${shared.id}#owner=${encodeURIComponent(ownerSecret)}`,
            expiresAt: shared.expiresAt,
        });
    } catch (error) {
        logger.error({
            err: {
                name: error instanceof Error ? error.name : 'Error',
                message: 'Share creation failed',                                      // never error.message: a failed INSERT's message can embed the query parameters (situation / results)
            },
        }, '[Share Create Error]');
        return res.status(500).json({
            error: 'create_failed',
            message: 'Impossible de créer le lien de partage.',
        });
    }
}
