import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { Invitation, ProUser } from '../../../src/db/schema.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AUTH_ROLE, logProAudit, requireProRole } from '../../_utils/auth.js';
import { hashInviteToken, newInviteToken } from '../../_utils/invite-token.js';
import { mailLedgerStatus, sendMail } from '../../_utils/mailer.js';
import { buildAppUrl } from '../../_utils/user-auth.js';
import { checkRateLimit, getClientIp } from '../../_utils/rateLimit.js';
import { ENROLMENT_ROLES, MFA_INVITATION_TTL_MS } from '../../_utils/pro-mfa-enrolment.js';

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

    const email = String(member.email).trim().toLowerCase();
    const token = newInviteToken();
    let invitationId = '';
    try {
        invitationId = await db.transaction(async (tx) => {
            if (lostDevice && member.mfa_enabled) {
                await tx.update(ProUser).set({ mfa_enabled: false, mfa_secret: null, mfa_last_time_step: null, sessionsValidAfter: new Date() }).where(eq(ProUser.id, member.id));
            }
            // earlier pending invitations of this address in this structure stop working (only the newest link is valid)
            await tx.delete(Invitation).where(and(eq(Invitation.structureId, member.structureId), sql`lower(${Invitation.email}) = ${email}`, isNull(Invitation.used_at)));
            const [row] = await tx.insert(Invitation).values({
                structureId: member.structureId, email, role: String(member.role).toUpperCase(), token: hashInviteToken(token), expires_at: new Date(Date.now() + MFA_INVITATION_TTL_MS),
            }).returning({ id: Invitation.id });
            return row.id;
        });
    } catch (err) {
        logger.error({ err: { name: /** @type {{ name?: string }} */ (err)?.name } }, '[mfa-invitation] creation failed');
        return res.status(500).json({ error: 'L’invitation n’a pas pu être créée. Réessayez.' });
    }

    if (lostDevice && member.mfa_enabled) await logProAudit('MFA_FACTOR_RESET', actor.userId, member.structureId, { memberId: member.id, reason: 'LOST_DEVICE' }, ip);
    // INVITATION_SENT carries the sender: redemption checks they are still an authorised administrator (invite-token.js invitationsWithRevokedSender)
    await logProAudit('INVITATION_SENT', actor.userId, member.structureId, { kind: 'MFA_ENROLMENT', invitationId, memberId: member.id, role: String(member.role).toUpperCase(), lostDevice }, ip);

    const link = buildAppUrl(`/pro/mfa-settings#invitation=${encodeURIComponent(token)}`);   // fragment: never sent to a server or kept in its logs
    const mail = await sendMail({
        to: email, category: 'pro-mfa-invitation', subject: 'Activer la double authentification — Accès Direct Aide',
        text: `Un administrateur de votre structure vous invite à activer la double authentification de votre accès professionnel.\nConnectez-vous, puis ouvrez ce lien (valable 72 heures, utilisable une fois, uniquement avec votre propre compte) : ${link}\n\nSi vous n’attendiez pas ce message, ne l’utilisez pas et prévenez l’administrateur de votre structure.`,
    }).catch(() => ({ accepted: false }));

    return res.status(201).json({ ok: true, invitation: { id: invitationId, memberId: member.id, email, role: String(member.role).toUpperCase(), lostDevice }, mailStatus: mailLedgerStatus(mail) });
}

export default requireProRole(handler, [AUTH_ROLE.STRUCTURE_ADMIN, AUTH_ROLE.SUPERADMIN]);
