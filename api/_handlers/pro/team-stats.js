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
  // A20: the per-member lines (appointments created, open cases of each colleague) are a management figure — the structure's administrator only. Any other
  // member gets their own line; the global block stays for everyone. The role is the one re-read from the database for this request (requireProAuth).
  if (out.ok) {
    const team = ['STRUCTURE_ADMIN', 'SUPERADMIN'].includes(String(ctx.role || '').toUpperCase());
    if (!team) out.members = (out.members || []).filter((m) => m.id === ctx.userId);
    out.membersScope = team ? 'team' : 'self';
  }
  return out.ok ? res.status(200).json((({ ok, ...b }) => b)(out)) : res.status(out.status).json({ error: out.code, message: out.message });
}
export default withProRdvHandler('pro.team.stats', handler);
