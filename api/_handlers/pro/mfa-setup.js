import { db } from '../../../src/db/index.js';
import { ProUser } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireProAuth, proMfaRequired, signProToken } from '../../_utils/auth.js';
import { logProAudit } from '../../_utils/auth.js';
import { generateSecret, matchCodeStep, buildOtpauthUrl } from '../../lib/totp.js';
import { checkRateLimit, getClientIp } from '../../_utils/rateLimit.js';
import { claimProStep, isVaultReady, openMfaSecret, sealMfaSecret } from '../../_utils/totp-guard.js';
import { checkMfaEnrolmentGrant, enrolmentGrantFrom } from '../../_utils/pro-mfa-enrolment.js';

/** R42-A08: the answer when the enrolment is not bound to a redeemed invitation (the same whatever the reason; the reason goes to the audit log) */
const INVITATION_REQUIRED = { error: 'MFA_INVITATION_REQUIRED', message: 'La double authentification s’active uniquement avec une invitation envoyée par un administrateur de votre structure. Demandez-lui une invitation, puis ouvrez le lien reçu par e-mail.' };

/**
 * R42-A08: the enrolment (GET secret, POST first code) needs a grant obtained by redeeming an invitation (api/_utils/pro-mfa-enrolment.js); a password-only
 * session alone is refused.
 * @param {import('../../_utils/http-types').ApiRequest} req @param {import('../../_utils/http-types').ApiResponse} res
 * @param {import('../../_utils/pro-mfa-enrolment.js').ProAccount} user @param {string | null} ip
 * @returns {Promise<string | null>} the invitation id, or null after the 403 was written
 */
async function enrolmentAllowed(req, res, user, ip) {
    const grant = await checkMfaEnrolmentGrant(db, user, enrolmentGrantFrom(req));
    if (grant.ok) return grant.invitationId;
    await logProAudit('MFA_ENROL_REFUSED', user.id, user.structureId, { reason: grant.reason }, ip);
    res.status(403).json(INVITATION_REQUIRED);
    return null;
}

