// @ts-nocheck
import logger from '../../_utils/logger.js';
import { adminGate } from '../../_utils/admin-gate.js';
import { overview, placeHold, proposeRelease, confirmRelease, proposeRecovery, decideRecovery } from '../../_services/privacy-console.js';

/**
 * PKG-5 / A12 — privacy console. GET: overview (MFA session). POST { action }:
 *   hold_place { dataCategory, recordId, reasonCode } | hold_propose_release { id, reason } | hold_confirm_release { id }   (two people)
 *   recovery_propose { currentEmail, newEmail, evidenceNote } | recovery_decide { id, decision: APPROVE|REJECT, note }        (two people)
 * Access-request reviews keep their own two-person flow: /api/admin/dsr-review.
 */
export default async function handler(req, res) {
  const auth = await adminGate(req, res, { write: true }); if (!auth) return;
  try {
    if (req.method === 'GET') return res.status(200).json(await overview());
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const act = {
      hold_place: () => placeHold(b, auth.email),
      hold_propose_release: () => proposeRelease(b.id, b.reason, auth.email),
      hold_confirm_release: () => confirmRelease(b.id, auth.email, undefined, b.proposedAt),
      recovery_propose: () => proposeRecovery(b, auth.email),
      recovery_decide: () => decideRecovery(b.id, b, auth.email),
    }[String(b.action || '')];
    if (!act) return res.status(400).json({ error: 'unknown_action' });
    const out = await act();
    return out.ok ? res.status(200).json(out) : res.status(out.status).json({ error: out.code, message: out.message });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Privacy] failed');
    return res.status(500).json({ error: 'PRIVACY_FAILED' });
  }
}
