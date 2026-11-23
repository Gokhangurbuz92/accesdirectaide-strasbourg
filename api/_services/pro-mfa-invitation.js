// @ts-nocheck
/**
 * R42-A08 / G14 — the MFA enrolment invitation of an EXISTING professional account, shared by its two senders:
 *   - POST /api/pro/mfa-invitation (api/_handlers/pro/mfa-invitation.js): a structure administrator (own structure) or the platform's SUPERADMIN;
 *   - « Vérifier et activer » in /admin/organizations (api/_services/pro-self-registration.js): an ADA administrator (admin realm, MFA) after verifying a
 *     self-registered structure on an official source.
 * The invitation is bound to the member's structure, e-mail and current role; its token is stored hashed, used once, valid 72 h; earlier pending invitations
 * of the same address in that structure are withdrawn. The clear token exists only in the link (fragment), never in a row or a journal.
 *
 * G14 (owner 23/11/2026, ADA Pro opened without a pilot structure): a member of ANOTHER structure than the sender's is invited only when that structure is
 * active AND identity-verified (api/_utils/org-eligibility.js) — a structure that signed up on its own is let in only after ADA verified it.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Invitation, ProUser } from '../../src/db/schema.js';
import { hashInviteToken, newInviteToken } from '../_utils/invite-token.js';
import { mailLedgerStatus, sendMail } from '../_utils/mailer.js';
import { buildAppUrl } from '../_utils/user-auth.js';
import { MFA_INVITATION_TTL_MS } from '../_utils/pro-mfa-enrolment.js';
import { isVerifiedActive } from '../_utils/org-eligibility.js';

export const STRUCTURE_NOT_VERIFIED = Object.freeze({
  error: 'STRUCTURE_NOT_VERIFIED',
  message: 'Cette structure n’est pas encore vérifiée et active : la double authentification de ses membres ne peut pas être ouverte. Vérifiez-la d’abord (Administration → Organisations → « Vérifier et activer »).',
});

/** may a member of `structure` receive an enrolment invitation from a sender of `senderStructureId` (null: the admin realm) @param {any} structure */
export function mfaInvitationAllowedFor(structure, senderStructureId) {
  if (senderStructureId && structure && String(structure.id) === String(senderStructureId)) return true;   // own structure: unchanged
  return isVerifiedActive(structure);
}

/** the member's structure as org-eligibility reads it @param {any} dbh @param {string} structureId */
export async function structureOf(dbh, structureId) {
  const [s] = (await dbh.execute(sql`SELECT id, statut, verification_status FROM "Structure" WHERE id = ${String(structureId || '')} LIMIT 1`)).rows;
  return s || null;
}

/**
 * writes the invitation (inside the caller's transaction); with lostDevice the member's factor is removed and every session ends first
 * @param {any} tx @param {{ id: string, email: string, role: string, structureId: string, mfa_enabled?: boolean }} member @param {{ lostDevice?: boolean }} [opts]
 * @returns {Promise<{ invitationId: string, token: string, email: string, role: string }>}
 */
export async function writeMfaInvitation(tx, member, { lostDevice = false } = {}) {
  const email = String(member.email).trim().toLowerCase();
  const role = String(member.role).toUpperCase();
  const token = newInviteToken();
  if (lostDevice && member.mfa_enabled) {
    await tx.update(ProUser).set({ mfa_enabled: false, mfa_secret: null, mfa_last_time_step: null, sessionsValidAfter: new Date() }).where(eq(ProUser.id, member.id));
  }
  // earlier pending invitations of this address in this structure stop working (only the newest link is valid)
  await tx.delete(Invitation).where(and(eq(Invitation.structureId, member.structureId), sql`lower(${Invitation.email}) = ${email}`, isNull(Invitation.used_at)));
  const [row] = await tx.insert(Invitation).values({
    structureId: member.structureId, email, role, token: hashInviteToken(token), expires_at: new Date(Date.now() + MFA_INVITATION_TTL_MS),
  }).returning({ id: Invitation.id });
  return { invitationId: row.id, token, email, role };
}

const TEXT = {
  structure: (link) => `Un administrateur de votre structure vous invite à activer la double authentification de votre accès professionnel.\nConnectez-vous, puis ouvrez ce lien (valable 72 heures, utilisable une fois, uniquement avec votre propre compte) : ${link}\n\nSi vous n’attendiez pas ce message, ne l’utilisez pas et prévenez l’administrateur de votre structure.`,
  platform: (link) => `L’équipe d’Accès Direct Aide a vérifié votre structure sur une source officielle : votre espace professionnel est ouvert.\nPour y entrer, connectez-vous avec l’adresse et le mot de passe choisis à l’inscription, puis ouvrez ce lien pour activer la double authentification (valable 72 heures, utilisable une fois, uniquement avec votre propre compte) : ${link}\n\nSi vous n’avez pas demandé d’espace professionnel, n’utilisez pas ce lien et répondez à ce message.`,
};

/** sends the link (configured mailer only); the answer says whether a provider accepted it, never « delivered » @param {string} email @param {string} token @param {'structure' | 'platform'} [sender] */
export async function mailMfaInvitation(email, token, sender = 'structure') {
  const link = buildAppUrl(`/pro/mfa-settings#invitation=${encodeURIComponent(token)}`);   // fragment: never sent to a server or kept in its logs
  const mail = await sendMail({
    to: email, category: 'pro-mfa-invitation', subject: 'Activer la double authentification — Accès Direct Aide', text: (TEXT[sender] || TEXT.structure)(link),
  }).catch(() => ({ accepted: false }));
  return mailLedgerStatus(mail);
}
