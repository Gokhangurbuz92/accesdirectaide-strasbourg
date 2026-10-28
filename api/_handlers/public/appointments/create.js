// @ts-nocheck
/**
 * PROXY ADAPTER — public/appointments/create.js
 *
 * Legacy System A route → writes to System B tables (ProAppointment, ProRdvService).
 * Maintains identical API contract: { structureId, startAt, email, name } → { success, id, tokens }
 *
 * Mapping:
 *   Beneficiary (email) → citizenEmailSnapshot on ProAppointment
 *   Service (legacy) → ProRdvService (find or create default)
 *   Appointment → ProAppointment
 *   cancel_token → HMAC-signed token via crypto.ts (no DB storage needed)
 */
import { db } from '../../../../src/db/index.js';
import { ProAppointment, ProRdvService, Structure } from '../../../../src/db/schema.js';
import { eq, and, lt, gt, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { createHandler } from '../../../_utils/wrapper.js';
import { encrypt, hash, generateAttachmentToken } from '../../../lib/crypto.js';
import crypto from 'crypto';
import { createError, errorCodes } from '../../../_utils/errors.js';
import { ACTIVE_APPOINTMENT_STATUSES } from '../../../_utils/pro-rdv.js';

const bodySchema = z.object({
    structureId: z.string().min(1),
    startAt: z.string().datetime(),
    email: z.string().email(),
    name: z.string().optional()
});

/**
 * Find or create a default ProRdvService for a structure.
 * If none exists, creates a generic one (60min, no buffers).
 */
async function getOrCreateDefaultService(structureId) {
    // Try existing active service first
    const existing = await db.query.ProRdvService.findFirst({
        where: (s, { eq, and }) => and(eq(s.structureId, structureId), eq(s.isActive, true)),
        columns: { id: true, durationMinutes: true },
        orderBy: (s, { asc }) => [asc(s.createdAt)],
    });

    if (existing) return existing;

    // Create a default service
    const [newService] = await db.insert(ProRdvService).values({
        structureId,
        name: 'Rendez-vous',
        durationMinutes: 60,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        isActive: true,
    }).returning();

    return newService;
}

const handler = async (req) => {
    if (req.method !== 'POST') {
        throw createError(405, errorCodes.BAD_REQUEST, 'Method not allowed');
    }

    const { structureId, startAt, email, name } = req.validated.body;

    // 1. Verify structure exists
    const structure = await db.query.Structure.findFirst({
        where: eq(Structure.id, structureId),
        columns: { id: true },
    });

    if (!structure) {
        throw createError(404, errorCodes.NOT_FOUND, 'Structure introuvable');
    }

    // 2. Get or create service (System B equivalent of legacy Service table)
    const service = await getOrCreateDefaultService(structureId);

    // 3. Calculate time range
    const start = new Date(startAt);
    const duration = service.durationMinutes || 60;
    const end = new Date(start.getTime() + duration * 60000);

    // 4. Idempotency: use email hash + startAt as idempotency key
    const idempotencyKey = `legacy:${hash(email)}:${startAt}`;

    // Check for existing appointment with same idempotency key
    const existingByKey = await db.query.ProAppointment.findFirst({
        where: (a, { eq, and }) => and(
            eq(a.idempotencyKey, idempotencyKey),
            eq(a.structureId, structureId),
        ),
        columns: { id: true },
    });

    if (existingByKey) {
        const cancelToken = generateAttachmentToken(existingByKey.id, 365 * 24 * 3600); // 1 year
        return {
            success: true,
            id: existingByKey.id,
            tokens: { cancel: cancelToken }
        };
    }

    // 5. Check for double-booking (same logic as legacy, but on ProAppointment)
    const conflict = await db.query.ProAppointment.findFirst({
        where: (a, { eq, and, lt, gt, inArray }) => and(
            eq(a.structureId, structureId),
            inArray(a.status, ACTIVE_APPOINTMENT_STATUSES),
            lt(a.startAt, end),
            gt(a.endAt, start),
        ),
    });

    if (conflict) {
        throw createError(409, errorCodes.CONFLICT, "Ce créneau n'est plus disponible.");
    }

    // 6. Insert into ProAppointment (System B)
    const [appointment] = await db.insert(ProAppointment).values({
        structureId,
        serviceId: service.id,
        startAt: start,
        endAt: end,
        status: 'confirmed',
        beneficiaryName: name ? encrypt(name) : 'Particulier',
        citizenUserId: null, // Anonymous legacy booking — no CitizenUser account
        citizenEmailSnapshot: encrypt(email),
        idempotencyKey,
        visioEnabled: false,
    }).returning();

    // 7. Generate HMAC-signed cancel token (no DB storage needed)
    const cancelToken = generateAttachmentToken(appointment.id, 365 * 24 * 3600); // 1 year

    // 8. Return same response format as legacy System A
    return {
        success: true,
        id: appointment.id,
        tokens: {
            cancel: cancelToken
        }
    };
};

export default createHandler(handler, { body: bodySchema });
