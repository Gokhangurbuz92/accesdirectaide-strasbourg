// @ts-nocheck
import logger from '../../_utils/logger.js';
import { requireProAuth, requireProStructureContext } from '../../_utils/auth.js';
import crypto from 'node:crypto';
import { authorizeUrl, connectionOf, disconnect, outlookStatus, stateCookie } from '../../_services/calendar-outlook.js';

/**
 * Outlook calendar connection of the signed-in professional (PKG-3 / B10 redesign — see api/_services/calendar-outlook.js).
 *   GET  /api/pro/outlook?action=authorize  -> { authUrl } (a SIGNED state bound to this professional; the browser goes there)
 *   GET  /api/pro/outlook?action=status     -> connected / not_connected / reconnect_required
 *   POST /api/pro/outlook?action=disconnect -> tokens deleted
 * The code exchange happens only in GET /api/auth/callback/outlook (api/_handlers/auth/outlook-callback.js). OFF by default: answers `not_configured`.
 */
async function handler(req, res) {
    // PKG-11 audit: a disabled or moved account keeps a « revoked » context that belongs to no organization; this route acts on the user alone, so it refuses it
    if (req.user?.role === 'revoked') return res.status(404).json({ error: 'Not found' });
  res.setHeader('Cache-Control', 'no-store');
  const status = outlookStatus();
  if (!status.enabled) {
    return res.status(200).json({ ok: false, status: status.reason === 'NOT_CONFIGURED' ? 'not_configured' : 'disabled', reason: status.reason, message: 'Outlook n\'est pas encore activé.' });
  }
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return undefined;
  const action = new URL(req.url || '/', 'https://localhost').searchParams.get('action') || req.query?.action || '';
  try {
    if (action === 'authorize' && req.method === 'GET') {
      // R12: the link is bound to THIS browser (HttpOnly cookie): sent to someone else it links nothing
      const nonce = crypto.randomBytes(16).toString('base64url');
      res.setHeader('Set-Cookie', stateCookie(nonce));
      return res.status(200).json({ ok: true, authUrl: authorizeUrl({ userId: proCtx.userId, structureId: proCtx.structureId }, process.env, nonce) });
    }
    if (action === 'status' && req.method === 'GET') {
      const c = await connectionOf(proCtx.userId);
      if (!c.connected) return res.status(200).json({ ok: true, status: c.reconnectRequired ? 'reconnect_required' : 'not_connected', outlookEnabled: true });
      return res.status(200).json({ ok: true, status: new Date(c.expiresAt) < new Date() ? 'token_expired' : 'connected', expiresAt: new Date(c.expiresAt).toISOString(), scope: c.scope, outlookEnabled: true });
    }
    if (action === 'disconnect' && req.method === 'POST') { await disconnect(proCtx.userId); return res.status(200).json({ ok: true, status: 'disconnected' }); }
    return res.status(400).json({ error: 'Action invalide. Attendu: authorize, status, disconnect.' });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Outlook] failed');
    return res.status(500).json({ error: 'Erreur Outlook.' });
  }
}

export default requireProAuth(handler);
