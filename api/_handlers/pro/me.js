import logger from '../../_utils/logger.js';
import { requireProAuth, requireProStructureContext } from '../../_utils/auth.js';
import { db } from '../../../src/db/index.js';
import { ProUser } from '../../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';
/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const proCtx = requireProStructureContext(req, res);
        if (!proCtx) return;

        const user = await db.query.ProUser.findFirst({
            where: and(
                eq(ProUser.id, proCtx.userId),
                eq(ProUser.structureId, proCtx.structureId)
            ),
            with: { structure: true }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // PKG-11 audit: an explicit allow-list — the former copy minus password_hash still sent mfa_secret (the TOTP seed) to the browser
        const safeUser = { id: user.id, email: user.email, role: user.role, status: user.status, structureId: user.structureId, notificationEmailEnabled: user.notificationEmailEnabled,
            notificationPrefs: user.notificationPrefs, mfa_enabled: user.mfa_enabled, createdAt: user.createdAt, updatedAt: user.updatedAt, structure: user.structure };

        return res.status(200).json({
            user: safeUser,
            structure: user.structure
        });

    } catch (e) {
        logger.error({ err: e }, "Me API Error");
        return res.status(500).json({ error: "Internal server error" });
    }
}

export default requireProAuth(handler);
