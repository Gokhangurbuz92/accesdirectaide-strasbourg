// @ts-nocheck
/**
 * G14 — the moderation desk: named roles (owner decisions 10, 11), account-free notices (DSA art. 16), appeals (art. 20), misuse measures (art. 23), the
 * art. 18 record and the transparency counts (charter § 10). A NAMED administrator session with MFA (adminGate write) for everything, reads included.
 *   GET  /api/admin/moderation?view=staffing                     staffing state of every feature (who is needed, who is assigned: counts and names)
 *   GET  /api/admin/moderation?view=roles                        assignments (any MFA administrator: roles are needed BEFORE anyone can moderate)
 *   GET  /api/admin/moderation?view=notices&status=received|decided    (moderator)
 *   GET  /api/admin/moderation?view=appeals&status=open|upheld|reversed|modified    (moderator)
 *   GET  /api/admin/moderation?view=transparency&from=YYYY-MM-DD&to=YYYY-MM-DD    counts only (moderator)
 *   GET  /api/admin/moderation?view=misuse&userId=…              art. 23(3) counts for one account (moderator)
 *   POST { action: 'role_assign', email, role, charterAcknowledged: true } | { action: 'role_revoke', email, role }      (any MFA administrator)
 *   POST { action: 'notice_record_email', …notice } | { action: 'notice_close', id, outcome: 'no_action' | 'not_processed' | 'action_taken', facts?, decisionId? }
 *   POST { action: 'appeal_review', id, outcome: 'upheld' | 'reversed' | 'modified', response }
 *   POST { action: 'sanction', kind: 'warning' | 'suspension', scope: 'publishing' | 'notices', userId? | noticeId?, reason, days? } | { action: 'sanction_lift', id }
 *   POST { action: 'authorities_informed', decisionId }
 * The route is in the « admin » surface and NOT behind a content capability: the owner must be able to assign the named persons before opening anything.
 */
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { db as defaultDb } from '../../../src/db/index.js';
import { ROLES, activeStaff, contentNotices, moderationDesk, rolesOf, roleAdministration, staffingState } from '../../_services/moderation-dsa.js';
import logger from '../../_utils/logger.js';

const ID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAFF_ACTIONS = new Set(['notice_record_email', 'notice_close', 'appeal_review', 'sanction', 'sanction_lift', 'authorities_informed']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await adminGate(req, res, { write: true });
  if (!auth) return undefined;
  const actor = String(auth.email);
  /** a moderator or (X03) the safety officer — the desk is staffed by named persons only */
  const requireStaff = async () => {
    const roles = await rolesOf(defaultDb, actor);
    if (roles.has(ROLES.moderator) || roles.has(ROLES.safety)) return null;
    res.status(403).json({ error: 'MODERATOR_ROLE_REQUIRED', message: 'Cette action est réservée aux modérateurs nommés.' });
    return true;
  };
  const desk = moderationDesk();
  try {
    if (req.method === 'GET') {
      const view = String(req.query?.view || 'staffing');
      if (view === 'staffing') {
        const staff = await activeStaff(defaultDb);
        return res.status(200).json({ ...(await staffingState(defaultDb)), staff: staff.map((s) => ({ name: s.name, email: s.email, role: s.role, assignedAt: s.assignedAt })) });
      }
      if (view === 'roles') return res.status(200).json(await roleAdministration().list());
      if (await requireStaff()) return undefined;
      if (view === 'notices') return res.status(200).json({ items: await contentNotices().list(actor, String(req.query?.status || 'received')) });
      if (view === 'appeals') {
        const status = String(req.query?.status || 'open');
        if (!['open', 'upheld', 'reversed', 'modified'].includes(status)) return res.status(400).json({ error: 'BAD_STATUS' });
        return res.status(200).json({ items: await desk.appeals(actor, status) });
      }
      if (view === 'transparency') {
        const from = DAY.test(String(req.query?.from || '')) ? new Date(`${req.query.from}T00:00:00Z`) : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
        const to = DAY.test(String(req.query?.to || '')) ? new Date(`${req.query.to}T00:00:00Z`) : new Date();
        return res.status(200).json(await desk.transparency(from, to));
      }
      if (view === 'misuse') {
        const userId = String(req.query?.userId || '');
        if (!userId) return res.status(400).json({ error: 'ID_REQUIRED' });
        return res.status(200).json(await desk.misuseCounts(userId));
      }
      return res.status(400).json({ error: 'BAD_VIEW' });
    }
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (b.action === 'role_assign') return res.status(201).json(await roleAdministration().assign(actor, b));
    if (b.action === 'role_revoke') return res.status(200).json(await roleAdministration().revoke(actor, b));
    if (!STAFF_ACTIONS.has(b.action)) return res.status(400).json({ error: 'UNKNOWN_ACTION' });
    if (await requireStaff()) return undefined;
    const id = typeof b.id === 'string' && ID.test(b.id) ? b.id : null;
    switch (b.action) {
      case 'notice_record_email': {
        const out = await contentNotices().recordEmailNotice(actor, b);
        return res.status(out.status || 201).json(out);
      }
      case 'notice_close':
        if (!id) return res.status(400).json({ error: 'ID_REQUIRED' });
        return res.status(200).json(await contentNotices().close(actor, id, { outcome: b.outcome, facts: b.facts, decisionId: b.decisionId }));
      case 'appeal_review':
        if (!id) return res.status(400).json({ error: 'ID_REQUIRED' });
        return res.status(200).json(await desk.reviewAppeal(actor, id, { outcome: b.outcome, response: b.response }));
      case 'sanction': return res.status(201).json(await desk.sanction(actor, { kind: b.kind, scope: b.scope, userId: b.userId || null, noticeId: b.noticeId || null, reason: b.reason, days: b.days }));
      case 'sanction_lift':
        if (!id) return res.status(400).json({ error: 'ID_REQUIRED' });
        return res.status(200).json(await desk.liftSanction(actor, id));
      case 'authorities_informed':
        if (typeof b.decisionId !== 'string' || !ID.test(b.decisionId)) return res.status(400).json({ error: 'ID_REQUIRED' });
        return res.status(200).json(await desk.recordAuthoritiesInformed(actor, b.decisionId));
      default: return res.status(400).json({ error: 'UNKNOWN_ACTION' });
    }
  } catch (e) {
    if (e?.code && e?.status) return res.status(e.status).json({ error: e.code, ...(e.problems ? { problems: e.problems } : {}), ...(e.reviewableFrom ? { reviewableFrom: e.reviewableFrom } : {}) });
    logger.error({ error: String(e?.message || '').slice(0, 200) }, '[admin/moderation] failed');
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
