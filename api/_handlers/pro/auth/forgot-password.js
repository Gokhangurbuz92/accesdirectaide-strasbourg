import logger from '../../../_utils/logger.js';
import { kv } from '../../../_utils/kv.js';
import crypto from 'crypto';
import { checkRateLimit } from '../../../_utils/rateLimit.js';
import { logProAudit } from '../../../_utils/auth.js';
import { db } from '../../../../src/db/index.js';
import { sql } from 'drizzle-orm';
import { env } from '../../../_utils/env.js';
import { sendMail, getMailerStatus } from '../../../_utils/mailer.js';
import { templates } from '../../../lib/email-service.js';
import { clientIp } from '../../../_utils/client-ip.js';
/**
 * @param {import('../../../_utils/http-types').ApiRequest} req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { email } = req.body;
    const ip = clientIp(req);

    if (!email) {
        return res.status(400).json({ error: "Email required" });
    }

    // Rate Limit
    const limit = await checkRateLimit('RESET_PASSWORD', `ip:${ip}`);
    if (!limit.allowed) {
        return res.status(429).json(limit.error);
    }

    try {
        const normalized = String(email).trim().toLowerCase();
        // PKG-11 / PRO-11: every ACTIVE account of that e-mail (one per organization) gets its OWN link, named after its organization — the first row used to
        // be the only one, so the person could never reset the account of their other organization (and could reset the wrong one)
        const users = /** @type {Array<{ id: string, email: string, status: string, structureId: string, nom: string | null }>} */ ((await db.execute(sql`SELECT u.id, u.email, u.status, u."structureId", s.nom
          FROM "ProUser" u LEFT JOIN "Structure" s ON s.id = u."structureId" WHERE lower(u.email) = ${normalized} AND u.status IN ('active', 'pending') ORDER BY u."createdAt" LIMIT 5`)).rows);

        // Same answer whether or not an account exists (no enumeration); a disabled account never receives a reset link
        for (const user of users) {
            // PKG-11 audit: before, the link was only LOGGED (« [MOCK EMAIL] ») and never sent, while the person was told it had been sent. Now: a real
            // e-mail through the configured provider (honest delivery status in the mail ledger), and the token is stored HASHED (the raw value exists
            // only in the e-mail), single use, 1 hour.
            const token = crypto.randomBytes(32).toString('hex');
            const key = `reset:pro:${crypto.createHash('sha256').update(token).digest('hex')}`;
            await kv.set(key, { userId: user.id }, { ex: 3600 });

            const baseUrl = env.runtime.appBaseUrl || 'http://localhost:3000';
            const resetLink = `${baseUrl}/pro/reset-password?token=${encodeURIComponent(token)}`;
            const t = templates.resetPassword(user.email.split('@')[0], resetLink, '1 heure');   // the professional link lives 1 hour (KV ex 3600)
            const org = users.length > 1 ? ` — compte de l'organisation « ${String(user.nom || 'Organisation').replace(/[\r\n]+/g, ' ')} »` : '';
            await sendMail({ to: user.email, subject: `${t.subject}${org}`, text: `Lien de réinitialisation (valable 1 heure)${org} : ${resetLink}`, html: t.html, category: 'password_reset' });

            await logProAudit('RESET_REQUESTED', user.id, user.structureId, { accounts: users.length }, ip);
        }

        // R12 (C01): « a link was sent » only when this service can send e-mail at all (configuration only: the same answer for every address)
        return res.status(200).json(getMailerStatus().deliverable ? { message: "Si cet email existe, un lien a été envoyé.", emailDelivery: 'SENT_IF_VALID' }
            : { message: "L’envoi d’e-mails n’est pas disponible sur ce service pour le moment : aucun lien n’a pu être envoyé. Réessayez plus tard.", emailDelivery: 'UNAVAILABLE' });

    } catch (e) {
        logger.error({ err: e }, "Forgot Password Error");
        return res.status(500).json({ error: "Internal Error" });
    }
}
