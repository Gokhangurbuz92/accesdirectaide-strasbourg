/**
 * GDPR Retention Constants — Contract Tests
 *
 * Validates that retention constants match documented RGPD policy (docs/rgpd.md).
 * These tests serve as a contract between the purge code and documentation.
 */
import { describe, it, expect, vi } from 'vitest';

// Use vi.hoisted + vi.mock pattern (same as gdpr-purge-extended.test.js)
const mocks = vi.hoisted(() => {
    const whereFn = vi.fn().mockResolvedValue([]);
    const setFn = vi.fn().mockReturnThis();
    const deleteFn = vi.fn(() => ({ where: whereFn }));
    const updateFn = vi.fn(() => ({ set: setFn, where: whereFn }));
    const insertFn = vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) }));
    return { whereFn, setFn, deleteFn, updateFn, insertFn, db: { delete: deleteFn, update: updateFn, insert: insertFn } };
});

vi.mock('../../src/db/index.js', () => ({ db: mocks.db }));

import { RETENTION } from '../../api/_handlers/cron/gdpr-purge.js';

describe('GDPR Retention Constants', () => {
    it('exports a RETENTION object with all required keys', () => {
        expect(RETENTION).toBeDefined();
        expect(typeof RETENTION).toBe('object');

        const requiredKeys = [
            'AUDIT_LOG_DAYS',
            'PRO_AUDIT_LOG_DAYS',
            'CONVERSATION_LOG_DAYS',
            'AI_METRIC_DAYS',
            'ENTITY_VERSION_DAYS',
            'CONSENT_LOG_DAYS',
            'INVITATION_GRACE_DAYS',
            'OUTLOOK_TOKEN_GRACE_DAYS',
            'APPOINTMENT_ANON_DAYS',
        ];
        for (const key of requiredKeys) {
            expect(RETENTION).toHaveProperty(key);
            expect(typeof RETENTION[key]).toBe('number');
        }
    });

    // --- AuditLog ---
    it('AuditLog retention is >= 365 days (legal obligation Art 6.1.c)', () => {
        expect(RETENTION.AUDIT_LOG_DAYS).toBeGreaterThanOrEqual(365);
    });

    it('AuditLog retention is exactly 365 days', () => {
        expect(RETENTION.AUDIT_LOG_DAYS).toBe(365);
    });

    // --- ProAuditLog ---
    it('ProAuditLog retention matches AuditLog (365 days)', () => {
        expect(RETENTION.PRO_AUDIT_LOG_DAYS).toBe(365);
        expect(RETENTION.PRO_AUDIT_LOG_DAYS).toBe(RETENTION.AUDIT_LOG_DAYS);
    });

    // --- ConsentLog ---
    it('ConsentLog retention is >= 1095 days (3 years, legal proof)', () => {
        expect(RETENTION.CONSENT_LOG_DAYS).toBeGreaterThanOrEqual(1095);
    });

    it('ConsentLog retention is exactly 1095 days (3 years)', () => {
        expect(RETENTION.CONSENT_LOG_DAYS).toBe(1095);
    });

    // --- ConversationLog ---
    it('ConversationLog retention is 90 days (operational)', () => {
        expect(RETENTION.CONVERSATION_LOG_DAYS).toBe(90);
    });

    // --- AI Metrics ---
    it('AiMetric retention is 90 days (technical hygiene)', () => {
        expect(RETENTION.AI_METRIC_DAYS).toBe(90);
    });

    // --- EntityVersion ---
    it('EntityVersion retention is 90 days', () => {
        expect(RETENTION.ENTITY_VERSION_DAYS).toBe(90);
    });

    // --- Invitation ---
    it('Invitation grace period is 30 days after expiry', () => {
        expect(RETENTION.INVITATION_GRACE_DAYS).toBe(30);
    });

    // --- ProOutlookToken ---
    it('ProOutlookToken grace period is 30 days after expiry', () => {
        expect(RETENTION.OUTLOOK_TOKEN_GRACE_DAYS).toBe(30);
    });

    // --- ProAppointment ---
    it('ProAppointment anonymisation threshold is 730 days (2 years)', () => {
        expect(RETENTION.APPOINTMENT_ANON_DAYS).toBe(730);
    });

    // --- Cross-validation ---
    it('all retention values are positive integers', () => {
        for (const [key, value] of Object.entries(RETENTION)) {
            expect(value, `${key} should be positive`).toBeGreaterThan(0);
            expect(Number.isInteger(value), `${key} should be integer`).toBe(true);
        }
    });

    it('consent retention is strictly longer than operational retention', () => {
        expect(RETENTION.CONSENT_LOG_DAYS).toBeGreaterThan(RETENTION.CONVERSATION_LOG_DAYS);
    });

    it('audit retention is strictly longer than operational retention', () => {
        expect(RETENTION.AUDIT_LOG_DAYS).toBeGreaterThan(RETENTION.CONVERSATION_LOG_DAYS);
    });
});
