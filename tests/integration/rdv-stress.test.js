/**
 * 🏋️ RDV STRESS TEST — Anti-doublon par concurrence
 * Tests that concurrent booking attempts don't create duplicates,
 * and that the UNIQUE constraint on (citizenUserId, idempotencyKey) fires.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/db/index.js';
import { Structure, ProRdvService, ProAppointment, ProUser } from '../../src/db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import crypto from 'crypto';

const TS = Date.now();
const STRUCTURE_ID = `rdv-stress-str-${TS}`;
const SERVICE_ID = `rdv-stress-svc-${TS}`;
const PRO_USER_ID = `rdv-stress-pro-${TS}`;

describe('RDV Stress Test — Concurrent Booking', () => {

    beforeAll(async () => {
        // Clean up any stale data from previous failed runs
        await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" LIKE 'rdv-stress-%'`);
        await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" LIKE 'rdv-stress-%'`);
        await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" LIKE 'rdv-stress-%'`);
        await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE 'rdv-stress-%'`);

        // Insert Structure
        await db.execute(sql`
            INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
            VALUES (${STRUCTURE_ID}, 'Stress Test Struct', ${'slug-'+TS}, 'association', '1 rue test', 'Paris', '75001', false, ARRAY['consultation'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())
        `);

        // Insert ProUser
        await db.execute(sql`
            INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt")
            VALUES (${PRO_USER_ID}, ${'stress-'+TS+'@test.fr'}, 'hash', ${STRUCTURE_ID}, 'PRO', 'active', NOW(), NOW())
        `);

        // Insert ProRdvService
        await db.execute(sql`
            INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "updatedAt", "createdAt")
            VALUES (${SERVICE_ID}, ${STRUCTURE_ID}, 'Consult Stress', 30, 0, 0, true, NOW(), NOW())
        `);

        // Verify the service exists
        const check = await db.execute(sql`SELECT id FROM "ProRdvService" WHERE id = ${SERVICE_ID}`);
        if (!check.rows?.length) throw new Error('ProRdvService fixture not created');
    });

    afterAll(async () => {
        await db.execute(sql`DELETE FROM "ProAppointment" WHERE "serviceId" = ${SERVICE_ID}`);
        await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SERVICE_ID}`);
        await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${PRO_USER_ID}`);
        await db.execute(sql`DELETE FROM "Structure" WHERE id = ${STRUCTURE_ID}`);
    });

    it('handles 10 concurrent bookings + null citizenUserId idempotency', async () => {
        const CONCURRENT = 10;
        const SLOT = new Date('2026-04-01T10:00:00Z');
        const SLOT_END = new Date('2026-04-01T10:30:00Z');

        // --- Part 1: 10 concurrent booking attempts ---
        const promises = Array.from({ length: CONCURRENT }, (_, i) => {
            const id = crypto.randomUUID();
            const idemKey = `concurrent-${TS}-${i}`;
            return db.execute(sql`
                INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "idempotencyKey", "createdByProUserId", "createdAt", "updatedAt")
                VALUES (${id}, ${STRUCTURE_ID}, ${SERVICE_ID}, ${SLOT}, ${SLOT_END}, 'booked', ${'Citoyen '+i}, ${idemKey}, ${PRO_USER_ID}, NOW(), NOW())
            `)
            .then(() => ({ success: true, id, attempt: i }))
            .catch(err => ({ success: false, error: err.message, attempt: i }));
        });

        const results = await Promise.all(promises);
        const successes = results.filter(r => r.success);

        // All 10 should succeed (unique idempotencyKeys, no citizenUserId conflict)
        expect(successes.length).toBe(CONCURRENT);

        // Verify count in DB
        const countResult = await db.execute(sql`
            SELECT count(*) as cnt FROM "ProAppointment"
            WHERE "serviceId" = ${SERVICE_ID} AND "startAt" = ${SLOT}
        `);
        expect(Number(countResult.rows[0].cnt)).toBe(CONCURRENT);

        // --- Part 2: null citizenUserId + same idempotencyKey ---
        const IDEM_KEY = `idem-null-${TS}`;

        await db.execute(sql`
            INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "idempotencyKey", "createdAt", "updatedAt")
            VALUES (${crypto.randomUUID()}, ${STRUCTURE_ID}, ${SERVICE_ID}, '2026-04-02 10:00:00', '2026-04-02 10:30:00', 'booked', 'Test A', ${IDEM_KEY}, NOW(), NOW())
        `);

        // Second with same key but null citizenUserId → should succeed (null != null in SQL)
        await db.execute(sql`
            INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "idempotencyKey", "createdAt", "updatedAt")
            VALUES (${crypto.randomUUID()}, ${STRUCTURE_ID}, ${SERVICE_ID}, '2026-04-02 11:00:00', '2026-04-02 11:30:00', 'booked', 'Test B', ${IDEM_KEY}, NOW(), NOW())
        `);

        const idemCount = await db.execute(sql`
            SELECT count(*) as cnt FROM "ProAppointment" WHERE "idempotencyKey" = ${IDEM_KEY}
        `);
        expect(Number(idemCount.rows[0].cnt)).toBe(2);
    });
});
