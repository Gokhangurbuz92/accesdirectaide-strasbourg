// @ts-nocheck
import logger from '../../../_utils/logger.js';
import { db } from '../../../../src/db/index.js';
import { requireProStructureContext, requireProAuth } from '../../../_utils/auth.js';

/**
 * GET /api/pro/messages/conversations
 * List message conversations for the authenticated pro user's structure
 *
 * @param {import('../../../_utils/http-types').ApiRequest} req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    try {
        const { structureId } = proCtx;
        const conversations = await db.query.RdvConversation.findMany({
            where: (conv, { eq }) => eq(conv.structureId, structureId),
            orderBy: (conv, { desc }) => [desc(conv.updatedAt)],
            limit: 50,
        });

        return res.status(200).json({
            items: conversations,
            total: conversations.length,
        });
    } catch (error) {
        logger.error('pro.messages.conversations_failed', { error: error.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
}

export default requireProAuth(handler);
