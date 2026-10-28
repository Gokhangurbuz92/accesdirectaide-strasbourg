// @ts-nocheck
import { requireProAuth, revokeProSessions, logProAudit } from '../../../_utils/auth.js';
import logger from '../../../_utils/logger.js';
import { clientIp } from '../../../_utils/client-ip.js';

/**
 * PKG-11 audit — POST /api/pro/auth/logout: ends the professional's sessions ON THE SERVER (every device: sessions are revoked at account level), audited.
 * Before, « Déconnexion » only removed the token from the browser: the 8 h token stayed valid and refreshable.
 */
async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
    const userId = String(req.auth?.userId || req.user?.userId || '');
    try {
        await revokeProSessions(userId);
        await logProAudit('PRO_LOGOUT', userId, String(req.auth?.structureId || ''), { scope: 'all_sessions' }, clientIp(req));
        return res.status(200).json({ ok: true });
    } catch (err) {
        logger.error({ err: { name: err?.name } }, '[Pro Auth] logout failed');
        return res.status(503).json({ error: 'Déconnexion impossible pour le moment. Fermez votre navigateur et réessayez.' });
    }
}

export default requireProAuth(handler);
