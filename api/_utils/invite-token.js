// @ts-nocheck
/**
 * PKG-4 / D8 — a team invitation token is a bearer secret: the database keeps only its SHA-256 ("sha256:<hex>"), the clear token exists only in the invitation link.
 * Rows written before PKG-4 hold the clear token; they are still found until they expire (7 days), but a stored hash can never be replayed as a token
 * (a clear-token match is accepted only for rows that are NOT hashed).
 */
import crypto from 'node:crypto';
import { and, eq, not, like, or, sql } from 'drizzle-orm';

const PREFIX = 'sha256:';
export const newInviteToken = () => crypto.randomBytes(32).toString('hex');
export const hashInviteToken = (token) => PREFIX + crypto.createHash('sha256').update(String(token)).digest('hex');
/** drizzle predicate on the Invitation table for a token received from the invitee. */
export function inviteTokenWhere(column, token) {
  const t = String(token || '');
  return or(eq(column, hashInviteToken(t)), and(eq(column, t), not(like(column, PREFIX + '%'))));
}
export const publicInvitation = ({ token, ...rest }) => rest;

/**
 * R20 — an invitation is the act of the administrator who sent it (or resent it last: the journal row INVITATION_SENT / INVITATION_RESENT carries its id). When
 * that person has left, been suspended, moved or is no longer an administrator of the organization, their pending invitations stop being redeemable — the other
 * administrators' invitations are untouched, and a current administrator's « Relancer » makes the invitation theirs again. An invitation with no recorded sender
 * (written before R20) keeps working until it expires (7 days), like the clear-token rows above.
 * @param {any} dbh drizzle database @param {string[]} ids invitation ids @returns {Promise<Set<string>>} the ids whose sender is no longer authorized
 */
export async function invitationsWithRevokedSender(dbh, ids) {
  const list = [...new Set((ids || []).map(String))];
  if (!list.length) return new Set();
  const rows = (await dbh.execute(sql`
    SELECT DISTINCT ON (a.details->>'invitationId') a.details->>'invitationId' AS "invitationId", i."structureId" AS "invitationStructure",
           u.id AS "senderId", u.status, u.role, u."structureId" AS "senderStructure"
      FROM "AuditLog" a
      JOIN "Invitation" i ON i.id = a.details->>'invitationId'
      LEFT JOIN "ProUser" u ON u.id = a.actor_id
     WHERE a.action IN ('INVITATION_SENT', 'INVITATION_RESENT') AND a.details->>'invitationId' IN (${sql.join(list.map((x) => sql`${x}`), sql`, `)})
     ORDER BY a.details->>'invitationId', a.timestamp DESC`)).rows;
  const out = new Set();
  for (const r of rows) {
    const authorized = r.senderId && ['active', 'pending'].includes(String(r.status)) && r.senderStructure === r.invitationStructure
      && ['STRUCTURE_ADMIN', 'SUPERADMIN'].includes(String(r.role || '').toUpperCase());
    if (!authorized) out.add(String(r.invitationId));
  }
  return out;
}
