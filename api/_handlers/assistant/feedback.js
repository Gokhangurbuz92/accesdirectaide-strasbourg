import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { ConversationLog } from '../../../src/db/schema.js';
import { and, eq, isNull } from 'drizzle-orm';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';

/**
 * POST /api/assistant/feedback
 *
 * Records user satisfaction feedback on an AI response.
 * Accepts: { logId: string, rating: 1 | -1, comment?: string }
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    // R12: rate limited (was unbounded)
    const limited = await checkRateLimit('ASSISTANT_FEEDBACK', getClientIp(req));
    if (!limited.allowed) return res.status(getRateLimitStatus(/** @type {any} */ (limited))).json(limited.error || { error: 'rate_limited' });

    const { logId, rating, comment } = req.body || {};

    if (!logId || (rating !== 1 && rating !== -1)) {
        return res.status(400).json({
            error: 'invalid_payload',
            message: 'Les champs "logId" (string) et "rating" (1 ou -1) sont requis.',
        });
    }

    try {
        const updated = await db.update(ConversationLog).set({
            rating,
            userComment: comment ? String(comment).slice(0, 500) : null,
        }).where(and(eq(ConversationLog.id, String(logId)), isNull(ConversationLog.rating))).returning();   // R12: one rating per log, never overwritten by anyone holding an id

        if (!updated.length) {
            return res.status(404).json({
                error: 'not_found',
                message: 'Ce log de conversation est introuvable ou a déjà été évalué.',
            });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        logger.error({ err: error }, '[Feedback Error]:');

        return res.status(500).json({
            error: 'update_failed',
            message: 'Impossible d\'enregistrer le feedback.',
        });
    }
}
