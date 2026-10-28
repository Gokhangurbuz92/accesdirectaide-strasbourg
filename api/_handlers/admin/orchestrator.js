// @ts-nocheck
import { runOrchestrator } from '../../lib/agent-orchestrator.js';
import { verifyAdmin } from '../../_utils/auth.js';
import logger from '../../_utils/logger.js';

/**
 * POST /api/admin/orchestrator
 *
 * Runs the full AI orchestration pipeline:
 * Discovery → Enrichment → Validation
 *
 * Query: ?dryRun=true for testing without DB writes.
 * Auth: Admin token required.
 */
export default async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: 'Unauthorized: Admin Token Required' });
    }

    // Feature flag
    if (process.env.ENABLE_AI_AGENT !== 'true') {
        return res.status(503).json({ error: 'AI agents are disabled', flag: 'ENABLE_AI_AGENT' });
    }

    const dryRun = req.query?.dryRun === 'true' || req.body?.dryRun === true;

    try {
        const results = await runOrchestrator({ dryRun });

        return res.status(200).json({
            ok: true,
            dryRun,
            ...results,
        });
    } catch (error) {
        logger.error({ msg: 'orchestrator.handler.error', error: error.message });
        // @ts-ignore
        return res.status(500).json({ error: 'Orchestrator failed', message: error.message });
    }
}
