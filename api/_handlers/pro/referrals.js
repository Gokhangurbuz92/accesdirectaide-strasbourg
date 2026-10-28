// @ts-nocheck
import { requireProStructureContext } from '../../_utils/auth.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { act, eligibleReceivers, getReferral, listBox, propose } from '../../_services/referrals.js';

/**
 * PKG-4 / R09 R10 R11 E06 — referrals of the caller's organization (rules in api/_services/referrals.js).
 *   GET ?box=inbox|outbox  -> list          GET ?id=  -> one referral (sender or receiver side)          GET ?receivers=<q>  -> verified receiving organizations
 *   POST { action: 'propose', caseId, toStructureId, reasonCode, message, idempotencyKey }
 *   POST { action: 'acknowledge'|'accept'|'decline'|'needs_info'|'link_appointment'|'start'|'complete'|'reply'|'cancel'|'close', id, ... }
 */
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = requireProStructureContext(req, res);
  if (!ctx) return undefined;
  const send = (out) => (out.ok === false ? res.status(out.status || 400).json({ error: out.code, message: out.message }) : res.status(out.status || 200).json((({ ok, status, ...b }) => b)(out)));
  const q = req.query || {};
  if (req.method === 'GET') {
    if (q.receivers !== undefined) return res.status(200).json({ receivers: await eligibleReceivers(ctx, String(q.receivers || '')) });
    return send(q.id ? await getReferral(ctx, q.id) : await listBox(ctx, String(q.box || 'inbox')));
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (b.action === 'propose') return send(await propose(ctx, b));
  return send(await act(ctx, b.id, String(b.action || ''), b));
}

export default withProRdvHandler('pro.referrals', handler);
