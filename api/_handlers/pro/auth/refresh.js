// @ts-nocheck
import logger from '../../../_utils/logger.js';
import jwt from 'jsonwebtoken';
import { signProToken, verifyProToken, logProAudit, currentProMembership, PRO_SESSION_STATUSES, proSessionRevoked } from '../../../_utils/auth.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../../_utils/rateLimit.js';
import { env } from '../../../_utils/env.js';

/**
 * POST /api/pro/auth/refresh
 *
 * Renouvelle le jeton de session JWT si le jeton actuel est valide
 * ou récemment expiré (grâce de 1h max).
 *
 * Garantit la continuité de service pour les agents Pro (Requirement H).
 *
 * @param {import('../../../_utils/http-types').ApiRequest} req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const ip = getClientIp(req);

    // Rate Limit — REFRESH_PRO: 10 per 15 min
    const limit = await checkRateLimit('REFRESH_PRO', `ip:${ip}`);
    if (!limit.allowed) {
        res.setHeader('Retry-After', '900');
        return res.status(getRateLimitStatus(limit)).json(
            limit.error || { error: 'Trop de tentatives de rafraîchissement.' }
        );
    }

    // Extract Bearer token
    const authHeader = req.headers?.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return res.status(401).json({ error: 'Token manquant' });
    }
    const token = match[1];

    const jwtSecret = env.secrets.jwtSecret;
    if (!jwtSecret) {
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        // 1. Try standard verification first (token still valid)
        const validClaims = verifyProToken(token);
        if (validClaims) {
            // PKG-4 / D1: a refresh is re-checked against the database (status, structure, current role) — a disabled or demoted user cannot extend a session
            const m = await currentProMembership(validClaims.userId);
            if (!m || !PRO_SESSION_STATUSES.includes(m.status) || m.structureId !== String(validClaims.structureId || '')) {
                return res.status(401).json({ error: 'Session invalide. Veuillez vous reconnecter.', code: 'MEMBERSHIP_CHANGED' });
            }
            // PKG-11 audit: a session ended by logout or password reset cannot be extended
            if (proSessionRevoked(validClaims.iat, m)) return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.', code: 'SESSION_REVOKED' });
            const newToken = signProToken({
                id: validClaims.userId,
                email: validClaims.email,
                structureId: validClaims.structureId,
                role: m.role,
            }, { mfa: validClaims.mfa === true });   // R34: a refresh keeps, never adds, the second factor

            await logProAudit('TOKEN_REFRESH', validClaims.userId, validClaims.structureId, { method: 'valid' }, ip);

            return res.status(200).json({
                success: true,
                token: newToken,
            });
        }

        // 2. Token might be expired — try with ignoreExpiration (1h grace)
        let decoded;
        try {
            // PKG-11 audit: the grace path checks the same issuer / audience as a live pro session (before: any HS256 token signed with the secret qualified)
            decoded = jwt.verify(token, jwtSecret, {
                algorithms: ['HS256'],
                ignoreExpiration: true,
                issuer: 'accesdirectaide',
                audience: 'accesdirectaide-pro',
            });
        } catch {
            return res.status(401).json({ error: 'Token invalide' });
        }

        if (!decoded || typeof decoded !== 'object') {
            return res.status(401).json({ error: 'Token invalide' });
        }

        // 3. Check expiration grace period (max 1 hour after expiry)
        const MAX_GRACE_SECONDS = 3600; // 1 hour
        const now = Math.floor(Date.now() / 1000);
        const expiredAt = decoded.exp || 0;

        if (now - expiredAt > MAX_GRACE_SECONDS) {
            return res.status(401).json({
                error: 'Session expirée depuis trop longtemps. Veuillez vous reconnecter.',
                code: 'TOKEN_EXPIRED_BEYOND_GRACE',
            });
        }

        // 4. Validate pro claims from expired token
        const userId = String(decoded.userId || '').trim();
        const structureId = String(decoded.structureId || '').trim();
        const role = String(decoded.role || '').toUpperCase();
        const scope = String(decoded.scope || '');

        if (!userId || !structureId) {
            return res.status(401).json({ error: 'Claims invalides' });
        }

        if (scope && scope !== 'pro') {
            return res.status(401).json({ error: 'Token scope invalide' });
        }

        // 5. PKG-4 / D1: re-checked against the database (the expired token's role is NOT trusted)
        const m = await currentProMembership(userId);
        if (!m || !PRO_SESSION_STATUSES.includes(m.status) || m.structureId !== structureId) {
            return res.status(401).json({ error: 'Session invalide. Veuillez vous reconnecter.', code: 'MEMBERSHIP_CHANGED' });
        }
        if (proSessionRevoked(typeof decoded.iat === 'number' ? decoded.iat : undefined, m)) return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.', code: 'SESSION_REVOKED' });
        void role;
        const newToken = signProToken({
            id: userId,
            email: typeof decoded.email === 'string' ? decoded.email : undefined,
            structureId,
            role: m.role,
        }, { mfa: decoded.mfa === true });   // R34: a refresh keeps, never adds, the second factor

        await logProAudit('TOKEN_REFRESH', userId, structureId, { method: 'grace_period' }, ip);

        logger.info({ msg: 'pro.auth.refresh', userId, method: 'grace_period' }, '[Pro Auth] Token refreshed within grace period');

        return res.status(200).json({
            success: true,
            token: newToken,
        });
    } catch (error) {
        logger.error({ err: error, msg: 'pro.auth.refresh_error' }, '[Pro Auth] Refresh failed');
        return res.status(401).json({ error: 'Rafraîchissement échoué' });
    }
}
