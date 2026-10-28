// @ts-nocheck
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { Actualite, AuditLog } from '../../../src/db/schema.js';
import { and, inArray, sql } from 'drizzle-orm';
import { getAuthenticatedUser, verifyAdmin } from '../../_utils/auth.js';
import { adminBulkActionSchema } from '../../../src/db/drizzle-schemas.js';
/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit('ADMIN_API', ip);
    if (!rateLimit.allowed) {
        return res.status(getRateLimitStatus(rateLimit)).json(rateLimit.error);
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!(await verifyAdmin(req))) {
        return res.status(401).json({ error: 'Unauthorized: Admin Token Required' });
    }

    const parseResult = adminBulkActionSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid payload', details: parseResult.error.flatten() });
    }

    const { action, ids } = parseResult.data;
    // launch-readiness item 65: publishing or rejecting an actualité is a decision with a stated reason (journalised with the named administrator)
    const reason = String(parseResult.data.reason || '').trim();
    if (['PUBLISH', 'REJECT'].includes(action) && reason.length < 10) {
        return res.status(400).json({ error: 'REASON_REQUIRED', message: 'Indiquez le motif de la décision (10 caractères au moins).' });
    }

    try {
        let updateData = {};

        switch (action) {
            case 'PUBLISH':
                // PKG-11 / P10: 'publie' is the status the public feed shows (the former 'actif' made a moderated item invisible everywhere)
                updateData = {
                    statut: 'publie',
                    published_at: new Date()
                };
                break;
            case 'REJECT':
                updateData = {
                    statut: 'rejected'
                };
                break;
            case 'RETRY_FALC':
                updateData = {
                    falc_status: 'pending' // Pipeline will pick it up
                };
                break;
            default:
                return res.status(400).json({ error: 'Invalid Action' });
        }

        // only an item that links to its source over https can be published
        const where = action === 'PUBLISH' ? and(inArray(Actualite.id, ids), sql`coalesce(${Actualite.lien_url}, ${Actualite.canonical_url}) LIKE 'https://%'`) : inArray(Actualite.id, ids);
        const updated = await db.update(Actualite).set(updateData).where(where).returning({ id: Actualite.id });
        const count = updated.length;

        // Audit Log: the named administrator who decided
        const actor = await getAuthenticatedUser(req).catch(() => null);
        await db.insert(AuditLog).values({
            action: `ADMIN_BULK_${action}`,
            actor: actor?.email || null,
            entity: 'Actualite',
            details: { count, ids, applied: updated.map((u) => u.id), ...(reason ? { reason } : {}) },
            timestamp: new Date()
        });

        return res.status(200).json({ success: true, count });

    } catch (error) {
        logger.error('Admin Action Error:', error);
        return res.status(500).json({ error: 'Database Error' });
    }
}
