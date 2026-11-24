// @ts-check
/**
 * G14-R4 — server-to-server facts the main API needs from the HDS service, IDENTIFIERS ONLY (a referral's workflow stays here; its payload lives there):
 *   dossierRef({ dossierId, structureId, toStructureId? }) → { exists, active, ownerId, toStatus }   (does that organisation hold an active grant; whose dossier)
 *   eraseBinding(binding) → { attachments }                                                          (the attachments of one erased conversation)
 * Each call signs a « system » ticket (60 s, single use) with a dedicated capability; nothing but ids travels and nothing but ids and counts comes back.
 */
import { hdsGatewayState } from '../_utils/hds-gateway.js';
import { parseTicketPrivateKey, signHdsTicket } from './hds-ticket.js';

export class HdsInternalError extends Error {
  /** @param {string} reason */
  constructor(reason) { super(`HDS_INTERNAL: ${reason}`); this.name = 'HdsInternalError'; this.code = 'HDS_UNAVAILABLE'; this.reason = reason; }
}

/**
 * @param {string} path @param {string} cap @param {Record<string, unknown>} body
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, timeoutMs?: number }} [o]
 */
async function systemCall(path, cap, body, o = {}) {
  const env = o.env || process.env;
  const gw = hdsGatewayState(env);
  const key = parseTicketPrivateKey(env.HDS_TICKET_PRIVATE_KEY);
  if (!gw.ready || !key || !gw.origin) throw new HdsInternalError(gw.reason || 'HDS_TICKET_KEY_INVALID');
  const { ticket } = signHdsTicket({ sub: 'ada-main', typ: 'system', caps: [cap] }, { privateKey: key, kid: String(env.HDS_TICKET_KID).trim() });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 10000);
  try {
    const res = await (o.fetchImpl || fetch)(`${gw.origin}${path}`, { method: 'POST', redirect: 'error', signal: ctl.signal,
      headers: { Authorization: `Bearer ${ticket}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status !== 200) throw new HdsInternalError(`HTTP_${res.status}`);
    return /** @type {any} */ (await res.json());
  } catch (e) {
    if (e instanceof HdsInternalError) throw e;
    throw new HdsInternalError('UNREACHABLE');
  } finally { clearTimeout(timer); }
}

/**
 * @param {{ dossierId: string, structureId: string, toStructureId?: string }} q @param {Parameters<typeof systemCall>[3]} [o]
 * @returns {Promise<{ exists: boolean, active: boolean, ownerId: string | null, toStatus: string | null }>}
 */
export async function dossierRef(q, o) {
  const b = await systemCall('/v1/internal/dossier-ref', 'hds.dossier-ref', { dossierId: q.dossierId, structureId: q.structureId, ...(q.toStructureId ? { toStructureId: q.toStructureId } : {}) }, o);
  return { exists: b.exists === true, active: b.active === true, ownerId: typeof b.ownerId === 'string' ? b.ownerId : null, toStatus: typeof b.toStatus === 'string' ? b.toStatus : null };
}

/** @param {string} binding @param {Parameters<typeof systemCall>[3]} [o] */
export async function eraseBinding(binding, o) {
  const b = await systemCall('/v1/internal/erase-binding', 'hds.erase', { binding }, o);
  return { attachments: Number(b.attachments) || 0 };
}
