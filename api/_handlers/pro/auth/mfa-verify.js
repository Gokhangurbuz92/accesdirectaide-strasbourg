import logger from '../../../_utils/logger.js';
import { db } from '../../../../src/db/index.js';
import { eq } from 'drizzle-orm';
import { signProToken, logProAudit, verifyProMfaPendingToken } from '../../../_utils/auth.js';
import { checkRateLimit, getClientIp } from '../../../_utils/rateLimit.js';
import { matchCodeStep } from '../../../lib/totp.js';
import { claimProStep, openMfaSecret } from '../../../_utils/totp-guard.js';
import { env } from '../../../_utils/env.js';

/**
 * MFA Verify handler — second step of MFA login
 *
 * POST /api/pro/auth/mfa-verify
 * Body: { mfa_token: string, code: string }
 *
 * The mfa_token is a short-lived JWT (5min) issued by login.js
 * when the user has MFA enabled. This handler verifies the TOTP
 * code and issues the real pro JWT on success.
 *
 * R40: the pending token is checked with its issuer and audience (signProMfaPendingToken); codes are limited per address, per ACCOUNT (shared with
 * enrolment, 5 per 15 min) and per pending token (3), so rotating addresses or re-using one token does not multiply the guesses.
 */
export default async function handler(/** @type {import('../../../_utils/http-types').ApiRequest} */ req, /** @type {import('../../../_utils/http-types').ApiResponse} */ res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { mfa_token, code } = req.body || {};
    const ip = getClientIp(req);

    if (!mfa_token || !code) {
        return res.status(400).json({ error: 'mfa_token and code are required' });
    }

    if (String(code).length !== 6) {
        return res.status(400).json({ error: 'Code must be 6 digits' });
    }

    // Rate limit by IP
    const limit = await checkRateLimit('MFA_VERIFY_PRO', `ip:${ip}`);
    if (!limit.allowed) {
        return res.status(429).json(limit.error || { error: 'Too many attempts. Try again later.' });
    }

    try {
        // Verify the temporary MFA token
        const jwtSecret = env.secrets.jwtSecret;
        if (!jwtSecret) {
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const payload = verifyProMfaPendingToken(mfa_token);
        if (!payload) {
            return res.status(401).json({ error: 'MFA token expired or invalid. Please login again.' });
        }

        for (const [action, key] of [['MFA_VERIFY_PRO_TOKEN', `jti:${payload.jti}`], ['MFA_VERIFY_PRO_USER', `user:${payload.userId}`]]) {
            const scoped = await checkRateLimit(action, key);
            if (!scoped.allowed) {
                if (action === 'MFA_VERIFY_PRO_USER') await logProAudit('MFA_LOCKED', payload.userId, null, {}, ip);
                return res.status(429).json(scoped.error || { error: 'Too many attempts. Try again later.' });
            }
        }

        // Load user with MFA secret
        const user = await db.query.ProUser.findFirst({
            where: (u, { eq }) => eq(u.id, payload.userId),
        });

        if (!user || !user.mfa_enabled || !user.mfa_secret) {
            return res.status(401).json({ error: 'MFA not configured for this account' });
        }

        // Verify the TOTP code — once: its time step is claimed (RFC 6238 §5.2); the seed may be sealed (api/_utils/totp-guard.js)
        const step = matchCodeStep(openMfaSecret(user.mfa_secret) || '', String(code));
        const valid = step !== null && await claimProStep(db, user.id, step);
        if (!valid) {
            await logProAudit('MFA_VERIFY_FAILED', user.id, user.structureId, { reason: 'Bad code' }, ip);
            return res.status(401).json({ error: 'Invalid verification code' });
        }

        // Issue the real pro token — it records that the second factor was passed (R34: required for ADA Pro routes in production)
        const token = signProToken(user, { mfa: true });

        await logProAudit('LOGIN_SUCCESS', user.id, user.structureId, { mfa: true }, ip);

        return res.status(200).json({
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                structureId: user.structureId,
            },
        });
    } catch (e) {
        logger.error({ err: e }, 'MFA verify error');
        return res.status(500).json({ error: 'MFA verification failed' });
    }
}
