// @ts-nocheck
import { getCronAuth } from '../../_utils/cronAuth.js';
import { kv } from '../../_utils/kv.js';
import logger from '../../_utils/logger.js';

/**
 * Reset stale KV locks for cron jobs.
 *
 * Usage:
 *   GET /api/cron/reset-lock?job=actualites
 *   Headers: x-cron-secret: <CRON_SECRET>
 *
 * Supported jobs: actualites (clears both KV lock + pipeline lock)
 */

const LOCK_KEYS = {
    actualites: [
        'cron:actualites:lock',
        'pipeline:lock:ingest-actualites-rss',
    ],
    structures: ['pipeline:lock:ingest-structures'],
    aides: ['pipeline:lock:ingest-aids'],
    demarches: ['pipeline:lock:ingest-demarches'],
};

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const auth = getCronAuth(req);
    if (!auth.ok) {
        if (auth.reason === 'missing_secret') {
            return res.status(500).json({ error: 'CRON_SECRET is not configured' });
        }
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const job = req.query?.job;
    if (!job || !LOCK_KEYS[job]) {
        return res.status(400).json({
            error: `Missing or invalid 'job' parameter. Valid: ${Object.keys(LOCK_KEYS).join(', ')}`,
        });
    }

    // @ts-ignore
    const keys = LOCK_KEYS[job];
    const results = [];

    for (const key of keys) {
        try {
            const existing = await kv.get(key);
            if (existing) {
                await kv.del(key);
                results.push({ key, status: 'deleted', previousValue: String(existing).slice(0, 50) });
                logger.info({ job, key }, 'cron.lock.reset.success');
            } else {
                results.push({ key, status: 'not_found' });
            }
        } catch (err) {
            // @ts-ignore
            results.push({ key, status: 'error', message: err.message });
            // @ts-ignore
            logger.error({ job, key, error: err.message }, 'cron.lock.reset.error');
        }
    }

    return res.status(200).json({
        ok: true,
        job,
        locks: results,
    });
}
