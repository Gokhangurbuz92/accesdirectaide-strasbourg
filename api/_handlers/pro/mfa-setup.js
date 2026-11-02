import { db } from '../../../src/db/index.js';
import { ProUser } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { requireProAuth, proMfaRequired, signProToken } from '../../_utils/auth.js';
import { logProAudit } from '../../_utils/auth.js';
import { generateSecret, matchCodeStep, buildOtpauthUrl } from '../../lib/totp.js';
import { claimProStep, isVaultReady, openMfaSecret, sealMfaSecret } from '../../_utils/totp-guard.js';

/**
 * MFA Setup handler (Pro-only)
 *
 * GET  → Generate secret + otpauth URL (does NOT enable MFA yet); refused while MFA is ON (PKG-11 audit: a bare GET used to switch MFA off and hand a new
 *        secret to whoever held the session — turning MFA off needs DELETE with a valid code)
 * POST → Verify initial code → enable MFA
 * DELETE → Disable MFA (requires valid code as confirmation)
 */
async function handler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    // PKG-11 audit: a disabled or moved account keeps a « revoked » context that belongs to no organization; this route acts on the user alone, so it refuses it
    if (req.user?.role === 'revoked') return res.status(404).json({ error: 'Not found' });
    const { userId, email, structureId } = req.user;

    // --- GET: Generate new secret ---
    if (req.method === 'GET') {
        const current = await db.query.ProUser.findFirst({ where: eq(ProUser.id, userId), columns: { mfa_enabled: true } });
        if (current?.mfa_enabled) {
            return res.status(409).json({ error: 'MFA_ALREADY_ENABLED', message: 'La double authentification est déjà active. Désactivez-la d’abord avec un code valide.' });
        }
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
        if (!user?.mfa_secret) {
            return res.status(400).json({ error: 'Aucun secret MFA configuré. Lancez d\'abord GET /api/pro/mfa-setup.' });
        }

        const step = matchCodeStep(openMfaSecret(user.mfa_secret) || '', String(code));
        if (step === null || !(await claimProStep(db, userId, step))) {
            return res.status(400).json({ error: 'Code de vérification incorrect' });
        }

        await db.update(ProUser).set({ mfa_enabled: true }).where(eq(ProUser.id, userId));

        await logProAudit('MFA_ENABLED', userId, structureId, {}, null);

        // R34: the code just proved the second factor — the session continues with it (no second sign-in needed to reach the dossiers)
        return res.status(200).json({ ok: true, message: 'MFA activé avec succès', token: signProToken({ id: userId, email, structureId, role: user.role }, { mfa: true }) });
    }

    // --- DELETE: Disable MFA (requires valid code) ---
    if (req.method === 'DELETE') {
        // R34: where the second factor is required (production), it cannot be switched off. Open item: no recovery path exists yet for a lost device (an
        // audited administrator reset must be built before ADA Pro opens)
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
