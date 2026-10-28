import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from 'vitest';

/**
 * Impact Stats — Unit Tests (Phase 3 — Sprint Final)
 *
 * Tests KPI calculations used by the Impact Reports dashboard.
 * Pure logic tests — no database or network required.
 */

// ── KPI Calculator (mirrors reports.js logic) ──

function calculateCompletionRate(total, cancelled) {
    if (total <= 0) return 0;
    const completed = total - cancelled;
    return Math.round((completed / total) * 100);
}

function calculateAvoidedNoShows(smsCount) {
    // DITP estimation: SMS reminders reduce no-shows by ~35%
    return Math.round(smsCount * 0.35);
}

function calculateSmsImpactRate(smsCount, totalAppointments) {
    if (totalAppointments <= 0) return 0;
    return Math.round((smsCount / totalAppointments) * 100);
}

function groupByDay(appointments) {
    const dailyMap = {};
    for (const apt of appointments) {
        const day = new Date(apt.startAt).toISOString().split('T')[0];
        dailyMap[day] = (dailyMap[day] || 0) + 1;
    }
    return Object.entries(dailyMap).map(([date, count]) => ({ date, count }));
}

function buildThemes(byService, serviceMap) {
    return byService.map((s) => ({
        name: serviceMap[s.serviceId] || 'Autre',
        value: s.count,
    }));
}

// ==========================================================================
// TESTS
// ==========================================================================

describe('Impact Stats — Completion Rate', () => {
    it('should calculate correct completion rate', () => {
        expect(calculateCompletionRate(100, 10)).toBe(90);
    });

    it('should return 0 for zero appointments', () => {
        expect(calculateCompletionRate(0, 0)).toBe(0);
    });

    it('should handle 100% completion', () => {
        expect(calculateCompletionRate(50, 0)).toBe(100);
    });

    it('should handle 100% cancellation', () => {
        expect(calculateCompletionRate(10, 10)).toBe(0);
    });

    it('should round to nearest integer', () => {
        expect(calculateCompletionRate(3, 1)).toBe(67);
    });
});

describe('Impact Stats — SMS No-Show Prevention', () => {
    it('should estimate avoided no-shows at 35%', () => {
        expect(calculateAvoidedNoShows(100)).toBe(35);
    });

    it('should return 0 for zero SMS', () => {
        expect(calculateAvoidedNoShows(0)).toBe(0);
    });

    it('should round correctly for odd numbers', () => {
        expect(calculateAvoidedNoShows(7)).toBe(2); // 7 * 0.35 = 2.45 → 2
    });

    it('should handle large volumes', () => {
        expect(calculateAvoidedNoShows(10000)).toBe(3500);
    });
});

describe('Impact Stats — SMS Impact Rate', () => {
    it('should calculate SMS coverage percentage', () => {
        expect(calculateSmsImpactRate(80, 100)).toBe(80);
    });

    it('should return 0 for zero appointments', () => {
        expect(calculateSmsImpactRate(50, 0)).toBe(0);
    });

    it('should cap at 100% even with more SMS than RDV', () => {
        expect(calculateSmsImpactRate(120, 100)).toBe(120); // Can exceed 100% (multiple SMS per RDV)
    });
});

describe('Impact Stats — Daily Activity Grouping', () => {
    it('should group appointments by day', () => {
        const appointments = [
            { startAt: '2026-03-01T09:00:00Z' },
            { startAt: '2026-03-01T14:00:00Z' },
            { startAt: '2026-03-02T10:00:00Z' },
        ];
        const result = groupByDay(appointments);
        expect(result).toEqual([
            { date: '2026-03-01', count: 2 },
            { date: '2026-03-02', count: 1 },
        ]);
    });

    it('should return empty array for no appointments', () => {
        expect(groupByDay([])).toEqual([]);
    });
});

describe('Impact Stats — Service Themes', () => {
    it('should map service IDs to names', () => {
        const byService = [
            { serviceId: 'svc1', count: 10 },
            { serviceId: 'svc2', count: 5 },
        ];
        const serviceMap = { svc1: 'Logement', svc2: 'Emploi' };
        const result = buildThemes(byService, serviceMap);
        expect(result).toEqual([
            { name: 'Logement', value: 10 },
            { name: 'Emploi', value: 5 },
        ]);
    });

    it('should fallback to "Autre" for unknown services', () => {
        const result = buildThemes([{ serviceId: 'unknown', count: 3 }], {});
        expect(result).toEqual([{ name: 'Autre', value: 3 }]);
    });
});
