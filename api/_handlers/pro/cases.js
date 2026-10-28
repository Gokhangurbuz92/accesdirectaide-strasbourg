// @ts-nocheck
import { requireProStructureContext } from '../../_utils/auth.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { addNote, assign, close, getCase, listQueue, reopen, setStatus } from '../../_services/pro-cases.js';

/**
 * PKG-4 / R03 R06 R07 R08 R11 — ADA Pro cases of the caller's organization (api/_services/pro-cases.js holds every rule).
 *   GET ?scope=mine|unassigned|all  -> work queue (metadata only)        GET ?id=  -> case (notes, history, members)
 *   POST { action: 'assign', id, userId|null } | { action: 'status', id, status } | { action: 'note', id, visibility, body, mentions } | { action: 'close', id, outcome, citizenSummary } | { action: 'reopen', id }
 */
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = requireProStructureContext(req, res);
  if (!ctx) return undefined;
  const send = (out) => (out.ok === false ? res.status(out.status || 400).json({ error: out.code, message: out.message }) : res.status(out.status || 200).json((({ ok, status, ...b }) => b)(out)));
  if (req.method === 'GET') return send(req.query?.id ? await getCase(req.query.id, ctx) : await listQueue(ctx, { scope: String(req.query?.scope || 'mine') }));
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  switch (b.action) {
    case 'assign': return send(await assign(b.id, b.userId || null, ctx));
    case 'status': return send(await setStatus(b.id, String(b.status || ''), ctx));
    case 'note': return send(await addNote(b.id, b, ctx));
    case 'close': return send(await close(b.id, b, ctx));
    case 'reopen': return send(await reopen(b.id, ctx));
    default: return res.status(400).json({ error: 'INVALID_ACTION' });
  }
}

export default withProRdvHandler('pro.cases', handler);
