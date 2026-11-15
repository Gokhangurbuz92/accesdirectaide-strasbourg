import { resolveAuthContext } from '../../_utils/auth.js';
import { env } from '../../_utils/env.js';
import { db } from '../../../src/db/index.js';
import { CitizenProfile, CitizenUser } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { citizenSessionRevoked, getUserSessionTokenFromRequest, verifyUserSessionToken } from '../../_utils/user-auth.js';
import { capabilityOpen } from '../../_utils/capabilities.js';
import { isPublicBetaRestricted, openSurfaces } from '../../_utils/public-beta.js';
import { phoneCollectionOpen } from '../../_utils/phone-collection.js';

/**
 * G-3 (07/11/2026): this route is not gated by a capability as a whole (api/_utils/capabilities.js « auth/me »: []); each session kind is answered only
 * when its own surface is served, otherwise it reads as « not signed in » (401, nothing read from the database):
 *   administrator session → the « admin » surface (during the restricted beta: ADA_BETA_OPEN_SURFACES names it)
 *   professional session  → the capability pro.account (« pro » surface)
 *   citizen session       → the capability citizen.account (« accounts » surface; closing it signs citizen sessions out, R47 F1)
 */
const adminSurfaceServed = () => !isPublicBetaRestricted() || openSurfaces().has('admin');
const UNAUTHORIZED = { error: 'Unauthorized' };
/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const auth = await resolveAuthContext(req);
    if (auth) {
        if (auth.authType === 'pro_jwt') {
            if (!capabilityOpen('pro.account')) return res.status(401).json(UNAUTHORIZED);
            return res.status(200).json({
                session: {
                    kind: 'pro',
                    authType: auth.authType,
                    role: auth.role,
                },
                user: {
                    id: auth.userId || null,
                    email: auth.email || null,
                    role: auth.role,
                    structureId: auth.structureId || null,
                    authType: auth.authType,
                },
            });
        }

        if (!adminSurfaceServed()) return res.status(401).json(UNAUTHORIZED);
        return res.status(200).json({
            session: {
                kind: 'admin',
                authType: auth.authType,
                role: auth.role,
            },
            user: {
                id: 'admin',
                email: auth.email || env.secrets.adminEmail || 'admin@accesdirectaide.fr',
                role: auth.role,
                authType: auth.authType,
            },
        });
    }

    if (!capabilityOpen('citizen.account')) return res.status(401).json(UNAUTHORIZED);   // citizen accounts closed: no citizen session is recognised
    const sessionToken = getUserSessionTokenFromRequest(req);
    const userClaims = verifyUserSessionToken(sessionToken);
    if (!userClaims) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await db.query.CitizenUser.findFirst({
        where: eq(CitizenUser.id, userClaims.userId),
        columns: {
            id: true,
            email: true,
            emailVerifiedAt: true,
            phone: true,
            createdAt: true,
            sessionsValidAfter: true,
        },
    });
    if (!user || !user.emailVerifiedAt || normalizeEmail(user.email) !== normalizeEmail(userClaims.email) || citizenSessionRevoked(userClaims.iat, user.sessionsValidAfter, userClaims.iatMs)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // A-23: the account's stored interface language, so the application can apply it once at session start (before: only the profile page did).
    // A failed read is not a sign-in failure: the language is then simply not applied.
    const preferredLanguage = await db.select({ lang: CitizenProfile.preferredLanguage }).from(CitizenProfile).where(eq(CitizenProfile.userId, user.id)).limit(1)
        .then((rows) => rows[0]?.lang || null).catch(() => null);

    return res.status(200).json({
        session: {
            kind: 'user',
            authType: 'user_cookie',
            role: 'user',
        },
        user: {
            id: user.id,
            email: user.email,
            phone: user.phone || null,
            createdAt: user.createdAt || null,
            emailVerifiedAt: user.emailVerifiedAt || null,
            emailVerified: true,
            preferredLanguage,
            role: 'user',
            authType: 'user_cookie',
            phoneCollection: phoneCollectionOpen(),   // Release B: the settings screen offers the phone field only when its collection is open
        },
    });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}
