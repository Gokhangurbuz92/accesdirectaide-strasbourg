// @ts-check
/**
 * G14-R3 — account erasure (art. 17) reaches the HDS service: the main API signs a « system » ticket (cap hds.erase, sub = the account id) and calls
 * POST <HDS origin>/v1/internal/erase-subject. Nothing but the identifier travels; the answer is counts only. Called by
 * api/_services/privacy.js executeApprovedDeletion BEFORE the main erasure: a failure leaves the request approved and nothing erased (retried later),
 * so no HDS document outlives its account. No HDS_SERVICE_URL at all = nothing was ever stored there = skipped.
 */
import { hdsGatewayState } from '../_utils/hds-gateway.js';
import { parseTicketPrivateKey, signHdsTicket } from './hds-ticket.js';

export class HdsErasureError extends Error {
  /** @param {string} reason */
  constructor(reason) { super(`HDS_ERASURE_PENDING: ${reason}`); this.name = 'HdsErasureError'; this.code = 'HDS_ERASURE_PENDING'; this.reason = reason; }
}

/**
 * @param {string} subjectId
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, timeoutMs?: number }} [o]
 * @returns {Promise<{ skipped: true } | { skipped: false, vaultDocuments: number, dossiers: number, blobs: number }>}
 */
export async function eraseHdsSubject(subjectId, o = {}) {
  const env = o.env || process.env;
  if (!String(env.HDS_SERVICE_URL || '').trim()) return { skipped: true };
  const gw = hdsGatewayState(env);
  const key = parseTicketPrivateKey(env.HDS_TICKET_PRIVATE_KEY);
  if (!gw.ready || !key || !gw.origin) throw new HdsErasureError(gw.reason || 'HDS_TICKET_KEY_INVALID');
  const { ticket } = signHdsTicket({ sub: String(subjectId), typ: 'system', caps: ['hds.erase'] }, { privateKey: key, kid: String(env.HDS_TICKET_KID).trim() });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 15000);
  try {
    const res = await (o.fetchImpl || fetch)(`${gw.origin}/v1/internal/erase-subject`, { method: 'POST', redirect: 'error', signal: ctl.signal,
      headers: { Authorization: `Bearer ${ticket}`, 'Content-Type': 'application/json' }, body: '{}' });
    if (res.status !== 200) throw new HdsErasureError(`HTTP_${res.status}`);
    const b = /** @type {any} */ (await res.json().catch(() => ({})));
    return { skipped: false, vaultDocuments: Number(b.vaultDocuments) || 0, dossiers: Number(b.dossiers) || 0, blobs: Number(b.blobs) || 0 };
  } catch (e) {
    if (e instanceof HdsErasureError) throw e;
    throw new HdsErasureError('UNREACHABLE');
  } finally { clearTimeout(timer); }
}
