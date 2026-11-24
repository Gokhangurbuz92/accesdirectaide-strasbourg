// @ts-check
/**
 * G14-R4 — GET /api/pro/hds-ticket?cap=<capability>[&conversation=<id>] — the PROFESSIONAL ticket for the HDS service (services/hds): single use, 60 s, ES256,
 * typ « pro », str = the caller's structure, role PRO | STRUCTURE_ADMIN. The browser of an ADA Pro member then opens the dossiers shared with its
 * organisation, its keys, a referral payload or an appointment attachment DIRECTLY at the HDS service. This handler reads the session and the membership
 * (and, for an attachment, the conversation's structure and citizen ids) only — never a dossier, a file or a note (tests/unit/g14-hds-no-health-payload.test.js).
 * Fail-closed exactly like the citizen ticket: unknown cap 400, closed capability 503, module not ported (deployed) 503, gateway absent 503
 * HDS_GATEWAY_NOT_CONFIGURED, an inactive member or an inactive organisation 403, a conversation of another organisation 404.
 */
import { capabilityRefusal, capabilityState, withCapability } from '../../_utils/capabilities.js';
import { hdsGatewayState, hdsModuleReady, isDeployed } from '../../_utils/hds-gateway.js';
import { parseTicketPrivateKey, signHdsTicket } from '../../lib/hds-ticket.js';

export const PRO_TICKET_CAPS = Object.freeze(['citizen.shared_dossier', 'pro.referrals', 'messaging.attachments']);

/** @param {{ structureId: string, userId: string }} ctx */
async function activeMembership(ctx) {
  const { db } = await import('../../../src/db/index.js');
  const { sql } = await import('drizzle-orm');
  const [r] = (await db.execute(sql`SELECT upper(u.role) AS role FROM "ProUser" u JOIN "Structure" s ON s.id = u."structureId"
    WHERE u.id = ${ctx.userId} AND u."structureId" = ${ctx.structureId} AND u.status = 'active' AND upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN') AND s.statut = 'actif'`)).rows;
  return r ? { role: String(r.role) } : null;
}
/** @param {string} conversationId @param {string} structureId */
async function structureConversation(conversationId, structureId) {
  const { db } = await import('../../../src/db/index.js');
  const { sql } = await import('drizzle-orm');
  const [c] = (await db.execute(sql`SELECT id, "citizenUserId" FROM "RdvConversation" WHERE id = ${conversationId} AND "structureId" = ${structureId}`)).rows;
  return c ? { id: String(c.id), citizenId: String(c.citizenUserId) } : null;
}

const send = (/** @type {any} */ res, /** @type {number} */ status, /** @type {any} */ body) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); return res.status(status).json(body); };

/**
 * @param {{ env?: Record<string, string | undefined>, membership?: typeof activeMembership, conversationOf?: typeof structureConversation }} [deps]
 */
export function createProHdsTicketHandler(deps = {}) {
  return async function proHdsTicket(/** @type {any} */ req, /** @type {any} */ res) {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const env = deps.env || process.env;
    const structureId = String(req?.user?.structureId || '').trim(); const userId = String(req?.user?.userId || '').trim();
    if (!structureId || !userId) return send(res, 403, { error: 'Forbidden' });
    // none of the capabilities a professional ticket can carry is open here: the same 503 as every closed ADA Pro module, whatever was asked
    if (!PRO_TICKET_CAPS.some((c) => capabilityState(c, env).open)) return send(res, 503, capabilityRefusal(PRO_TICKET_CAPS[0]));
    const cap = String(req.query?.cap || '');
    if (!PRO_TICKET_CAPS.includes(cap)) return send(res, 400, { error: 'INVALID_CAPABILITY', message: 'Capacité inconnue.' });
    if (!capabilityState(cap, env).open) return send(res, 503, capabilityRefusal(cap));
    if (isDeployed(env) && !hdsModuleReady(cap)) return send(res, 503, { error: 'HDS_MODULE_NOT_PORTED', message: 'Cette fonction n’est pas encore disponible chez l’hébergeur certifié.' });
    const gw = hdsGatewayState(env);
    const key = parseTicketPrivateKey(env.HDS_TICKET_PRIVATE_KEY);
    if (!gw.ready || !key) return send(res, 503, { error: 'HDS_GATEWAY_NOT_CONFIGURED', message: 'Le service certifié n’est pas configuré sur cet environnement.' });
    const m = await (deps.membership || activeMembership)({ structureId, userId });
    if (!m) return send(res, 403, { error: 'Forbidden' });
    /** @type {string[]} */ const caps = [cap];
    if (cap === 'pro.referrals') caps.push('citizen.shared_dossier');   // the sender reads the dossier key it re-wraps for the receiver
    /** @type {string | undefined} */ let obj;
    if (cap === 'messaging.attachments') {
      const conversationId = String(req.query?.conversation || '');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(conversationId)) return send(res, 400, { error: 'INVALID_CONVERSATION', message: 'Conversation inconnue.' });
      const conv = await (deps.conversationOf || structureConversation)(conversationId, structureId);
      if (!conv) return send(res, 404, { error: 'not_found', message: 'Conversation introuvable.' });
      obj = `rdvconv:${conv.id}:${conv.citizenId}:${structureId}`;
    }
    const t = signHdsTicket({ sub: userId, typ: 'pro', caps, str: structureId, role: m.role === 'STRUCTURE_ADMIN' ? 'STRUCTURE_ADMIN' : 'PRO', ...(obj ? { obj } : {}) },
      { privateKey: key, kid: String(env.HDS_TICKET_KID).trim() });
    return send(res, 200, { ticket: t.ticket, expiresAt: t.expiresAt, origin: gw.origin, role: m.role === 'STRUCTURE_ADMIN' ? 'STRUCTURE_ADMIN' : 'PRO' });
  };
}

const inner = createProHdsTicketHandler();
/** the professional session (cookie) is resolved by the same wrapper as every ADA Pro route; the capability checked in the handler is the one asked for */
async function handler(/** @type {any} */ req, /** @type {any} */ res) {
  const { withProRdvHandler } = await import('../../_utils/with-pro-rdv-handler.js');
  return withProRdvHandler('pro.hds-ticket', inner)(req, res);
}
export default withCapability([], handler);
