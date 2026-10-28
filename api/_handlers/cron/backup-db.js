import { getCronAuth } from '../../_utils/cronAuth.js';
import { logger } from '../../lib/logger.js';

/**
 * RETIRED (launch-readiness item 52). This job wrote a partial JSON copy of a few tables — conversations, audit lines with IP addresses — in clear into the
 * object storage, without expiry and without any restore path: a privacy liability, not a backup. It is no longer scheduled (vercel.json) and, if called,
 * reads and writes nothing.
 * Backups now: the database provider's point-in-time recovery (production), and the encrypted logical backup scripts/db-backup.mjs / db-restore.mjs
 * (docs/runbooks.md § Sauvegarde et restauration).
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    const auth = getCronAuth(req);
    if (!auth.ok) {
        if (auth.reason === 'missing_secret') return res.status(500).json({ error: 'CRON_SECRET is not configured' });
        logger.warn('Unauthorized Backup Attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.status(200).json({ success: true, skipped: 'retired', message: 'Export retiré : sauvegarde = restauration à un instant donné chez l’hébergeur de la base + scripts/db-backup.mjs (chiffré).' });
}
