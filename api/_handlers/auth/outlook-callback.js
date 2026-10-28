// @ts-nocheck
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { AuditLog } from '../../../src/db/schema.js';
import { exchangeCode, outlookStatus, storeTokens, verifyStateForBrowser, STATE_COOKIE } from '../../_services/calendar-outlook.js';

/**
 * GET /api/auth/callback/outlook?code=…&state=… — Microsoft redirects the professional's browser here (PKG-3 / B10 redesign).
 * The state must be the SIGNED, unexpired one issued to a professional by /api/pro/outlook?action=authorize; the tokens are stored in THE single strict envelope and linked
 * to that professional only (active, same structure). Anything else is refused without exchanging the code. Nothing sensitive is logged or echoed.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!outlookStatus().enabled) return res.status(404).json({ error: 'Outlook n\'est pas activé.' });
  const url = new URL(req.url || '/', 'https://localhost');
  const code = url.searchParams.get('code') || req.query?.code;
  let pro = null;
  // R12: the signed state, from the browser that asked for it (its cookie, cleared below: one use per browser)
  try { pro = await verifyStateForBrowser(url.searchParams.get('state') || req.query?.state, { cookieHeader: req.headers?.cookie }); } catch { pro = null; }
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=/api/auth/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  if (!code || !pro) return res.status(400).json({ error: 'Lien de connexion Outlook invalide ou expiré. Recommencez depuis votre espace professionnel.' });
  try {
    const ex = await exchangeCode(code);
    if (!ex.ok) return res.status(400).json({ error: 'Microsoft a refusé la connexion. Recommencez depuis votre espace professionnel.' });
    const stored = await storeTokens(pro, ex.tokens);
    if (!stored.ok) return res.status(403).json({ error: 'Ce compte professionnel ne peut pas être relié.' });
    await db.insert(AuditLog).values({ action: 'OUTLOOK_CONNECTED', entity: 'ProOutlookToken', entity_id: stored.userId, details: { encrypted: true } }).catch(() => {});
    res.setHeader('Location', '/pro/dashboard?outlook=connected');
    return res.status(302).end();
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Outlook callback] failed');
    return res.status(500).json({ error: 'Erreur lors de la connexion Outlook.' });
  }
}
