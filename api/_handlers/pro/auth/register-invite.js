// @ts-nocheck
import { inviteTokenWhere, invitationsWithRevokedSender } from '../../../_utils/invite-token.js';
import { passwordMessage, passwordProblems } from '../../../../src/lib/passwordPolicy.js';
import logger from '../../../_utils/logger.js';
// @ts-nocheck
import { hashPassword } from '../../../_utils/user-auth.js';
import { signProToken, logProAudit } from '../../../_utils/auth.js';
import { checkRateLimit, getClientIp } from '../../../_utils/rateLimit.js';
import { db } from '../../../../src/db/index.js';
import { Invitation, ProUser } from '../../../../src/db/schema.js';
import { eq, and, gt, isNull, sql } from 'drizzle-orm';
import { clientIp } from '../../../_utils/client-ip.js';

/**
 * Register via Invitation Token
 *
 * POST /api/pro/auth/register-invite
 * Body: { token, password }
 *
 * 1. Validates the invitation token (not expired, not used)
 * 2. Creates the ProUser linked to the invitation's structure
 * 3. Marks the invitation as used
 * 4. Returns a JWT for immediate login
 */

const SENDER_REVOKED = 'Cette invitation n’est plus valable : la personne qui l’a envoyée n’est plus administratrice de la structure. Demandez une nouvelle invitation à un administrateur.';

export default async function handler(/** @type {import('../../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../../_utils/http-types').ApiResponse} */ res) {
    if (req.method === 'GET') {
        // GET: Validate token only (for the registration form)
        const url = new URL(req.url || '/', `https://${req.headers?.host || 'localhost'}`);
        const token = url.searchParams.get('token');

        if (!token) {
            return res.status(400).json({ error: 'Token manquant' });
        }

        const invitation = await db.query.Invitation.findFirst({
            where: (i) => inviteTokenWhere(i.token, token),   // PKG-4 / D8: stored hashed
            with: { structure: { columns: { id: true, nom: true } } },
        });

        if (!invitation) {
            return res.status(404).json({ error: 'Invitation introuvable' });
        }

        if (invitation.used_at) {
            return res.status(410).json({ error: 'Cette invitation a déjà été utilisée.' });
        }

        if (new Date() > new Date(invitation.expires_at)) {
            return res.status(410).json({ error: 'Cette invitation a expiré. Demandez un nouveau lien.' });
        }
        if ((await invitationsWithRevokedSender(db, [invitation.id])).has(invitation.id)) return res.status(410).json({ error: SENDER_REVOKED, code: 'INVITATION_SENDER_REVOKED' });

        return res.status(200).json({
            ok: true,
            email: invitation.email,
            role: invitation.role,
            structureName: invitation.structure.nom,
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    const ip = getClientIp(req);

    // Rate limit registration attempts
    const limit = await checkRateLimit('REGISTER_INVITE', `ip:${ip}`);
    if (!limit.allowed) {
        return res.status(429).json(limit.error || { error: 'Trop de tentatives. Réessayez plus tard.' });
    }

    const { token, password } = req.body;

    if (!token || !password) {
        return res.status(400).json({ error: 'Token et mot de passe requis' });
    }

    // R21: the shared password rule (src/lib/passwordPolicy.js)
    const pwProblems = passwordProblems(password);
    if (pwProblems.length) {
        return res.status(400).json({ error: passwordMessage(pwProblems) });
    }

    try {
        // 1. Find and validate invitation
        const invitation = await db.query.Invitation.findFirst({
            where: (i) => inviteTokenWhere(i.token, token),   // PKG-4 / D8: stored hashed
            with: { structure: { columns: { id: true, nom: true } } },
        });

        if (!invitation) {
            return res.status(404).json({ error: 'Invitation introuvable' });
        }

        if (invitation.used_at) {
            return res.status(410).json({ error: 'Cette invitation a déjà été utilisée.' });
        }

        if (new Date() > new Date(invitation.expires_at)) {
            return res.status(410).json({ error: 'Cette invitation a expiré.' });
        }

        // R20: the person who sent it has left, been suspended or is no longer an administrator of the organization — no access is created on their word
        if ((await invitationsWithRevokedSender(db, [invitation.id])).has(invitation.id)) {
            await logProAudit('INVITATION_REFUSED_SENDER_REVOKED', 'invitee', invitation.structureId, { invitationId: invitation.id }, clientIp(req));
            return res.status(410).json({ error: SENDER_REVOKED, code: 'INVITATION_SENDER_REVOKED' });
        }

        // 2. Check if email already exists in this structure
        const existingUser = await db.query.ProUser.findFirst({
            where: (u, { eq, and }) => and(sql`lower(${u.email}) = ${String(invitation.email).trim().toLowerCase()}`, eq(u.structureId, invitation.structureId)),
        });

        if (existingUser) {
            // Mark invitation as used to avoid confusion
            await db.update(Invitation).set({ used_at: new Date() }).where(eq(Invitation.id, invitation.id));
            return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
        }

        // 3. PKG-4 / D8: claim the invitation and create the account in ONE transaction; the claim is conditional (unused, unexpired), so two concurrent
        //    redemptions cannot both succeed and a failed account creation does not consume the invitation.
        const hashedPassword = await hashPassword(password);
        const user = await db.transaction(async (tx) => {
            const claimed = await tx.update(Invitation).set({ used_at: new Date() })
                .where(and(eq(Invitation.id, invitation.id), isNull(Invitation.used_at), gt(Invitation.expires_at, new Date()))).returning({ id: Invitation.id });
            if (!claimed.length) return null;
            const [created] = await tx.insert(ProUser).values({
                email: String(invitation.email).trim().toLowerCase(),   // R14: lower-cased like every other account
                password_hash: hashedPassword,
                role: ['PRO', 'STRUCTURE_ADMIN'].includes(invitation.role) ? invitation.role : 'PRO',   // PKG-4 / D3: never a platform role from an invitation
                status: 'active',
                structureId: invitation.structureId,
            }).returning();
            return created;
        });
        if (!user) return res.status(410).json({ error: 'Cette invitation a déjà été utilisée.' });

        const result = user;

        // 4. Sign JWT
        const jwt = signProToken(result);

        const ip = clientIp(req);
        await logProAudit('REGISTER_VIA_INVITE', result.id, invitation.structureId, {
            invitationId: invitation.id,
        }, ip);

        return res.status(201).json({
            token: jwt,
            user: {
                id: result.id,
                email: result.email,
                role: result.role,
                structureId: invitation.structureId,
                structureName: invitation.structure.nom,
            },
        });
    } catch (error) {
        logger.error('[Register Invite] Erreur:', error.message);
        return res.status(500).json({ error: "Erreur lors de l'inscription." });
    }
}
