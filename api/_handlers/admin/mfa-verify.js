import { verify as verifyTotp } from 'otplib';
import { db } from '../../../src/db/index.js';
import { AdminUser, AuditLog } from '../../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

// owner LAB: the MFA steps are part of the administrator's session history (listed with the sign-ins in Paramètres); no code or secret is ever written
const audit = (/** @type {string} */ action, /** @type {string} */ email, details = {}) => db.insert(AuditLog).values({ action, actor: email, actor_id: email, entity: 'AdminSession', details }).catch(() => {});

// PKG-11 audit: wrong codes are counted on the administrator (shared with the password failures) and lock the account for 15 minutes after 5 — the 60/min/IP
// limit alone let a holder of a stolen password try ~86 000 codes a day per address.
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
import { decryptToken } from '../../_utils/vault.js';
import { claimAdminStep } from '../../_utils/totp-guard.js';
import logger from '../../_utils/logger.js';
import { requireAdminAuth, signAdminSessionToken } from '../../_utils/auth.js';

/**
 * POST /api/admin/mfa-verify
 *
 * Validates the 6-digit TOTP code and elevates session privileges.
 *
 * Flow:
 * 1. Admin submits 6-digit code from authenticator app
 * 2. Server decrypts TOTP secret from DB
 * 3. Validates code with 1-step time drift window (RFC 6238 §5)
 * 4. On first verification: activates MFA permanently
 * 5. Re-issues JWT with mfa_verified: true claim
 */
async function verifyHandler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { code } = req.body || {};

    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: 'Invalid code format. Expected 6 digits.' });
    }

    const adminEmail = req.auth?.email;
    if (!adminEmail) {
        return res.status(401).json({ error: 'Admin identity not found' });
    }

    try {
        // 1. Find admin with MFA secret
        const admin = await db.query.AdminUser.findFirst({ where: eq(AdminUser.email, adminEmail) });
        if (!admin || !admin.mfaSecret || !admin.mfaIv) {
            return res.status(404).json({ error: 'MFA not configured. Run setup first.' });
        }

        if (admin.lockoutUntil && new Date(admin.lockoutUntil).getTime() > Date.now()) {
            return res.status(423).json({ error: 'ACCOUNT_LOCKED', message: 'Trop de codes erronés : réessayez dans 15 minutes.' });
        }

        // 2. Decrypt TOTP seed from Vault
        const secret = decryptToken(admin.mfaSecret, admin.mfaIv);

        // 3. Verify with 1-step time drift window (RFC 6238 §5)
        // otplib v13 verify() is async, returns { valid, delta, epoch }
        const result = await verifyTotp({ token: code, secret, epochTolerance: 30, ...(Number.isInteger(admin.mfaLastTimeStep) ? { afterTimeStep: /** @type {number} */ (admin.mfaLastTimeStep) } : {}) });
        // a code is accepted once (RFC 6238 §5.2): its time step is claimed with a compare-and-set, so a replay — even a concurrent one — is a wrong code
        const accepted = Boolean(result && result.valid) && await claimAdminStep(db, admin.id, /** @type {any} */ (result).timeStep);

        if (!accepted) {
            const [after] = await db.update(AdminUser).set({ failedLoginAttempts: sql`COALESCE(${AdminUser.failedLoginAttempts}, 0) + 1` }).where(eq(AdminUser.id, admin.id)).returning({ n: AdminUser.failedLoginAttempts });
            const locked = (after?.n || 0) >= MAX_FAILURES;
            if (locked) await db.update(AdminUser).set({ lockoutUntil: new Date(Date.now() + LOCK_MS), failedLoginAttempts: 0 }).where(eq(AdminUser.id, admin.id));
            await audit(locked ? 'ADMIN_LOGIN_LOCKED' : 'ADMIN_MFA_FAILED', adminEmail, { step: admin.mfaEnabled ? 'code' : 'enrolment' });
            logger.info(
                { msg: 'admin.mfa.verify_failed', email: adminEmail, failures: after?.n || 0 },
                '[Admin MFA] Invalid code attempt',
            );
            return res.status(403).json({ error: 'Invalid or expired code' });
        }
        await db.update(AdminUser).set({ failedLoginAttempts: 0, lockoutUntil: null }).where(eq(AdminUser.id, admin.id));

        // 4. First-time activation
        await audit(admin.mfaEnabled ? 'ADMIN_MFA_VERIFIED' : 'ADMIN_MFA_ENROLLED', adminEmail);
        if (!admin.mfaEnabled) {
            await db.update(AdminUser).set({ mfaEnabled: true }).where(eq(AdminUser.id, admin.id));
            logger.info(
                { msg: 'admin.mfa.activated', email: adminEmail },
                '[Admin MFA] MFA activated for admin',
            );
        }

        // 5. Re-issue JWT with mfa_verified: true claim
        const token = signAdminSessionToken({
            email: adminEmail,
            role: admin.role || 'admin',
            mfa_verified: true,
        });

        logger.info(
            { msg: 'admin.mfa.verified', email: adminEmail },
            '[Admin MFA] Code verified, elevated session issued',
        );

        return res.status(200).json({
            success: true,
            token,
            mfa_verified: true,
        });
    } catch (error) {
        logger.error({ err: error, msg: 'admin.mfa.verify_error' }, '[Admin MFA] Verification error');
        return res.status(500).json({ error: 'MFA verification failed' });
    }
}

export default requireAdminAuth(verifyHandler);
