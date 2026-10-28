// @ts-nocheck
import { requireProStructureContext } from '../../_utils/auth.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { exportOrganization, getProfile, propose, requestOrganizationClosure, withdraw } from '../../_services/structure-proposals.js';

/**
 * PKG-4 / E02 E05 E08 — Espace Structure profile (api/_services/structure-proposals.js holds every rule).
 *   GET                -> current public record + proposals         GET ?export=1 -> the organization's own data (administrators)
 *   POST { action: 'propose', field, value } | { action: 'withdraw', id }   -> proposals go to the ADA review queue; nothing is published directly (D-5)
 *   POST { action: 'request_closure', reason }   -> PKG-11 / E08: ask ADA to close the space and erase the organization's data (administrators; two ADA reviewers decide)
 */
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = requireProStructureContext(req, res);
  if (!ctx) return undefined;
  const send = (out) => (out.ok === false ? res.status(out.status || 400).json({ error: out.code, message: out.message }) : res.status(out.status || 200).json((({ ok, status, ...b }) => b)(out)));
  if (req.method === 'GET') {
    if (String(req.query?.export || '') === '1') {
      const out = await exportOrganization(ctx);
      if (out.ok) res.setHeader('Content-Disposition', 'attachment; filename="export-structure.json"');
      return send(out);
    }
    return send(await getProfile(ctx));
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (b.action === 'propose') return send(await propose(b, ctx));
  if (b.action === 'withdraw') return send(await withdraw(b.id, ctx));
  if (b.action === 'request_closure') return send(await requestOrganizationClosure(b, ctx));
  return res.status(400).json({ error: 'INVALID_ACTION' });
}

export default withProRdvHandler('pro.structure', handler);
