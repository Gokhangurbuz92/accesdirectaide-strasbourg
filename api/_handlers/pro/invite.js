import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { ProUser, Invitation } from '../../../src/db/schema.js';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { ROLE, logProAudit } from '../../_utils/auth.js';
import { AUTH_ROLE, requireProRole, requireProStructureContext } from '../../_utils/auth.js';
import { hashInviteToken, newInviteToken, publicInvitation } from '../../_utils/invite-token.js';
import { sendMail, mailLedgerStatus } from '../../_utils/mailer.js';
import { buildAppUrl } from '../../_utils/user-auth.js';
import { clientIp } from '../../_utils/client-ip.js';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Méthode non autorisée.' });
    }

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { structureId, userId } = proCtx;

    // ── DELETE: Cancel a pending invitation ──
    if (req.method === 'DELETE') {
        const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
        const invitationId = url.searchParams.get('id') || req.query?.id;

        if (!invitationId) {
            return res.status(400).json({ error: 'id requis.' });
        }

        try {
            const invitation = await db.query.Invitation.findFirst({
                where: and(
                    eq(Invitation.id, invitationId),
                    eq(Invitation.structureId, structureId),
                    isNull(Invitation.used_at)
                )
            });

            if (!invitation) {
                return res.status(404).json({ error: 'Invitation introuvable.' });
            }

            await db.delete(Invitation).where(eq(Invitation.id, invitationId));

            await logProAudit('INVITATION_CANCELLED', userId, structureId, {
                email: invitation.email,
                invitationId,
            }, clientIp(req));

            return res.status(200).json({ ok: true });
        } catch (e) {
            logger.error({ err: e }, '[Invite] Cancel error');
            return res.status(500).json({ error: 'Erreur interne.' });
        }
    }

    // ── POST: Create invitation ──
    // R12: each invitation sends an e-mail — limited per member (was unbounded)
    const limited = await checkRateLimit('PRO_INVITE', `invite:${userId}`);
    if (!limited.allowed) return res.status(getRateLimitStatus(/** @type {any} */ (limited))).json(limited.error || { error: 'rate_limited' });

    const { role: requestedRole } = req.body || {};
    const email = String(req.body?.email || '').trim().toLowerCase();   // R14: stored and compared lower-cased, like sign-up and sign-in
    if (!email) return res.status(400).json({ error: 'Indiquez l’adresse électronique de la personne à inviter.' });
    // PKG-4 / D3: the role of an invitation is one of the structure's own roles (never SUPERADMIN, never an arbitrary string copied into ProUser.role)
    const inviteRole = requestedRole === undefined || requestedRole === null || requestedRole === '' ? ROLE.PRO : String(requestedRole);
    if (!['PRO', 'STRUCTURE_ADMIN'].includes(inviteRole)) return res.status(400).json({ error: 'Rôle invalide. Valeurs acceptées : PRO, STRUCTURE_ADMIN' });

    try {
        // Check if user already exists in structure
        const existing = await db.query.ProUser.findFirst({
            where: and(eq(ProUser.structureId, structureId), sql`lower(${ProUser.email}) = ${email}`)
        });
        if (existing) {
            return res.status(400).json({ error: 'Cette personne fait déjà partie de l’équipe.' });
        }

        const token = newInviteToken();   // PKG-4 / D8: only its hash is stored
        const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        const [invitation] = await db.insert(Invitation).values({
                structureId,
                email,
                role: inviteRole,
                token: hashInviteToken(token),
                expires_at
        }).returning();

        // the link travels by the configured mailer only (LAB: in-memory test provider; production provider = owner activation). The token is never logged.
        const mail = await sendMail({ to: email, subject: 'Invitation à rejoindre une équipe sur Accès Direct Aide', category: 'pro-invitation',
            text: `Vous êtes invité·e à rejoindre une équipe sur Accès Direct Aide.\nCréez votre accès (lien valable 7 jours, utilisable une fois) : ${buildAppUrl(`/pro/register-invite?token=${encodeURIComponent(token)}`)}\n\nSi vous n’attendiez pas cette invitation, ignorez ce message.` }).catch(() => ({ accepted: false }));
        logger.info({ accepted: Boolean(mail?.accepted) }, '[Invite] invitation e-mail handed to the mailer');

        await logProAudit('INVITATION_SENT', userId, structureId, { email, role: inviteRole, invitationId: invitation.id }, clientIp(req));   // R20: the sender of this invitation (redemption checks they are still an administrator)

        // PKG-11 audit: the page says whether the e-mail was really handed to a provider (mailLedgerStatus semantics; « sent » was shown whatever happened)
        return res.status(201).json({ ...publicInvitation(invitation), mailStatus: mailLedgerStatus(mail) });

    } catch (e) {
        logger.error({ err: e }, "Invite API Error");
        return res.status(500).json({ error: 'L’invitation n’a pas pu être créée. Réessayez.' });
    }
}

export default requireProRole(handler, [AUTH_ROLE.STRUCTURE_ADMIN, AUTH_ROLE.SUPERADMIN]);
