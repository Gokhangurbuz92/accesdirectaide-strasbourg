import logger from '../../../_utils/logger.js';
import { passwordMessage, passwordProblems } from '../../../../src/lib/passwordPolicy.js';
import { kv } from '../../../_utils/kv.js';
import { hashPassword } from '../../../_utils/user-auth.js';
import { checkRateLimit } from '../../../_utils/rateLimit.js';
import { logProAudit } from '../../../_utils/auth.js';
import crypto from 'node:crypto';
import { db } from '../../../../src/db/index.js';
import { ProUser } from '../../../../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { clientIp } from '../../../_utils/client-ip.js';
/**
 * @param {import('../../../_utils/http-types').ApiRequest} req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { token, password } = req.body;
    const ip = clientIp(req);

    if (!token || !password) {
        return res.status(400).json({ error: "Missing fields" });
    }

    // R21: the shared password rule (src/lib/passwordPolicy.js), as for the citizen reset
    const pwProblems = passwordProblems(password);
    if (pwProblems.length) {
        return res.status(400).json({ error: passwordMessage(pwProblems) });
    }

    // Rate Limit
    const limit = await checkRateLimit('RESET_PASSWORD', `ip:${ip}`);
    if (!limit.allowed) {
        return res.status(429).json(limit.error);
    }

    try {
        const key = `reset:pro:${crypto.createHash('sha256').update(String(token)).digest('hex')}`;
        const data = await kv.get(key);

        if (!data || !(await kv.del(key))) {   // claimed atomically: a second submission of the same link finds nothing to delete
            return res.status(400).json({ error: "Lien invalide ou expiré." });
        }

        const { userId } = data;

        // R12 (C02): the password and the end of every existing session are ONE update (PKG-11 audit: a stolen session does not survive the reset); if it
        // fails, the claimed link is put back for its remaining hour at most, so a failed write does not burn the person's link
        let user;
        try {
            const hashedPassword = await hashPassword(password);
            [user] = await db.update(ProUser).set({
                password_hash: hashedPassword, sessionsValidAfter: sql`NOW()`,
            }).where(eq(ProUser.id, userId)).returning();
        } catch (e) {
            await kv.set(key, data, { ex: 3600 }).catch(() => {});
            throw e;
        }
        if (!user) return res.status(400).json({ error: "Lien invalide ou expiré." });

        await logProAudit('RESET_SUCCESS', user.id, user.structureId, {}, ip);

        return res.status(200).json({ message: "Mot de passe modifié avec succès." });

    } catch (e) {
        logger.error({ err: e }, "Reset Password Error");
        return res.status(500).json({ error: "Internal Error" });
    }
}
