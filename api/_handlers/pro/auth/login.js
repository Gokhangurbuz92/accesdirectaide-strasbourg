// @ts-nocheck
import logger from '../../../_utils/logger.js';
import { verifyPassword } from '../../../_utils/user-auth.js';
import jwt from 'jsonwebtoken';
import { signProToken, logProAudit } from '../../../_utils/auth.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../../_utils/rateLimit.js';
import { db } from '../../../../src/db/index.js';
import { eq, sql } from 'drizzle-orm';
import { env } from '../../../_utils/env.js';

/** A fixed scrypt hash (of a value nobody types) so that an unknown e-mail costs the same work as a real check. */
const DUMMY_HASH = 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128);
/**
 * @param {import('../../../_utils/http-types').ApiRequest} req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { password } = req.body;
    // R14: one address whatever its case (register stores it lower-cased; a capitalised « Marie@… » from a phone keyboard was « Invalid credentials »)
    const email = String(req.body?.email || '').trim().toLowerCase();
    const ip = getClientIp(req);

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
    }

    // Rate Limit — Dual-key: IP + Email (P2 Bouclier Anti-Brute-Force)
    // LOGIN_PRO: 5 attempts per 15 minutes (configured in rateLimit.js)
    const ipLimit = await checkRateLimit('LOGIN_PRO', `ip:${ip}`);
    if (!ipLimit.allowed) {
        res.setHeader('Retry-After', '900');
        return res.status(getRateLimitStatus(ipLimit)).json(
            ipLimit.error || { error: "Trop de tentatives de connexion. Veuillez patienter 15 minutes." }
        );
    }

    const emailLimit = await checkRateLimit('LOGIN_PRO', `email:${email}`);
    if (!emailLimit.allowed) {
        res.setHeader('Retry-After', '900');
        // @ts-ignore
        return res.status(getRateLimitStatus(emailLimit)).json(
            emailLimit.error || { error: "Trop de tentatives pour ce compte. Veuillez patienter 15 minutes." }
        );
    }

    try {
        // PKG-11 / PRO-11: the same e-mail may hold accounts in several organizations (one row per organization; whether that should stay possible is an
        // OPEN data-policy decision). The first row used to be taken whatever the password: the person could land in the wrong organization, or never reach
        // the other one. Every account of that e-mail is checked; the password decides; when it opens several, the person chooses the organization.
        const rows = await db.query.ProUser.findMany({ where: (u) => sql`lower(${u.email}) = ${email}`, limit: 10 });

        const authError = () => res.status(401).json({ error: "Invalid credentials" });

        if (!rows.length) {
            await verifyPassword(password, DUMMY_HASH).catch(() => false);   // same work as a real check (timing)
            await logProAudit('LOGIN_FAILED', 'unknown', 'unknown', { email, reason: 'User not found' }, ip);
            return authError();
        }

        const matching = [];
        for (const u of rows) if (await verifyPassword(password, u.password_hash)) matching.push(u);
        if (!matching.length) {
            await logProAudit('LOGIN_FAILED', rows[0].id, rows[0].structureId, { reason: 'Bad password', accounts: rows.length }, ip);
            return authError();
        }
        const wanted = String(req.body?.structureId || '');
        const targetUser = matching.length === 1 ? matching[0] : matching.find((u) => u.structureId === wanted);
        if (!targetUser) {
            const names = await db.query.Structure.findMany({ where: (s, { inArray }) => inArray(s.id, matching.map((u) => u.structureId)), columns: { id: true, nom: true } });
            return res.status(409).json({ code: 'ORGANIZATION_CHOICE_REQUIRED', message: 'Votre adresse ouvre un compte dans plusieurs organisations : choisissez celle à laquelle vous connecter.',
                organizations: matching.map((u) => ({ structureId: u.structureId, name: names.find((n) => n.id === u.structureId)?.nom || 'Organisation' })) });
        }

        if (targetUser.status !== 'active' && targetUser.status !== 'pending') {
            // If disabled — said only after the password matched (it used to be said for any password: an account-existence oracle)
            await logProAudit('LOGIN_FAILED', targetUser.id, targetUser.structureId, { reason: 'Account disabled' }, ip);
            return res.status(403).json({ error: "Account disabled" });
        }

        // --- MFA Challenge ---
        if (targetUser.mfa_enabled && targetUser.mfa_secret) {
            const jwtSecret = env.secrets.jwtSecret;
            if (!jwtSecret) {
                return res.status(500).json({ error: 'Server configuration error' });
            }

            // Issue a short-lived token that can ONLY be used for MFA verification
            const mfaToken = jwt.sign(
                {
                    userId: targetUser.id,
                    email: targetUser.email,
                    structureId: targetUser.structureId,
                    scope: 'mfa_pending',
                },
                jwtSecret,
                { expiresIn: '5m', algorithm: 'HS256' }
            );

            await logProAudit('MFA_CHALLENGE', targetUser.id, targetUser.structureId, {}, ip);

            return res.status(200).json({
                mfa_required: true,
                mfa_token: mfaToken,
            });
        }

        // --- Standard login (no MFA) ---
        const token = signProToken(targetUser);

        await logProAudit('LOGIN_SUCCESS', targetUser.id, targetUser.structureId, {}, ip);

        return res.status(200).json({
            token,
            user: {
                id: targetUser.id,
                email: targetUser.email,
                role: targetUser.role,
                structureId: targetUser.structureId
            }
        });

    } catch (e) {
        logger.error("Login error", e);
        return res.status(500).json({ error: "Login failed" });
    }
}

