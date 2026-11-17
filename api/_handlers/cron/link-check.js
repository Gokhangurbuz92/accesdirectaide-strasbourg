// @ts-nocheck
import { getCronAuth, scheduledByVercel } from '../../_utils/cronAuth.js';
import { logger } from '../../lib/logger.js';
import { runLinkCheck, LIMITS } from '../../_services/link-check.js';
import { startCronRun, finishCronRun, countsOnly } from '../../_utils/cron-run.js';
import { db } from '../../../src/db/index.js';

/**
 * Link check cron (api/_services/link-check.js). It contacts external OFFICIAL sites (allow-list only, bounded, spaced), so it runs only when the owner enables it:
 * LINK_CHECK_ENABLED=1. Otherwise it answers that it is disabled and requests nothing.
 * C2 (owner Paket 4, RB-01): scheduled weekly in vercel.json; in the restricted beta it is ALSO closed until named in ADA_BETA_OPEN_JOBS (category A,
 * api/_utils/public-beta.js) — two switches. Bounded per run: LINK_CHECK_MAX_REQUESTS (default 200, at most 1000 HTTP requests), LINK_CHECK_BUDGET_SECONDS
 * (default 200 s, at most 220 s: with 8 requests × 8 s for the last address started, under the function's 300 s limit), 8 s per request. Report only: results in SourceSnapshot (/admin/liens) and, after two
 * consecutive 404/410, a review item for a person — nothing is published, withdrawn or deleted. Every call leaves a CronRun row (counts only).
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
const bounded = (raw, fallback, cap) => { const n = parseInt(String(raw ?? ''), 10); return Number.isFinite(n) && n >= 1 ? Math.min(n, cap) : fallback; };

export default async function handler(req, res, deps = {}) {
    const auth = getCronAuth(req);
    if (!auth.ok) {
        if (auth.reason === 'missing_secret') return res.status(500).json({ error: 'CRON_SECRET is not configured' });
        logger.warn('Unauthorized link-check attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const database = deps.db || db;
    const startedAtMs = Date.now();
    const cronRunId = await startCronRun(database, 'link-check', { trigger: scheduledByVercel(req) ? 'vercel-cron' : 'manual' });
    if (process.env.LINK_CHECK_ENABLED !== '1') {
        await finishCronRun(database, cronRunId, { status: 'skipped', skipReason: 'LINK_CHECK_DISABLED', startedAtMs });
        return res.status(200).json({ success: true, skipped: 'disabled', message: 'Vérification des liens désactivée (LINK_CHECK_ENABLED).' });
    }
    try {
        const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 500, 1), 2000);
        const maxRequests = bounded(process.env.LINK_CHECK_MAX_REQUESTS, LIMITS.maxRequests, LIMITS.maxRequestsCap);
        const budgetMs = bounded(process.env.LINK_CHECK_BUDGET_SECONDS, LIMITS.budgetMs / 1000, LIMITS.budgetMsCap / 1000) * 1000;
        const stats = await runLinkCheck({ db: database, limitPerKind: limit, maxRequests, budgetMs, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
            ...(deps.spacingMs !== undefined ? { spacingMs: deps.spacingMs } : {}), ...(deps.clock ? { clock: deps.clock } : {}) });
        logger.info('LINK_CHECK_END', { stats: countsOnly(stats) });
        await finishCronRun(database, cronRunId, { status: stats.stoppedEarly ? 'partial' : 'success', startedAtMs, metrics: { ...countsOnly(stats), maxRequests, budgetMs } });
        return res.status(200).json({ success: true, ...stats });
    } catch (error) {
        logger.error('LINK_CHECK_FATAL', { name: error?.name });
        await finishCronRun(database, cronRunId, { status: 'failed', startedAtMs, error: error?.name || 'Error' });
        return res.status(500).json({ error: 'Link check failed' });
    }
}
