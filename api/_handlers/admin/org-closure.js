// @ts-nocheck
import logger from '../../_utils/logger.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { confirmClosure, listOpenClosures, proposeClosure, readClosure, requestClosure, retryBlockedClosure } from '../../_services/org-closure.js';

/**
 * PKG-11 / E08 — two-person review of organization closures (api/_services/org-closure.js), behind the K5 administrator gate.
 *   GET  /api/admin/org-closure              open requests (any administrator session; counts and names only)
 *   GET  /api/admin/org-closure?id=          what the closure would touch (counts, legal holds) — named session WITH MFA; the reading is audited
 *   POST { action: 'open', structureId, reason }                          ADA opens a closure itself (e.g. end of the agreement) (MFA)
 *   POST { id, decision: APPROVE|REJECT, reason }                         first reviewer PROPOSES (MFA)
 *   POST { id, action: confirm|send_back, note, proposedAt }              a SECOND, different MFA reviewer; confirm + APPROVE runs the closure
 *   POST { id, action: retry }                                            a closure BLOCKED by a legal hold, after the hold is released (MFA)
 */
export default async function handler(req, res) {
  const rate = await checkRateLimit('ADMIN_API', getClientIp(req));
  if (!rate.allowed) return res.status(getRateLimitStatus(rate)).json(rate.error);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.query?.id || '');
  const auth = await adminGate(req, res, { write: req.method !== 'GET' || Boolean(id) }); if (!auth) return;
  try {
    if (req.method === 'GET' && !id) return res.status(200).json(await listOpenClosures());
    const reviewer = String(auth.email); const b = req.body && typeof req.body === 'object' ? req.body : {};
    const out = req.method === 'GET' ? await readClosure(id, reviewer)
      : b.action === 'open' ? await requestClosure(String(b.structureId || ''), b, { admin: reviewer })
        : b.action === 'retry' ? await retryBlockedClosure(String(b.id || ''), reviewer)
          : b.action ? await confirmClosure(String(b.id || ''), b, reviewer)
            : await proposeClosure(String(b.id || ''), b, reviewer);
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    const { ok: _ok, status, ...body } = out;
    return res.status(status || 200).json(body);
  } catch (error) {
    logger.error({ err: { name: error?.name, code: error?.code || error?.cause?.code } }, '[OrgClosure] failed');
    return res.status(500).json({ error: 'ORG_CLOSURE_FAILED', message: 'La fermeture n’a pas pu être traitée.' });
  }
}