/**
 * MFA Setup handler (Pro-only)
 *
 * R42-A08: GET and POST need an enrolment grant (header x-ada-mfa-enrolment or body enrolmentToken) from a redeemed invitation; password alone → 403.
 * GET  → Generate secret + otpauth URL (does NOT enable MFA yet); refused while MFA is ON (PKG-11 audit: a bare GET used to switch MFA off and hand a new
 *        secret to whoever held the session — turning MFA off needs DELETE with a valid code)
 * POST → Verify initial code → enable MFA. R40: refused while MFA is ON (409); the codes count against the same per-account limit as the sign-in codes;
 *        enabling it ends every earlier session of the account (they were password-only) and returns a fresh one with the second factor
 * DELETE → Disable MFA (requires valid code as confirmation)
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    // PKG-11 audit: a disabled or moved account keeps a « revoked » context that belongs to no organization; this route acts on the user alone, so it refuses it
    if (req.user?.role === 'revoked') return res.status(404).json({ error: 'Not found' });
    const { userId, email, structureId } = req.user;

    // --- GET: Generate new secret ---
    if (req.method === 'GET') {
        const current = await db.query.ProUser.findFirst({ where: eq(ProUser.id, userId), columns: { id: true, email: true, role: true, structureId: true, sessionsValidAfter: true, mfa_enabled: true } });
        if (current?.mfa_enabled) {
            return res.status(409).json({ error: 'MFA_ALREADY_ENABLED', message: 'La double authentification est déjà active. Désactivez-la d’abord avec un code valide.' });
        }
        if (!current) return res.status(404).json({ error: 'Not found' });
        if (!(await enrolmentAllowed(req, res, current, getClientIp(req)))) return;
        const startLimit = await checkRateLimit('MFA_ENROL_START_PRO', `user:${userId}`);
        if (!startLimit.allowed) return res.status(429).json(startLimit.error || { error: 'Trop de tentatives. Réessayez plus tard.' });
        // owner LAB audit: the seed is sealed at rest like the administrators' (never written in clear again); without the vault key there is no enrolment
        if (!isVaultReady()) return res.status(503).json({ error: 'MFA_UNAVAILABLE', message: 'La double authentification est momentanément indisponible.' });
        const secret = generateSecret();
        const otpauthUrl = buildOtpauthUrl(secret, email);

        // Save secret but keep mfa_enabled = false until verified
        await db.update(ProUser).set({ mfa_secret: sealMfaSecret(secret), mfa_enabled: false }).where(eq(ProUser.id, userId));

        return res.status(200).json({ ok: true, secret, otpauthUrl });
    }

    // --- POST: Verify code and enable MFA ---
    if (req.method === 'POST') {
        const { code } = req.body || {};
        if (!code || String(code).length !== 6) {
            return res.status(400).json({ error: 'Code à 6 chiffres requis' });
        }

        const user = await db.query.ProUser.findFirst({ where: eq(ProUser.id, userId) });
        if (user?.mfa_enabled) {
            return res.status(409).json({ error: 'MFA_ALREADY_ENABLED', message: 'La double authentification est déjà active.' });
        }
        const ip = getClientIp(req);
        if (!user) return res.status(404).json({ error: 'Not found' });
        const invitationId = await enrolmentAllowed(req, res, user, ip);
        if (!invitationId) return;
        if (!user.mfa_secret) {
            return res.status(400).json({ error: 'Aucun secret MFA configuré. Lancez d\'abord GET /api/pro/mfa-setup.' });
        }

        const limit = await checkRateLimit('MFA_VERIFY_PRO_USER', `user:${userId}`);
        if (!limit.allowed) {
            await logProAudit('MFA_LOCKED', userId, structureId, { step: 'enrolment' }, ip);
            return res.status(429).json(limit.error || { error: 'Trop de tentatives. Réessayez plus tard.' });
        }

        const step = matchCodeStep(openMfaSecret(user.mfa_secret) || '', String(code));
        if (step === null || !(await claimProStep(db, userId, step))) {
            await logProAudit('MFA_ENROL_FAILED', userId, structureId, {}, ip);
            return res.status(400).json({ error: 'Code de vérification incorrect' });
        }

        // R40: every session issued before now ends (sessionsValidAfter); the token returned below is issued after it, so it stays valid
        await db.update(ProUser).set({ mfa_enabled: true, sessionsValidAfter: new Date() }).where(eq(ProUser.id, userId));

        await logProAudit('MFA_ENABLED', userId, structureId, { invitationId }, ip);   // R42-A08: the invitation the factor is bound to (never the seed or a code)

        // R34: the code just proved the second factor — the session continues with it (no second sign-in needed to reach the dossiers)
        return res.status(200).json({ ok: true, message: 'MFA activé avec succès', token: signProToken({ id: userId, email, structureId, role: user.role, authTime: req.auth?.authTime }, { mfa: true }) });
    }

    // --- DELETE: Disable MFA (requires valid code) ---
    if (req.method === 'DELETE') {
        // R34: where the second factor is required (production), it cannot be switched off. R42-A08: a lost device is handled by another administrator
        // (pro/mfa-invitation with lostDevice: the factor is reset, every session ends and a fresh single-use enrolment invitation is sent)
        if (proMfaRequired()) return res.status(403).json({ error: 'MFA_REQUIRED', message: 'La double authentification est obligatoire pour ADA Pro : elle ne peut pas être désactivée.' });
        const { code } = req.body || {};
        if (!code || String(code).length !== 6) {
            return res.status(400).json({ error: 'Code à 6 chiffres requis pour désactiver le MFA' });
        }

        const user = await db.query.ProUser.findFirst({ where: eq(ProUser.id, userId) });
        if (!user?.mfa_secret || !user.mfa_enabled) {
            return res.status(400).json({ error: 'MFA non activé' });
        }

        const step = matchCodeStep(openMfaSecret(user.mfa_secret) || '', String(code));
        if (step === null || !(await claimProStep(db, userId, step))) {
            return res.status(400).json({ error: 'Code incorrect' });
        }

        await db.update(ProUser).set({ mfa_enabled: false, mfa_secret: null }).where(eq(ProUser.id, userId));

        await logProAudit('MFA_DISABLED', userId, structureId, {}, null);

        return res.status(200).json({ ok: true, message: 'MFA désactivé' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// Strict pro-only auth (not generic requireAuth)
export default requireProAuth(handler);
