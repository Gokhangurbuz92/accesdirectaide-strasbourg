// @ts-nocheck
/**
 * X03 (expansion) — the moderation of ENTRAIDE (api/_services/entraide.js). ⚠ A DEDICATED AIPD IS MANDATORY BEFORE ANY OPENING. READING needs a NAMED
 * administrator session with MFA too (adminGate write); every read and decision is audited (AuditLog). The moderator works on PSEUDONYMS: it sees the state,
 * the number of reports per reason and the open offers — never the account, its e-mail, the member id, who reported, the request notes or the shared e-mails.
 * The route belongs to the « entraide » surface (not « admin »): opening the administration does not open it, and « community.entraide » refuses it 503
 * before this handler while closed.
 *   GET  /api/admin/entraide?queue=reported|suspended     { items }
 *   POST /api/admin/entraide { action: 'suspend', pseudonym, reason } | { action: 'reinstate' | 'dismiss_reports', pseudonym } | { action: 'close_offer', offerId, reason }
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { QUEUES, entraideModeration } from '../../_services/entraide.js';
import logger from '../../_utils/logger.js';

const ID = /^[0-9a-f-]{36}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await adminGate(req, res, { write: true });
  if (!auth) return undefined;
  const mod = entraideModeration();
  const actor = String(auth.email);
  try {
    if (req.method === 'GET') {
      const queue = String(req.query?.queue || 'reported');
      if (!QUEUES.includes(queue)) return res.status(400).json({ error: 'BAD_QUEUE' });
      return res.status(200).json({ items: await mod.list(actor, queue) });
    }
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    switch (b.action) {
      case 'suspend': return res.status(200).json(await mod.suspend(actor, b.pseudonym, b.reason));
      case 'reinstate': return res.status(200).json(await mod.reinstate(actor, b.pseudonym));
      case 'dismiss_reports': return res.status(200).json(await mod.dismissReports(actor, b.pseudonym));
      case 'close_offer':
        if (typeof b.offerId !== 'string' || !ID.test(b.offerId)) return res.status(400).json({ error: 'ID_REQUIRED' });
        return res.status(200).json(await mod.closeOffer(actor, b.offerId, b.reason));
      default: return res.status(400).json({ error: 'UNKNOWN_ACTION' });
    }
  } catch (e) {
    if (e?.code && e?.status) return res.status(e.status).json({ error: e.code });
    logger.error({ error: String(e?.message || '').slice(0, 200) }, '[admin/entraide] failed');
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
