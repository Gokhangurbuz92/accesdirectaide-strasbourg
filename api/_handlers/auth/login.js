// @ts-nocheck
import logger from '../../_utils/logger.js';
import { env } from '../../_utils/env.js';
import { signAdminSessionToken } from '../../_utils/auth.js';
import { db } from '../../../src/db/index.js';
import { AdminUser, CitizenUser } from '../../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
import { checkRateLimit, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { validate } from '../../_utils/validate.js';
import { loginSchema } from '../../_utils/schemas.js';
import {
    buildUserSessionCookie,
    getClientIp,
    isValidEmail,
    normalizeEmail,
    verifyPassword,
    hashPassword,
    isUnsetPassword,
    signUserSessionToken,
} from '../../_utils/user-auth.js';

// PKG-11 audit (enumeration): an unknown address, a wrong password and a locked account all get the SAME answer, after the same password work — before,
// an unknown address answered at once and a known one answered 423 « locked » on the 6th try, which told anyone whether an account existed.
// PKG-11 audit pass 2 / R2-7: ONE answer for unknown, wrong, locked AND not-yet-verified (correct password): the former 403 EMAIL_NOT_VERIFIED for a correct
// password told whoever had just signed up with someone's address that no account existed for it before (sign-up + log-in = an existence oracle). The hint
// for a person who has not confirmed their address yet is part of the same answer for everyone.
const INVALID = { error: 'Invalid credentials', message: 'Adresse ou mot de passe incorrect, ou adresse pas encore confirmée (utilisez le lien reçu par e-mail, ou demandez-en un nouveau). Après 5 essais, la connexion est suspendue 15 minutes.' };
let dummyHash = null;
const dummyCheck = async (password) => { try { dummyHash = dummyHash || (await hashPassword('timing-equaliser-not-a-password')); await verifyPassword(password, dummyHash); } catch { /* timing only */ } };

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function loginHandler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const ip = getClientIp(req);
    const ipLimit = await checkRateLimit('LOGIN_USER', `ip:${ip}`);
    if (!ipLimit.allowed) {
        return res.status(getRateLimitStatus(ipLimit)).json(ipLimit.error || { error: 'Too many attempts' });
    }

    // PKG-5 / A01: production never hands the static ADMIN_TOKEN to a browser (and verifyAdmin refuses it there) — admin sessions are signed JWTs + MFA.
    const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
    const authMode = isProduction ? 'jwt' : String(env.auth.mode || 'token').toLowerCase();
    const email = normalizeEmail(req.validatedBody?.email || req.body?.email);
    const password = String(req.validatedBody?.password || req.body?.password || '');
    const mode = String(req.validatedBody?.mode || req.body?.mode || '').trim().toLowerCase();

    // Administrator credentials from the environment: a LOCAL / TEST convenience only. Production (NODE_ENV or VERCEL_ENV production — Vercel previews
    // included) knows only its NAMED administrators (POST /api/admin/login: password hash in AdminUser, then MFA; first account through
    // scripts/admin-bootstrap.mjs): no default address, no password in the environment, no plain-text comparison.
    const envAdminAllowed = !isProduction;
    const validEmail = envAdminAllowed ? (env.secrets.adminEmail || 'admin@accesdirectaide.fr') : null;
    const adminPasswordHash = envAdminAllowed ? env.secrets.adminPasswordHash : null; // scrypt:salt:key format
    const adminPasswordLegacy = envAdminAllowed ? env.secrets.adminPassword : null;   // plain text fallback (deprecated; never in production)

    const wantsAdminMode = mode === 'admin';

    // Determine admin credential validity
    let adminCredentialsValid = false;
    if (validEmail && email === validEmail && password) {
        if (adminPasswordHash) {
            // ✅ Secure mode: scrypt hash comparison with timingSafeEqual
            adminCredentialsValid = await verifyPassword(password, adminPasswordHash);
        } else if (adminPasswordLegacy) {
            // ⚠️ Legacy mode: plain text comparison (log warning)
            console.warn('[SECURITY] Admin login using plain-text ADMIN_PASSWORD. Migrate to ADMIN_PASSWORD_HASH (run: node scripts/hash-admin-password.mjs)');
            adminCredentialsValid = password === adminPasswordLegacy;
        }
    }

    if (adminCredentialsValid) {
        // Check if MFA is enabled for this admin
        let adminUser = null;
        try {
            adminUser = await db.query.AdminUser.findFirst({ where: eq(AdminUser.email, email) });
        } catch {
            // If DB unavailable, fall through to token-based auth
        }

        let token = '';

        if (authMode === 'jwt') {
            try {
                // Issue JWT WITHOUT mfa_verified — MFA step required separately
                token = signAdminSessionToken({ email, role: 'admin', mfa_verified: false });
            } catch {
                return res.status(500).json({ error: 'Server misconfiguration: AUTH_SECRET missing for jwt mode' });
            }
        } else {
            token = env.secrets.adminToken || '';
            if (!token) {
                return res.status(500).json({ error: 'Server misconfiguration: ADMIN_TOKEN missing' });
            }
        }

        // If MFA is enabled, return partial auth — client must complete MFA
        if (adminUser?.mfaEnabled) {
            return res.status(200).json({
                success: true,
                token, // Pre-MFA token (no mfa_verified claim)
                authMode,
                mfa_required: true,
                step: 'MFA_VERIFY',
                user: { email, role: 'admin' },
            });
        }

        return res.status(200).json({
            success: true,
            token,
            authMode,
            user: { email, role: 'admin' }
        });
    }

    if (wantsAdminMode) {
        // production: the administrator surface is /admin/login (named accounts with MFA); this route never signs an administrator in there
        if (!envAdminAllowed) return res.status(401).json({ error: 'Invalid credentials', message: 'La connexion administrateur se fait sur /admin/login.' });
        if (!(adminPasswordHash || adminPasswordLegacy)) {
            return res.status(500).json({ error: 'Server misconfiguration: ADMIN_PASSWORD missing' });
        }
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!isValidEmail(email) || !password) {
        return res.status(400).json({ error: 'Invalid input' });
    }

    const emailLimit = await checkRateLimit('LOGIN_USER', `email:${email}`);
    if (!emailLimit.allowed) {
        // @ts-ignore
        return res.status(getRateLimitStatus(emailLimit)).json(emailLimit.error || { error: 'Too many attempts' });
    }

    try {
        const user = await db.query.CitizenUser.findFirst({
            where: eq(CitizenUser.email, email),
        });

        if (!user) {
            await dummyCheck(password);
            return res.status(401).json(INVALID);
        }

        // Check if account is locked out (same answer as a wrong password)
        if (user.lockoutUntil && new Date(user.lockoutUntil) > new Date()) {
            await dummyCheck(password);
            return res.status(401).json(INVALID);
        }

        // PKG-11 audit pass 2: a password nobody chose yet never matches (same work as a real check)
        const passwordOk = isUnsetPassword(user.passwordHash) ? (await dummyCheck(password), false) : await verifyPassword(password, user.passwordHash);
        if (!passwordOk) {
            // R12 / Q11: one atomic increment in the database (a read-then-write let two instances count two failures as one, and delay the lockout)
            const [after] = await db.update(CitizenUser)
                // R12 (C01): a lockout that has run out starts a fresh count (before, the count stayed at 5 and ONE wrong password re-locked the account)
                .set({
                    failedLoginAttempts: sql`CASE WHEN ${CitizenUser.lockoutUntil} IS NOT NULL AND ${CitizenUser.lockoutUntil} <= NOW() THEN 1 ELSE COALESCE(${CitizenUser.failedLoginAttempts}, 0) + 1 END`,
                    lockoutUntil: sql`CASE WHEN ${CitizenUser.lockoutUntil} <= NOW() THEN NULL ELSE ${CitizenUser.lockoutUntil} END`,
                })
                .where(eq(CitizenUser.id, user.id))
                .returning({ n: CitizenUser.failedLoginAttempts });
            if ((after?.n || 0) >= MAX_FAILED_ATTEMPTS) {
                await db.update(CitizenUser).set({ lockoutUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) }).where(eq(CitizenUser.id, user.id));
            }

            return res.status(401).json(INVALID);
        }

        if (!user.emailVerifiedAt) {
            return res.status(401).json(INVALID);   // R2-7: still no session before verification, with the same answer as any refusal
        }

        // Reset failed attempts on successful login; launch-readiness item 62: the last sign-in is recorded (the inactivity of an account is measured from it —
        // a retention REPORT only, nothing is deleted on that basis)
        const mustReset = user.failedLoginAttempts > 0 || Boolean(user.lockoutUntil);
        try {
            await db.update(CitizenUser)
                .set({ failedLoginAttempts: 0, lockoutUntil: null, lastSeenAt: new Date() })
                .where(eq(CitizenUser.id, user.id));
        } catch (e) {
            if (mustReset) throw e;   // the lockout reset must happen; the measurement alone never blocks a sign-in
        }

        const sessionToken = signUserSessionToken({
            userId: user.id,
            email: user.email,
        });
        res.setHeader('Set-Cookie', buildUserSessionCookie(sessionToken));

        return res.status(200).json({
            success: true,
            session: {
                kind: 'user',
                authType: 'user_cookie',
                role: 'user',
            },
            user: {
                id: user.id,
                role: 'user',
            },
        });
    } catch (err) {
        logger.error({ err }, '[login] Authentication failed');
        return res.status(500).json({ error: 'Erreur interne du serveur' });
    }
}

export default validate(loginSchema, loginHandler);
