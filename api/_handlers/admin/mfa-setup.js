import { generateSecret, generateURI } from 'otplib';
import { db } from '../../../src/db/index.js';
import { AdminUser } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { encryptToken, isVaultReady } from '../../_utils/vault.js';
import logger from '../../_utils/logger.js';
import { requireAdminAuth } from '../../_utils/auth.js';

/**
 * POST /api/admin/mfa-setup
 *
 * Generates a unique TOTP secret for an administrator.
 * The secret is encrypted at rest using AES-256-GCM (vault.js).
 *
 * Flow:
 * 1. Admin authenticates with existing token/JWT
 * 2. Server generates TOTP secret
 * 3. Secret encrypted with vault before DB storage
 * 4. Returns otpauth:// URI for QR code scanning
 * 5. MFA not active until first code verification
 */
async function setupHandler(/** @type {import('../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') return res.status(405).end();

    // Vault must be ready (OUTLOOK_TOKEN_ENCRYPTION_KEY set)
    if (!isVaultReady()) {
        logger.error({ msg: 'admin.mfa.vault_not_ready' }, '[Admin MFA] Vault not configured');
        return res.status(500).json({ error: 'Encryption service unavailable' });
    }

    const adminEmail = req.auth?.email;
    if (!adminEmail) {
        return res.status(401).json({ error: 'Admin identity not found' });
    }

    try {
        // 1. Find AdminUser by email
        const admin = await db.query.AdminUser.findFirst({ where: eq(AdminUser.email, adminEmail) });
        if (!admin) {
            return res.status(404).json({ error: 'Admin account not found' });
        }

        // 2. Check if MFA already enabled
        if (admin.mfaEnabled) {
            return res.status(409).json({
                error: 'MFA already active. Disable first to reconfigure.',
                mfaEnabled: true,
            });
        }

        // 3. Generate highly entropic TOTP secret
        const secret = generateSecret();

        // 4. Encrypt for the Vault (AES-256-GCM)
        const encrypted = encryptToken(secret);

        // 5. Persist encrypted secret in DB
        await db.update(AdminUser).set({
                mfaSecret: encrypted.content,
                mfaIv: encrypted.iv,
                mfaEnabled: false, // Not active until first verification
        }).where(eq(AdminUser.id, admin.id));

        // 6. Generate Provisioning URI for authenticator apps
        const otpauth = generateURI({
            label: adminEmail,
            issuer: 'AccesDirectAide Admin',
            secret,
        });

        logger.info({ msg: 'admin.mfa.setup', email: adminEmail }, '[Admin MFA] Setup initiated');

        return res.status(200).json({
            otpauth,
            step: 'VERIFY_REQUIRED',
        });
    } catch (error) {
        logger.error({ err: error, msg: 'admin.mfa.setup_failed' }, '[Admin MFA] Setup failed');
        return res.status(500).json({ error: 'MFA setup failed' });
    }
}

export default requireAdminAuth(setupHandler);
