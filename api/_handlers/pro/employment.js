// @ts-nocheck
/**
 * X05 (expansion) — an employer's job listings (api/_services/job-board.js). The professional session (requireProAuth: account state, session age, the MFA
 * rule of the console), CSRF on writes (api/index.js), the per-member rate limit, the capability « community.employment » (closed by default) and the
 * « employment » surface (opened by no deployment; « pro » does not open it). Only a STRUCTURE_ADMIN manages listings; only an organization that ADA verified
 * (E01) can send one to moderation. Every query is scoped to the session's organization: another organization's listing answers 404.
 *   GET  /api/pro/employment                                         → { available, canManage, employerVerified, employer, limits, listings }
 *   POST /api/pro/employment { action: 'create', ...listing }          a draft (required fields only; a discriminatory criterion field → 400 FORBIDDEN_CRITERION)
 *   POST /api/pro/employment { action: 'update', id, ...listing }      a draft or a rejected listing (back to draft)
 *   POST /api/pro/employment { action: 'submit' | 'withdraw' | 'delete', id }
 */
import { logProAudit, requireProStructureContext } from '../../_utils/auth.js';
import { clientIp } from '../../_utils/client-ip.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { employerListings } from '../../_services/job-board.js';

const ID = /^[0-9a-f-]{36}$/i;

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = requireProStructureContext(req, res);
  if (!ctx) return undefined;
  const ip = clientIp(req);
  const svc = employerListings({ audit: (action, c, details) => logProAudit(action, c.userId, c.structureId, details, ip) });
  const send = (out) => (out.ok === false
    ? res.status(out.status || 400).json({ error: out.code, message: out.message, ...(out.problems ? { problems: out.problems } : {}), ...(out.fields ? { fields: out.fields } : {}), ...(out.legalBasis ? { legalBasis: out.legalBasis } : {}) })
    : res.status(out.status || 200).json((({ ok, status, ...b }) => b)(out)));
  if (req.method === 'GET') return send(await svc.mine(ctx));
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (b.action === 'create') return send(await svc.create(ctx, b));
  const id = typeof b.id === 'string' && ID.test(b.id) ? b.id : null;
  if (!id) return res.status(400).json({ error: 'ID_REQUIRED' });
  if (b.action === 'update') return send(await svc.update(ctx, id, b));
  if (b.action === 'submit') return send(await svc.submit(ctx, id));
  if (b.action === 'withdraw') return send(await svc.withdraw(ctx, id));
  if (b.action === 'delete') return send(await svc.remove(ctx, id));
  return res.status(400).json({ error: 'UNKNOWN_ACTION' });
}

export default withProRdvHandler('pro.employment', handler);
