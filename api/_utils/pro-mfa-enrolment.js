/**
 * R42-A08 (resolves R41 F3) — a professional's second factor is enrolled ONLY through a verified institutional invitation.
 *
 * Before R42 any password-only session of an account without MFA could enrol an authenticator (trust on first use): whoever held a stolen password became the
 * owner of the second factor. Now the enrolment needs an ENROLMENT GRANT, obtained only by redeeming an invitation (the existing `Invitation` table — no new
 * table, no new column; works on a database at migration 0042):
 *   - created only by an authorised administrator (STRUCTURE_ADMIN of the structure, or the platform role SUPERADMIN), never by the member for themself;
 *   - scoped to one structure + one identity (e-mail) + one role; the token is a bearer secret stored as its SHA-256 only (invite-token.js);
 *   - single use (claimed atomically), expiring (team invitation: 7 days; enrolment invitation for an existing account: 72 h);
 *   - redeemable only by the account it names: same structure, same e-mail, same role; any other account is refused;
 *   - a new member redeems it when creating the account (register-invite); an existing member redeems it while signed in (pro/mfa-enrolment), i.e. with
 *     the password AND the mailbox the invitation was sent to.
 * The grant itself is a short-lived signed token (30 min, its own audience — never a session) naming the account, the structure and the invitation; it is
 * checked against the database on every use (the invitation row must be the redeemed one of the same identity, and it dies with any session revocation:
 * password reset, factor reset, enrolment). Passwords, tokens and seeds are never written to the audit log.
 */
import { sql } from 'drizzle-orm';
import { signProMfaEnrolmentToken, verifyProMfaEnrolmentToken } from './auth.js';
import { hashInviteToken, invitationsWithRevokedSender } from './invite-token.js';

const SCOPE = 'mfa_enrol';
export const MFA_ENROLMENT_GRANT_SECONDS = 30 * 60;
export const MFA_INVITATION_TTL_MS = 72 * 3600 * 1000;
export const MFA_ENROLMENT_HEADER = 'x-ada-mfa-enrolment';
/** the roles an account may hold for an enrolment invitation to match it (an invitation never GRANTS a role here: it must equal the account's) */
export const ENROLMENT_ROLES = Object.freeze(['PRO', 'STRUCTURE_ADMIN', 'SUPERADMIN']);

/**
 * @param {{ userId: string, structureId: string, invitationId: string }} claims
 * @returns {string}
 */
export function signMfaEnrolmentGrant(claims) {
  return signProMfaEnrolmentToken(claims, MFA_ENROLMENT_GRANT_SECONDS);
}

/**
 * @param {unknown} token
 * @returns {{ userId: string, structureId: string, invitationId: string, iat: number } | null}
 */
export function verifyMfaEnrolmentGrant(token) {
  if (typeof token !== 'string' || !token || token.length > 2048) return null;
  const p = verifyProMfaEnrolmentToken(token);
  if (!p) return null;
  if (p.scope !== SCOPE || typeof p.userId !== 'string' || typeof p.structureId !== 'string' || typeof p.inv !== 'string' || typeof p.iat !== 'number') return null;
  return { userId: p.userId, structureId: p.structureId, invitationId: p.inv, iat: p.iat };
}

/**
 * The grant sent by the enrolment screen: header (GET and POST) or body field `enrolmentToken` (POST).
 * @param {{ headers?: Record<string, unknown>, body?: unknown }} req
 * @returns {string}
 */
export function enrolmentGrantFrom(req) {
  const h = req.headers?.[MFA_ENROLMENT_HEADER];
  if (typeof h === 'string' && h) return h;
  const body = req.body && typeof req.body === 'object' ? /** @type {Record<string, unknown>} */ (req.body) : {};
  return typeof body.enrolmentToken === 'string' ? body.enrolmentToken : '';
}

/** @param {unknown} v */
const lower = (v) => String(v ?? '').trim().toLowerCase();
/** @param {unknown} v */
const upper = (v) => String(v ?? '').trim().toUpperCase();

