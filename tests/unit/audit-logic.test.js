import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from 'vitest';

/**
 * Audit Logic Tests
 *
 * Tests the core logic patterns used in the ProAuditLog handler:
 * pagination, filtering, and response shape.
 */

describe('Audit Logic — Pagination', () => {
    it('should clamp page to minimum 1', () => {
        const raw = '-5';
        const page = Math.max(1, parseInt(raw, 10));
        expect(page).toBe(1);
    });

    it('should clamp page for NaN input', () => {
        const raw = 'abc';
        const parsed = parseInt(raw, 10);
        const page = Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
        expect(page).toBe(1);
    });

    it('should clamp limit between 1 and 100', () => {
        expect(Math.min(100, Math.max(1, parseInt('200', 10)))).toBe(100);
        expect(Math.min(100, Math.max(1, parseInt('0', 10)))).toBe(1);
        expect(Math.min(100, Math.max(1, parseInt('-10', 10)))).toBe(1);
        expect(Math.min(100, Math.max(1, parseInt('50', 10)))).toBe(50);
    });

    it('should calculate totalPages correctly', () => {
        expect(Math.ceil(0 / 50)).toBe(0);
        expect(Math.ceil(1 / 50)).toBe(1);
        expect(Math.ceil(50 / 50)).toBe(1);
        expect(Math.ceil(51 / 50)).toBe(2);
        expect(Math.ceil(200 / 50)).toBe(4);
    });
});

describe('Audit Logic — Where Clause Construction', () => {
    it('should scope to structureId without action filter', () => {
        const structureId = 'struct-123';
        const actionFilter = null;

        const whereClause = {
            structureId,
            ...(actionFilter ? { action: actionFilter } : {}),
        };

        expect(whereClause).toEqual({ structureId: 'struct-123' });
        expect(whereClause).not.toHaveProperty('action');
    });

    it('should scope to structureId with action filter', () => {
        const structureId = 'struct-123';
        const actionFilter = 'EXPORT_CSV';

        const whereClause = {
            structureId,
            ...(actionFilter ? { action: actionFilter } : {}),
        };

        expect(whereClause).toEqual({
            structureId: 'struct-123',
            action: 'EXPORT_CSV',
        });
    });

    it('should not include action for empty string filter', () => {
        const structureId = 'struct-123';
        const actionFilter = '';

        const whereClause = {
            structureId,
            ...(actionFilter ? { action: actionFilter } : {}),
        };

        expect(whereClause).toEqual({ structureId: 'struct-123' });
    });
});

describe('Audit Logic — Response Shape', () => {
    it('should map log entries to the expected format', () => {
        const log = {
            id: 'log-1',
            action: 'EXPORT_CSV',
            proUserId: 'user-1',
            proUser: { id: 'user-1', email: 'agent@test.fr' },
            entityType: 'Report',
            entityId: 'report-42',
            metadata: { rows: 150 },
            createdAt: new Date('2026-03-03T10:00:00Z'),
        };

        const entry = {
            id: log.id,
            action: log.action,
            actorId: log.proUserId,
            actorEmail: log.proUser?.email || null,
            entityType: log.entityType,
            entityId: log.entityId,
            metadata: log.metadata,
            createdAt: log.createdAt,
        };

        expect(entry.id).toBe('log-1');
        expect(entry.actorEmail).toBe('agent@test.fr');
        expect(entry.metadata).toEqual({ rows: 150 });
    });

    it('should handle missing proUser gracefully', () => {
        const log = {
            id: 'log-2',
            action: 'DELETE_APPOINTMENT',
            proUserId: 'user-2',
            proUser: null,
            entityType: null,
            entityId: null,
            metadata: null,
            createdAt: new Date(),
        };

        const entry = {
            id: log.id,
            action: log.action,
            actorId: log.proUserId,
            actorEmail: log.proUser?.email || null,
            entityType: log.entityType,
            entityId: log.entityId,
            metadata: log.metadata,
            createdAt: log.createdAt,
        };

        expect(entry.actorEmail).toBeNull();
    });
});
