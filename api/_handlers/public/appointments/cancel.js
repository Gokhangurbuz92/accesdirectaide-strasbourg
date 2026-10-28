// @ts-nocheck
/**
 * PROXY ADAPTER — public/appointments/cancel.js
 *
 * Legacy System A route → operates on System B table (ProAppointment).
 * Maintains identical API contract: { id, token } → { success: true }
 *
 * Mapping:
 *   cancel_token_hash verification → HMAC-signed token verification via crypto.ts
 *   Appointment.status → ProAppointment.status + cancelledAt + cancelledBy
 */
import logger from '../../../_utils/logger.js';
import { db } from '../../../../src/db/index.js';
import { ProAppointment } from '../../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { verifyAttachmentToken } from '../../../lib/crypto.js';

/**
 * @param {import('../../../_utils/http-types').ApiRequest} req
 * @param {import('../../../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { id, token } = { ...req.query, ...req.body };

    if (!id && !token) return res.status(400).json({ error: "Missing ID or token" });

    try {
        // Strategy: the cancel token is an HMAC-signed token containing the appointment ID.
        // If client provides a token, we verify it to extract the appointment ID.
        // If client provides an id directly, we also need the token for auth.
        let appointmentId = id;

        if (token) {
            // Verify HMAC-signed token → extracts the appointment ID
            const tokenAppointmentId = verifyAttachmentToken(token);
            if (!tokenAppointmentId) {
                return res.status(403).json({ error: "Invalid token" });
            }
            appointmentId = appointmentId || tokenAppointmentId;

            // If both id and token provided, make sure they match
            if (id && id !== tokenAppointmentId) {
                return res.status(403).json({ error: "Invalid token" });
            }
        } else {
            // No token provided: reject (legacy API requires a token)
            return res.status(400).json({ error: "Missing ID or token" });
        }

        // Find ProAppointment (System B)
        const appointment = await db.query.ProAppointment.findFirst({
            where: eq(ProAppointment.id, appointmentId)
        });

        if (!appointment) return res.status(404).json({ error: "Not found" });

        // Already cancelled → idempotent
        if (appointment.status === 'cancelled') {
            return res.status(200).json({ success: true });
        }

        // Cancel in System B
        await db.update(ProAppointment)
            .set({
                status: 'cancelled',
                cancelledAt: new Date(),
                cancelledBy: 'citizen_legacy',
            })
            .where(eq(ProAppointment.id, appointmentId));

        return res.status(200).json({ success: true });

    } catch (e) {
        logger.error("Cancel Error (proxy)", e);
        return res.status(500).json({ error: "Internal Error" });
    }
}
