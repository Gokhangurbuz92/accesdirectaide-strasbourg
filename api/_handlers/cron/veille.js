// @ts-nocheck
import { getCronAuth } from '../../_utils/cronAuth.js';
import { logger } from '../../lib/logger.js';
import { runVeille } from '../../_services/verification/chain.js';
import { bumpContentEpoch } from '../../lib/search-cache.js';

/**
 * Automatic verification (« veille automatique », api/_services/verification/chain.js) as a cron. A serverless function has minutes, not hours: the run is bounded
 * (ADA_VEILLE_MAX_MINUTES, default 4) and starts with the records checked the longest ago, so successive runs cover the whole catalogue. The texts (normal summary,
 * FALC) are written only where a LOCAL model is available (ADA_VEILLE_TEXTS=on, with Ollama on the same machine): elsewhere a record whose texts must be written
 * again is simply not published until they are (fail-closed). It reads official public sources only; ADA_VERIFICATION_NETWORK=off disables it.
 * @param {import('../../_utils/http-types').ApiRequest} req @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res, deps = {}) {
  const auth = getCronAuth(req);
  if (!auth.ok) {
    if (auth.reason === 'missing_secret') return res.status(500).json({ error: 'CRON_SECRET is not configured' });
    logger.warn('Unauthorized veille attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const r = await runVeille({ trigger: 'cron', texts: process.env.ADA_VEILLE_TEXTS === 'on', maxMinutes: Number(process.env.ADA_VEILLE_MAX_MINUTES) || 4, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
    if (r.ok) await bumpContentEpoch().catch(() => {});
    logger.info('VEILLE_END', { status: r.status, counts: r.counts });
    return res.status(200).json({ success: r.ok, ...r });
  } catch (error) {
    logger.error('VEILLE_FATAL', { name: error?.name });
    return res.status(500).json({ error: 'Veille failed' });
  }
}