/**
 * @typedef {{ id: string, email: string, role: string, structureId: string, sessionsValidAfter?: Date | string | null, mfa_enabled?: boolean }} ProAccount
 * @typedef {{ execute(q: import('drizzle-orm').SQL): Promise<{ rows: Record<string, unknown>[] }> }} SqlDb
 */

/**
 * May this account enrol its second factor now? Only with a valid grant bound to it and to the invitation it redeemed.
 * @param {SqlDb} dbh @param {ProAccount} account @param {unknown} token
 * @returns {Promise<{ ok: true, invitationId: string } | { ok: false, reason: 'NO_GRANT' | 'INVALID_GRANT' | 'OTHER_ACCOUNT' | 'GRANT_REVOKED' | 'INVITATION_MISMATCH' }>}
 */
export async function checkMfaEnrolmentGrant(dbh, account, token) {
  if (!token) return { ok: false, reason: 'NO_GRANT' };
  const g = verifyMfaEnrolmentGrant(token);
  if (!g) return { ok: false, reason: 'INVALID_GRANT' };
  if (g.userId !== String(account.id) || g.structureId !== String(account.structureId)) return { ok: false, reason: 'OTHER_ACCOUNT' };
  const after = account.sessionsValidAfter ? new Date(account.sessionsValidAfter).getTime() : NaN;
  if (Number.isFinite(after) && g.iat < Math.floor(after / 1000)) return { ok: false, reason: 'GRANT_REVOKED' };
  const rows = (await dbh.execute(sql`SELECT id FROM "Invitation" WHERE id = ${g.invitationId} AND "structureId" = ${String(account.structureId)}
      AND lower(email) = ${lower(account.email)} AND upper(role) = ${upper(account.role)} AND used_at IS NOT NULL LIMIT 1`)).rows;
  if (!rows.length) return { ok: false, reason: 'INVITATION_MISMATCH' };
  return { ok: true, invitationId: g.invitationId };
}

/**
 * Redeems an enrolment invitation for a signed-in EXISTING account. Every refusal is the same to the caller (the reason is for the audit log only).
 * @param {SqlDb} dbh @param {ProAccount} account @param {unknown} rawToken
 * @returns {Promise<{ ok: true, invitationId: string } | { ok: false, reason: string, invitationId?: string }>}
 */
export async function redeemMfaInvitation(dbh, account, rawToken) {
  const raw = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!raw || raw.length > 256) return { ok: false, reason: 'NOT_FOUND' };
  // only hashed rows: a stored hash can never be replayed as a token, and the clear-token rows written before PKG-4 are not enrolment invitations
  const rows = (await dbh.execute(sql`SELECT id, "structureId", email, role, expires_at, used_at FROM "Invitation" WHERE token = ${hashInviteToken(raw)} LIMIT 1`)).rows;
  const inv = rows[0];
  if (!inv) return { ok: false, reason: 'NOT_FOUND' };
  const invitationId = String(inv.id);
  if (inv.used_at) return { ok: false, reason: 'USED', invitationId };
  if (new Date(String(inv.expires_at)).getTime() <= Date.now()) return { ok: false, reason: 'EXPIRED', invitationId };
  if (String(inv.structureId) !== String(account.structureId)) return { ok: false, reason: 'OTHER_STRUCTURE', invitationId };
  if (lower(inv.email) !== lower(account.email)) return { ok: false, reason: 'OTHER_IDENTITY', invitationId };
  if (upper(inv.role) !== upper(account.role)) return { ok: false, reason: 'OTHER_ROLE', invitationId };
  if ((await invitationsWithRevokedSender(dbh, [invitationId])).has(invitationId)) return { ok: false, reason: 'SENDER_REVOKED', invitationId };
  const claimed = (await dbh.execute(sql`UPDATE "Invitation" SET used_at = NOW() WHERE id = ${invitationId} AND used_at IS NULL AND expires_at > NOW() RETURNING id`)).rows;
  if (!claimed.length) return { ok: false, reason: 'USED', invitationId };
  return { ok: true, invitationId };
}
