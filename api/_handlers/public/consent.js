import crypto from 'node:crypto';
import logger from '../../_utils/logger.js';
import { db } from '../../../src/db/index.js';
import { ConsentLog, AuditLog } from '../../../src/db/schema.js';
import { clientIp } from '../../_utils/client-ip.js';
/**
 * POST /api/public/consent
 *
 * Records a public consent event (cookies, terms, privacy policy).
 * Canonical record goes to ConsentLog (RGPD legal proof, retained 3 years).
 * An operational AuditLog entry is also written for audit trail.
 *
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { type, version, metadata } = req.body;
    // type: 'cookies', 'terms', 'privacy'
    // version: e.g. '2024-01-20'

    if (!type || !version) {
        return res.status(400).json({ error: "Missing type or version" });
    }

    try {
        const ip = clientIp(req);
        // Derive a pseudonymous subject_id from IP + user-agent (no raw PII stored)
        const subjectRaw = `${ip}:${req.headers['user-agent'] || ''}`;
        const subjectId = crypto.createHash('sha256').update(subjectRaw).digest('hex').slice(0, 16);

        // Compute a hash of the policy version for integrity verification
        const policyHash = crypto.createHash('sha256').update(`${type}:${version}`).digest('hex');

        // 1. Canonical consent record → ConsentLog (retained 3 years)
        await db.insert(ConsentLog).values({
            policy_version: version,
            policy_hash: policyHash,
            subject_type: type,
            subject_id: subjectId,
        });

        // 2. Operational audit trail → AuditLog
        try {
            await db.insert(AuditLog).values({
                action: 'USER_CONSENT',
                actor: subjectId,
                target: `${type}@${version}`,
                details: { type, version, metadata },
                ip_hash: crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16),
            });
        } catch { /* AuditLog is best-effort for consent tracking */ }

        return res.status(200).json({ success: true, message: "Consent logged" });
    } catch (e) {
        logger.error({ err: e }, 'Consent Log Error:');
        return res.status(500).json({ error: "Internal Error" });
    }
}
