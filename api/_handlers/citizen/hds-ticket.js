// @ts-check
/**
 * G14-R3 — GET /api/citizen/hds-ticket?cap=citizen.vault — a single-use, 60-second ES256 ticket for the HDS service (services/hds), so the browser
 * reaches Mon Coffre there directly. This handler reads the session and the age policy only: it never receives, reads or stores a document, a file
 * name or a dossier content (tests/unit/g14-hds-no-health-payload.test.js). Fail-closed:
 *   - unknown cap → 400; capability closed (api/_utils/capabilities.js, gateway included in Production) → 503 CAPABILITY_NOT_OPEN;
 *   - gateway not configured (HDS_SERVICE_URL, signing key) → 503 HDS_GATEWAY_NOT_CONFIGURED: the browser then keeps the LAB path;
 *   - citizen.shared_dossier tickets are refused while its module is not ported (HDS_MODULES), except in the LAB.
 */
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { capabilityRefusal, capabilityState } from '../../_utils/capabilities.js';
import { HDS_SERVICE_CAPABILITIES, hdsGatewayState, hdsModuleReady, isDeployed } from '../../_utils/hds-gateway.js';
import { parseTicketPrivateKey, signHdsTicket } from '../../lib/hds-ticket.js';

export const HDS_GATEWAY_NOT_CONFIGURED = 'HDS_GATEWAY_NOT_CONFIGURED';

/** @param {{ ageGate?: (id: string) => Promise<{ allowed: boolean }>, env?: Record<string, string | undefined> }} [deps] */
export function createHdsTicketHandler(deps = {}) {
  return citizenHandler('hds-ticket', ['GET'], async (/** @type {any} */ citizen, /** @type {any} */ req) => {
    const env = deps.env || process.env;
    const cap = String(req.query?.cap || '');
    if (!HDS_SERVICE_CAPABILITIES.includes(cap)) return { ok: false, status: 400, code: 'INVALID_CAPABILITY', message: 'Capacité inconnue.' };
    const state = capabilityState(cap, env);
    if (!state.open) return { ok: false, status: 503, code: capabilityRefusal(cap).code, message: capabilityRefusal(cap).message };
    if (isDeployed(env) && !hdsModuleReady(cap)) return { ok: false, status: 503, code: 'HDS_MODULE_NOT_PORTED', message: 'Cette fonction n’est pas encore disponible chez l’hébergeur certifié.' };
    const gw = hdsGatewayState(env);
    const key = parseTicketPrivateKey(env.HDS_TICKET_PRIVATE_KEY);
    if (!gw.ready || !key) return { ok: false, status: 503, code: HDS_GATEWAY_NOT_CONFIGURED, message: 'Le service certifié n’est pas configuré sur cet environnement.' };
    const caps = [cap];
    if (cap === 'citizen.vault') {
      const ageGate = deps.ageGate || (await import('../../_services/citizen-account.js')).ageGate;
      if ((await ageGate(citizen.id)).allowed) caps.push('vault.write');
    }
    const t = signHdsTicket({ sub: citizen.id, typ: 'citizen', caps }, { privateKey: key, kid: String(env.HDS_TICKET_KID).trim() });
    return { ok: true, status: 200, ticket: t.ticket, expiresAt: t.expiresAt, origin: gw.origin };
  });
}

export default createHdsTicketHandler();
