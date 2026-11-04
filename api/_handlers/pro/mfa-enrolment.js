import { db } from '../../../src/db/index.js';
import { ProUser } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { logProAudit, requireProAuth } from '../../_utils/auth.js';
import { checkRateLimit, getClientIp } from '../../_utils/rateLimit.js';
import { MFA_ENROLMENT_GRANT_SECONDS, redeemMfaInvitation, signMfaEnrolmentGrant } from '../../_utils/pro-mfa-enrolment.js';

/**
 * R42-A08 — POST /api/pro/mfa-enrolment { token }: a signed-in professional redeems the MFA enrolment invitation an administrator sent to their address.
 * The invitation must name THIS account (structure, e-mail, role), be unused, unexpired, and its sender must still be an authorised administrator. The answer
 * to a refusal is the same whatever the reason (wrong account, expired, reused, tampered); the reason is in the audit log (never the token).
 * Success → { ok, enrolmentToken, expiresInSeconds }: the grant the enrolment screen sends to /api/pro/mfa-setup.
 */
const INVALID = { error: 'MFA_INVITATION_INVALID', message: 'Ce lien d’activation n’est pas valable pour votre compte (déjà utilisé, expiré ou destiné à une autre personne). Demandez une nouvelle invitation à un administrateur de votre structure.' };

async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const user = /** @type {{ userId: string, role: string, structureId: string }} */ (req.user);
    if (user.role === 'revoked') return res.status(404).json({ error: 'Not found' });   // disabled or moved account: no organization context

    const ip = getClientIp(req);
    for (const key of [`user:${user.userId}`, `ip:${ip}`]) {
        const limit = await checkRateLimit('PRO_MFA_ENROL_REDEEM', key);
        if (!limit.allowed) return res.status(429).json(limit.error || { error: 'Trop de tentatives. Réessayez plus tard.' });
    }

    const account = await db.query.ProUser.findFirst({ where: eq(ProUser.id, user.userId), columns: { id: true, email: true, role: true, structureId: true, sessionsValidAfter: true, mfa_enabled: true } });
    if (!account) return res.status(404).json({ error: 'Not found' });
    if (account.mfa_enabled) return res.status(409).json({ error: 'MFA_ALREADY_ENABLED', message: 'La double authentification est déjà active sur votre compte.' });

    const body = req.body && typeof req.body === 'object' ? /** @type {Record<string, unknown>} */ (req.body) : {};
    const out = await redeemMfaInvitation(db, account, body.token);
    if (!out.ok) {
        await logProAudit('MFA_INVITATION_REFUSED', account.id, account.structureId, { reason: out.reason, invitationId: out.invitationId ?? null }, ip);
        return res.status(410).json(INVALID);
    }
    await logProAudit('MFA_INVITATION_REDEEMED', account.id, account.structureId, { invitationId: out.invitationId }, ip);
    const enrolmentToken = signMfaEnrolmentGrant({ userId: account.id, structureId: account.structureId, invitationId: out.invitationId });
    return res.status(200).json({ ok: true, enrolmentToken, expiresInSeconds: MFA_ENROLMENT_GRANT_SECONDS });
}

export default requireProAuth(handler);
