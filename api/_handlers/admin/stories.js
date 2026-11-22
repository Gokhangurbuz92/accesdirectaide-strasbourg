// @ts-nocheck
/**
 * X01 (expansion) — the moderation queue of the community stories (api/_services/community-stories.js). The queue holds texts that are not public yet:
 * READING it needs a NAMED administrator session with MFA too (adminGate write), and every read and every decision is audited (AuditLog). The moderator sees
 * the title, the text, the pseudonym, the language, the times and the number of reports per reason — never the account, its e-mail, the member id, or who
 * reported. The route belongs to the « stories » surface (not « admin »): opening the administration does not open it, and the capability
 * « community.stories » refuses it 503 before this handler while closed.
 *   GET  /api/admin/stories?queue=pending|reported|published     { items }
 *   POST /api/admin/stories { action: 'approve' | 'reject' | 'takedown' | 'dismiss_reports', id, reason? }   reject / takedown erase the text (reason required)
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { QUEUES, storyModeration } from '../../_services/community-stories.js';
import logger from '../../_utils/logger.js';
import { db as defaultDb } from '../../../src/db/index.js';
import { moderatedAction, requireStaffRole } from '../../_services/moderation-dsa.js';

const ID = /^[0-9a-f-]{36}$/i;

export default async function handler(req, res) {
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await adminGate(req, res, { write: true });
  if (!auth) return undefined;
  const mod = storyModeration();
  const actor = String(auth.email);
  // G14: only a NAMED moderator (role assigned to this MFA administrator account) reads the queue and decides; no named moderator at all = closed
  const refused = await requireStaffRole(defaultDb, actor, 'stories');
  if (refused) return res.status(refused.status).json({ error: refused.code, reason: refused.reason, message: refused.message });
  // G14 / DSA art. 16(5), 17: every restriction and every decision on reports is recorded with its statement of reasons (facts required) and delivered
  const act = (decisionAction, reasonCode, run) => moderatedAction({ db: defaultDb }, { actor, contentType: 'story', contentId: id, decisionAction, reasonCode, body: b, run });
  let id = null; let b = {};
  try {
    if (req.method === 'GET') {
      const queue = String(req.query?.queue || 'pending');
      if (!QUEUES.includes(queue)) return res.status(400).json({ error: 'BAD_QUEUE' });
      return res.status(200).json({ items: await mod.list(actor, queue) });
    }
    b = req.body && typeof req.body === 'object' ? req.body : {};
    id = typeof b.id === 'string' && ID.test(b.id) ? b.id : null;
    if (!id) return res.status(400).json({ error: 'ID_REQUIRED' });
    switch (b.action) {
      case 'approve': return res.status(200).json(await mod.approve(actor, id));
      case 'reject': return res.status(200).json(await act('rejected', b.reason, () => mod.reject(actor, id, b.reason)));
      case 'takedown': return res.status(200).json(await act('taken_down', b.reason, () => mod.takedown(actor, id, b.reason)));
      case 'dismiss_reports': return res.status(200).json(await act('reports_dismissed', 'REPORTS_UNFOUNDED', () => mod.dismissReports(actor, id)));
      default: return res.status(400).json({ error: 'UNKNOWN_ACTION' });
    }
  } catch (e) {
    if (e?.code && e?.status) return res.status(e.status).json({ error: e.code, ...(e.problems ? { problems: e.problems } : {}) });
    logger.error({ error: String(e?.message || '').slice(0, 200) }, '[admin/stories] failed');
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
