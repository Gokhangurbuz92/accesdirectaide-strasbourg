import { resolveAuthContext } from '../../_utils/auth.js';
import { env } from '../../_utils/env.js';
import { db } from '../../../src/db/index.js';
import { CitizenUser } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { citizenSessionRevoked, getUserSessionTokenFromRequest, verifyUserSessionToken } from '../../_utils/user-auth.js';
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
            role: 'user',
            authType: 'user_cookie',
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
