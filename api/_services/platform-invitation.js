/**
 * Release A / G-1 (activation plan 07/11/2026) — the platform invitation of a partner structure's FIRST administrator.
 *
 * In Production public structure sign-up is closed (R43 E1, ADA_PRO_SELF_REGISTRATION) and `POST /api/pro/invite` invites into the inviter's own structure.
 * The bootstrapped SUPERADMIN (scripts/pro-superadmin-bootstrap.mjs) belongs to the internal platform structure, so nobody could create the first
 * STRUCTURE_ADMIN of a pilot structure. This rule lets ONE role do exactly that, and nothing more:
 *   - the actor is a SUPERADMIN whose session passed the second factor (whatever PRO_MFA_REQUIRED says), and whose account is, in the database, still
 *     SUPERADMIN, active and enrolled (a token alone is not enough);
 *   - the invitation role is STRUCTURE_ADMIN only (the structure's administrator then invites its own members through the ordinary path);
 *   - the target structure (id or slug, exact match) is active AND identity-verified by an ADA administrator (api/_utils/org-eligibility.js): a draft, suspended
 *     or unverified structure — the internal platform structure included — is refused;
 *   - the decision describes the structure, never a person; unknown and refused targets do not reveal anything else.
 * The redemption already accepts a SUPERADMIN sender for any structure (api/_utils/invite-token.js invitationsWithRevokedSender, R42-A08), and stops the
 * invitation if that SUPERADMIN later leaves or loses the role.
 */
import { sql } from 'drizzle-orm';
import { isVerifiedActive } from '../_utils/org-eligibility.js';

export const PLATFORM_INVITATION_CODES = Object.freeze({
  FORBIDDEN: 'PLATFORM_INVITATION_FORBIDDEN',
  MFA_REQUIRED: 'PLATFORM_INVITATION_MFA_REQUIRED',
  ROLE: 'PLATFORM_INVITATION_ROLE',
  NOT_FOUND: 'PLATFORM_INVITATION_STRUCTURE_NOT_FOUND',
  NOT_ELIGIBLE: 'PLATFORM_INVITATION_STRUCTURE_NOT_ELIGIBLE',
});
const C = PLATFORM_INVITATION_CODES;
/** @param {number} status @param {string} code @param {string} message @returns {{ ok: false, status: number, body: { error: string, code: string } }} */
const refuse = (status, code, message) => ({ ok: false, status, body: { error: message, code } });

/** the requested target, or '' when the request is an ordinary own-structure invitation @param {unknown} body */
export function platformTargetOf(body) {
  if (!body || typeof body !== 'object') return '';
  const v = /** @type {Record<string, unknown>} */ (body).structure;
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * @param {{ dbh: any, actor: { userId?: string, role?: string, mfa?: boolean }, target: string, role: string }} input
 * @returns {Promise<{ ok: true, structure: { id: string, nom: string } } | { ok: false, status: number, body: { error: string, code: string } }>}
 */
export async function authorizePlatformInvitation({ dbh, actor, target, role }) {
  if (String(actor?.role || '').toUpperCase() !== 'SUPERADMIN') {
    return refuse(403, C.FORBIDDEN, 'Seule l’équipe de la plateforme peut inviter l’administrateur d’une autre structure.');
  }
  if (actor.mfa !== true) {
    return refuse(403, C.MFA_REQUIRED, 'Validez d’abord la double authentification de votre session pour inviter l’administrateur d’une structure.');
  }
  const me = (await dbh.execute(sql`SELECT role, status, mfa_enabled FROM "ProUser" WHERE id = ${String(actor.userId || '')} LIMIT 1`)).rows[0];
  if (!me || String(me.role).toUpperCase() !== 'SUPERADMIN' || me.status !== 'active' || me.mfa_enabled !== true) {
    return refuse(403, C.FORBIDDEN, 'Seule l’équipe de la plateforme peut inviter l’administrateur d’une autre structure.');
  }
  if (role !== 'STRUCTURE_ADMIN') {
    return refuse(400, C.ROLE, 'Une invitation de la plateforme ne peut nommer que l’administrateur de la structure (rôle STRUCTURE_ADMIN).');
  }
  if (!target || target.length > 200) return refuse(404, C.NOT_FOUND, 'Structure introuvable.');
  const s = (await dbh.execute(sql`SELECT id, nom, statut, verification_status FROM "Structure" WHERE id = ${target} OR slug = ${target} ORDER BY (id = ${target}) DESC LIMIT 1`)).rows[0];
  if (!s) return refuse(404, C.NOT_FOUND, 'Structure introuvable.');
  if (!isVerifiedActive(s)) {
    return refuse(409, C.NOT_ELIGIBLE, 'Cette structure n’est pas encore active et vérifiée par l’équipe d’Accès Direct Aide : vérifiez et activez-la dans l’administration avant d’inviter son administrateur.');
  }
  return { ok: true, structure: { id: String(s.id), nom: String(s.nom) } };
}
