import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { ProUser } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { AUTH_ROLE, logProAudit, requireProRole } from '../../_utils/auth.js';
import { checkRateLimit, getClientIp } from '../../_utils/rateLimit.js';
import { ENROLMENT_ROLES } from '../../_utils/pro-mfa-enrolment.js';
import { STRUCTURE_NOT_VERIFIED, mailMfaInvitation, mfaInvitationAllowedFor, structureOf, writeMfaInvitation } from '../../_services/pro-mfa-invitation.js';

/**
 * R42-A08 — POST /api/pro/mfa-invitation { memberId, lostDevice? }: an authorised administrator invites an EXISTING member to enrol their second factor.
 * - STRUCTURE_ADMIN: members of their own structure only; SUPERADMIN (platform role): any structure (e.g. the first administrator of a self-registered
 *   structure). A member never invites themself (another person vouches for the identity).
 * - The invitation is bound to the member's structure, e-mail and current role; its token is stored hashed, used once, valid 72 h. Earlier pending enrolment
 *   invitations of the same address in that structure are withdrawn.
 * - lostDevice (procedure documented in CONTROL/r42/R42_ACCOUNTS_AND_PRO_MFA.md §5): the member's factor is removed and every session ends in the same
 *   transaction, then the invitation is sent. Without lostDevice an enrolled member is refused (their factor stays).
 * - The link goes through the configured mailer only (LAB: test or no-op provider); the answer says whether a provider accepted it, never « delivered ».
 *   The audit rows carry ids, the role and the reason — never the token.
 * - G14 (owner 23/11/2026): a member of ANOTHER structure (the SUPERADMIN's cross-structure invitation, e.g. the first administrator of a self-registered
 *   structure) is invited only when that structure is active AND identity-verified (org-eligibility); otherwise 409 STRUCTURE_NOT_VERIFIED, nothing written.
 *   The SUPERADMIN's own structure and a structure administrator's own members are unchanged. The writing and the e-mail live in
 *   api/_services/pro-mfa-invitation.js (shared with « Vérifier et activer » of /admin/organizations).
 */
const NOT_FOUND = { error: 'Not found' };

async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const actor = /** @type {{ userId: string, role: string, structureId: string }} */ (req.user);
    const isPlatform = actor.role === AUTH_ROLE.SUPERADMIN;
    const body = req.body && typeof req.body === 'object' ? /** @type {Record<string, unknown>} */ (req.body) : {};
    const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : '';
    const lostDevice = body.lostDevice === true;
    if (!memberId) return res.status(400).json({ error: 'MEMBER_REQUIRED', message: 'Choisissez le membre à inviter.' });
    if (memberId === actor.userId) {
        return res.status(403).json({ error: 'MFA_INVITATION_SELF', message: 'Une invitation à la double authentification doit être envoyée par un autre administrateur.' });
    }

    const ip = getClientIp(req);
    const limit = await checkRateLimit('PRO_INVITE', `invite:${actor.userId}`);
    if (!limit.allowed) return res.status(429).json(limit.error || { error: 'rate_limited' });

    const member = await db.query.ProUser.findFirst({ where: eq(ProUser.id, memberId), columns: { id: true, email: true, role: true, status: true, structureId: true, mfa_enabled: true } });
    // the same answer for « no such member » and « a member of another structure » (no membership oracle)
    if (!member || (!isPlatform && member.structureId !== actor.structureId)) return res.status(404).json(NOT_FOUND);
    if (!['active', 'pending'].includes(String(member.status)) || !ENROLMENT_ROLES.includes(String(member.role).toUpperCase())) return res.status(404).json(NOT_FOUND);
    if (member.mfa_enabled && !lostDevice) {
        return res.status(409).json({ error: 'MFA_ALREADY_ENABLED', message: 'Ce membre a déjà activé la double authentification. En cas d’appareil perdu, utilisez la procédure « appareil perdu ».' });
    }

    // G14: the member's structure must be active and verified unless it is the sender's own
    if (!mfaInvitationAllowedFor(await structureOf(db, member.structureId), actor.structureId)) {
        await logProAudit('MFA_INVITATION_REFUSED_UNVERIFIED', actor.userId, member.structureId, { memberId: member.id }, ip);
        return res.status(409).json({ ...STRUCTURE_NOT_VERIFIED });
    }

    let written;
    try {
        written = await db.transaction((tx) => writeMfaInvitation(tx, member, { lostDevice }));
    } catch (err) {
        logger.error({ err: { name: /** @type {{ name?: string }} */ (err)?.name } }, '[mfa-invitation] creation failed');
        return res.status(500).json({ error: 'L’invitation n’a pas pu être créée. Réessayez.' });
    }
    const { invitationId, token, email } = written;

    if (lostDevice && member.mfa_enabled) await logProAudit('MFA_FACTOR_RESET', actor.userId, member.structureId, { memberId: member.id, reason: 'LOST_DEVICE' }, ip);
    // INVITATION_SENT carries the sender: redemption checks they are still an authorised administrator (invite-token.js invitationsWithRevokedSender)
    await logProAudit('INVITATION_SENT', actor.userId, member.structureId, { kind: 'MFA_ENROLMENT', invitationId, memberId: member.id, role: String(member.role).toUpperCase(), lostDevice }, ip);

    const mailStatus = await mailMfaInvitation(email, token, 'structure');

    return res.status(201).json({ ok: true, invitation: { id: invitationId, memberId: member.id, email, role: String(member.role).toUpperCase(), lostDevice }, mailStatus });
}

export default requireProRole(handler, [AUTH_ROLE.STRUCTURE_ADMIN, AUTH_ROLE.SUPERADMIN]);
