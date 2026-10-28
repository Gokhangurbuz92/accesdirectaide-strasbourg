// @ts-nocheck
import { requireProStructureContext } from '../../_utils/auth.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { teamStats } from '../../_services/org-stats.js';

/** PKG-4 / E07 — GET /api/pro/team/stats: measured figures of the caller's OWN organization (api/_services/org-stats.js). */
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = requireProStructureContext(req, res);
  if (!ctx) return undefined;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const out = await teamStats(ctx);
  return out.ok ? res.status(200).json((({ ok, ...b }) => b)(out)) : res.status(out.status).json({ error: out.code, message: out.message });
}
export default withProRdvHandler('pro.team.stats', handler);
