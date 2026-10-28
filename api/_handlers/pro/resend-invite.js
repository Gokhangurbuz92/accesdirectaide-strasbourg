import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { Invitation } from '../../../src/db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { logProAudit } from '../../_utils/auth.js';
import { AUTH_ROLE, requireProRole, requireProStructureContext } from '../../_utils/auth.js';
import { hashInviteToken, newInviteToken } from '../../_utils/invite-token.js';
import { sendMail, mailLedgerStatus } from '../../_utils/mailer.js';
import { buildAppUrl } from '../../_utils/user-auth.js';
import { clientIp } from '../../_utils/client-ip.js';
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';

/**
 * Resend Invitation API
 *
 * POST /api/pro/resend-invite  { invitationId }
 * — Regenerates the token, extends expiry, and re-sends the email.
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const proCtx = requireProStructureContext(req, res);
    if (!proCtx) return;

    const { structureId, userId } = proCtx;
    // R12: each resend sends an e-mail — same per-member budget as new invitations (was unbounded)
    const limited = await checkRateLimit('PRO_INVITE', `invite:${userId}`);
    if (!limited.allowed) return res.status(getRateLimitStatus(/** @type {any} */ (limited))).json(limited.error || { error: 'rate_limited' });
    const { invitationId } = req.body || {};

    if (!invitationId) {
        return res.status(400).json({ error: 'invitationId requis.' });
    }

    try {
        const invitation = await db.query.Invitation.findFirst({
            where: and(
                eq(Invitation.id, invitationId),
                eq(Invitation.structureId, structureId),
                isNull(Invitation.used_at)
            ),
        });

        if (!invitation) {
            return res.status(404).json({ error: 'Invitation introuvable ou déjà utilisée.' });
        }

        // Regenerate token and extend expiry by 7 days
        const newToken = newInviteToken();   // PKG-4 / D8: only its hash is stored
        const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await db.update(Invitation).set({
            token: hashInviteToken(newToken),
            expires_at: newExpiry,
        }).where(eq(Invitation.id, invitationId));

        const mail = await sendMail({ to: invitation.email, subject: 'Invitation à rejoindre une équipe sur Accès Direct Aide', category: 'pro-invitation',
            text: `Voici un nouveau lien pour rejoindre votre équipe sur Accès Direct Aide (valable 7 jours, utilisable une fois ; l’ancien lien ne fonctionne plus) : ${buildAppUrl(`/pro/register-invite?token=${encodeURIComponent(newToken)}`)}` }).catch(() => ({ accepted: false }));
        logger.info({ accepted: Boolean(mail?.accepted) }, '[ResendInvite] invitation e-mail handed to the mailer');

        await logProAudit('INVITATION_RESENT', userId, structureId, {
            email: invitation.email,
            invitationId,
        }, clientIp(req));

        return res.status(200).json({ ok: true, email: invitation.email, mailStatus: mailLedgerStatus(mail) });   // PKG-11 audit: honest delivery state
    } catch (e) {
        logger.error({ err: e }, '[ResendInvite] Erreur');
        return res.status(500).json({ error: 'Erreur interne.' });
    }
}

export default requireProRole(handler, [AUTH_ROLE.STRUCTURE_ADMIN, AUTH_ROLE.SUPERADMIN]);
