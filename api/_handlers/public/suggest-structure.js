import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { PartnershipRequest } from '../../../src/db/schema.js';
import crypto from 'crypto';

import { checkRateLimit, getClientIp, getRateLimitStatus } from '../../_utils/rateLimit.js';
import { isFeatureOn } from '../../_services/feature-flags.js';
/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { structureName, city, type, website, email, message, consent, honeypot } = req.body || {};

    // Honeypot Check
    if (honeypot) {
        // Silently fail (pretend success)
        return res.status(200).json({ success: true, message: "Request received" });
    }

    // Basic Validation
    // owner usefulness pass (2026-10-25): the same required fields as the validation schema (name, city, explicit consent); website and e-mail are optional
    // there and were required here, so a structure without a website could not be proposed
    if (!structureName || !city || consent !== true) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Indiquez le nom de la structure, sa ville, et cochez la case d’accord.' });
    }

    // PKG-5 / P19: shared abuse limit (KV-backed, fail-closed in production) instead of a per-instance memory map, and the administrator kill switch (after the cheap checks: nothing is read before an invalid request is refused)
    if (!(await isFeatureOn('PUBLIC_FEEDBACK'))) return res.status(503).json({ error: 'FEATURE_DISABLED', message: 'Les suggestions sont momentanément fermées.' });
    const rl = await checkRateLimit('FEEDBACK', `suggest:${getClientIp(req)}`);
    if (!rl.allowed) return res.status(getRateLimitStatus(/** @type {any} */ (rl))).json(rl.error || { error: 'Too many requests' });


    try {
        const ipHash = crypto.createHash('sha256').update(String(getClientIp(req))).digest('hex');

        const [request] = await db.insert(PartnershipRequest).values({
                structureName,
                city,
                type,
                website,
                email,
                message,
                consent: Boolean(consent),
                ip_hash: ipHash,
                status: 'pending'
        }).returning();

        return res.status(200).json({ success: true, id: request.id });
    } catch (e) {
        logger.error({ err: e }, "Error creating partnership request");
        return res.status(500).json({ error: "Internal server error" });
    }
}
