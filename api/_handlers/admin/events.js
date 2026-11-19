// @ts-nocheck
/**
 * X04 (expansion) — the editorial side of the academy pages and events (api/_services/academy-events.js). Reading needs an administrator session; every
 * change needs a NAMED administrator session with MFA (adminGate write) and is audited; nothing is published without the explicit « approve » step.
 * The route belongs to the « events » surface (not « admin »): opening the administration does not open it, and the capability « community.events »
 * refuses it 503 before this handler while closed.
 *   GET  /api/admin/events[?status=draft|review|published|cancelled|withdrawn]   { items }   events carry the organizer's COUNTS (never a person)
 *   GET  /api/admin/events?id=<id>                                              one item, its problems before approval, its counts
 *   POST /api/admin/events { action: 'save' | 'submit' | 'reject' | 'approve' | 'cancel' | 'withdraw', id?, draft?, note? }
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { academyEditorial, STATES } from '../../_services/academy-events.js';
import logger from '../../_utils/logger.js';

const STATUS = new Set(Object.values(STATES));
const ID = /^[0-9a-f-]{36}$/i;

export default async function handler(req, res) {
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await adminGate(req, res, { write: req.method === 'POST' });
  if (!auth) return undefined;
  const wf = academyEditorial();
  try {
    if (req.method === 'GET') {
      const id = String(req.query?.id || '');
      if (id) { if (!ID.test(id)) return res.status(400).json({ error: 'BAD_ID' }); const row = await wf.get(id); return row ? res.status(200).json(row) : res.status(404).json({ error: 'NOT_FOUND' }); }
      const status = String(req.query?.status || '');
      if (status && !STATUS.has(status)) return res.status(400).json({ error: 'BAD_STATUS' });
      return res.status(200).json({ items: await wf.list(status || null) });
    }
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = String(auth.email);
    const id = b.id ? String(b.id) : null;
    if (id && !ID.test(id)) return res.status(400).json({ error: 'BAD_ID' });
    if (b.action !== 'save' && !id) return res.status(400).json({ error: 'ID_REQUIRED' });
    switch (b.action) {
      case 'save': return res.status(id ? 200 : 201).json(await wf.save(actor, b.draft || {}, id));
      case 'submit': return res.status(200).json(await wf.submit(actor, id));
      case 'reject': return res.status(200).json(await wf.reject(actor, id, b.note));
      case 'approve': return res.status(200).json(await wf.approve(actor, id));
      case 'cancel': return res.status(200).json(await wf.cancel(actor, id, b.note));
      case 'withdraw': return res.status(200).json(await wf.withdraw(actor, id, b.note));
      default: return res.status(400).json({ error: 'UNKNOWN_ACTION' });
    }
  } catch (e) {
    if (e?.code && e?.status) return res.status(e.status).json({ error: e.code, ...(e.problems ? { problems: e.problems } : {}) });
    logger.error({ error: String(e?.message || '').slice(0, 200) }, '[admin/events] failed');
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
