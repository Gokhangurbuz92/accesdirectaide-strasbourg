// @ts-check
/**
 * G14-R3 / R4 — GET /api/citizen/hds-ticket?cap=<capability>[&conversation=<id>] — a single-use, 60-second ES256 ticket for the HDS service (services/hds),
 * so the browser reaches Mon Coffre, its shared dossiers and its appointment attachments there directly. This handler reads the session, the age policy and
 * (attachments) the conversation's two party ids only: it never receives, reads or stores a document, a file name or a dossier content
 * (tests/unit/g14-hds-no-health-payload.test.js). Fail-closed:
 *   - unknown cap → 400; capability closed (api/_utils/capabilities.js, gateway included in Production) → 503 CAPABILITY_NOT_OPEN;
 *   - gateway not configured (HDS_SERVICE_URL, signing key) → 503 HDS_GATEWAY_NOT_CONFIGURED: the browser then keeps the LAB path;
 *   - a module not ported to the HDS service (HDS_MODULES) is refused when deployed;
 *   - messaging.attachments: the person must be the citizen of that conversation (else 404); the ticket is bound to it (obj claim).
 */
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { capabilityRefusal, capabilityState } from '../../_utils/capabilities.js';
import { hdsGatewayState, hdsModuleReady, isDeployed } from '../../_utils/hds-gateway.js';
import { parseTicketPrivateKey, signHdsTicket } from '../../lib/hds-ticket.js';

export const HDS_GATEWAY_NOT_CONFIGURED = 'HDS_GATEWAY_NOT_CONFIGURED';
/** the capabilities a citizen ticket may carry */
export const CITIZEN_TICKET_CAPS = Object.freeze(['citizen.vault', 'citizen.shared_dossier', 'messaging.attachments']);

/** the conversation of THIS citizen, or null @param {string} conversationId @param {string} citizenId */
async function citizenConversation(conversationId, citizenId) {
  const { db } = await import('../../../src/db/index.js');
  const { sql } = await import('drizzle-orm');
  const [c] = (await db.execute(sql`SELECT id, "structureId" FROM "RdvConversation" WHERE id = ${conversationId} AND "citizenUserId" = ${citizenId}`)).rows;
  return c ? { id: String(c.id), structureId: String(c.structureId) } : null;
}

/** @param {{ ageGate?: (id: string) => Promise<{ allowed: boolean }>, conversationOf?: (conversationId: string, citizenId: string) => Promise<{ id: string, structureId: string } | null>, env?: Record<string, string | undefined> }} [deps] */
export function createHdsTicketHandler(deps = {}) {
  return citizenHandler('hds-ticket', ['GET'], async (/** @type {any} */ citizen, /** @type {any} */ req) => {
    const env = deps.env || process.env;
    const cap = String(req.query?.cap || '');
    if (!CITIZEN_TICKET_CAPS.includes(cap)) return { ok: false, status: 400, code: 'INVALID_CAPABILITY', message: 'Capacité inconnue.' };
    const state = capabilityState(cap, env);
    if (!state.open) return { ok: false, status: 503, code: capabilityRefusal(cap).code, message: capabilityRefusal(cap).message };
    if (isDeployed(env) && !hdsModuleReady(cap)) return { ok: false, status: 503, code: 'HDS_MODULE_NOT_PORTED', message: 'Cette fonction n’est pas encore disponible chez l’hébergeur certifié.' };
    const gw = hdsGatewayState(env);
    const key = parseTicketPrivateKey(env.HDS_TICKET_PRIVATE_KEY);
    if (!gw.ready || !key) return { ok: false, status: 503, code: HDS_GATEWAY_NOT_CONFIGURED, message: 'Le service certifié n’est pas configuré sur cet environnement.' };
    /** @type {string[]} */ const caps = [cap];
    /** @type {string | undefined} */ let obj;
    if (cap === 'citizen.vault') {
      const ageGate = deps.ageGate || (await import('../../_services/citizen-account.js')).ageGate;
      if ((await ageGate(citizen.id)).allowed) caps.push('vault.write');
    }
    if (cap === 'messaging.attachments') {
      const conversationId = String(req.query?.conversation || '');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(conversationId)) return { ok: false, status: 400, code: 'INVALID_CONVERSATION', message: 'Conversation inconnue.' };
      const conv = await (deps.conversationOf || citizenConversation)(conversationId, String(citizen.id));
      if (!conv) return { ok: false, status: 404, code: 'not_found', message: 'Conversation introuvable.' };
      obj = `rdvconv:${conv.id}:${citizen.id}:${conv.structureId}`;
    }
    const t = signHdsTicket({ sub: citizen.id, typ: 'citizen', caps, ...(obj ? { obj } : {}) }, { privateKey: key, kid: String(env.HDS_TICKET_KID).trim() });
    return { ok: true, status: 200, ticket: t.ticket, expiresAt: t.expiresAt, origin: gw.origin };
  });
}

export default createHdsTicketHandler();
