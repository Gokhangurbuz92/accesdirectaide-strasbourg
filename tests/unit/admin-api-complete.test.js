import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';

describe('Admin API completeness', () => {
    const handlers = [
        'api/_handlers/admin/dashboard.js',
        'api/_handlers/admin/stats.js',
        'api/_handlers/admin/logs.js',
        'api/_handlers/admin/ai-metrics.js',
        'api/_handlers/admin/review-queue.js',
        'api/_handlers/admin/orchestrator.js',
        'api/_handlers/admin/hive-repair.js',
        'api/_handlers/admin/features.js',
        'api/_handlers/admin/conversations.js',
        'api/_handlers/admin/inbox.js',
        'api/_handlers/admin/cron-runs.js',
        'api/_handlers/admin/actions.js',
        'api/_handlers/admin/analytics.js',
        'api/_handlers/admin/export.js',
        'api/_handlers/admin/import.js',
        'api/_handlers/admin/runs.js',
        'api/_handlers/admin/alerts.js',
        'api/_handlers/admin/bulk-repair.js',
        'api/_handlers/admin/link-checks.js',
        'api/_handlers/admin/national-stats.js',
        'api/_handlers/admin/rag-health.js',
        'api/_handlers/admin/validate-publication.js',
        'api/_handlers/admin/versions.js',
        'api/_handlers/admin/partnerships.js',
    ];

    handlers.forEach(h => {
        it(`${h.split('/').pop()} exists`, () => {
            expect(existsSync(h)).toBe(true);
        });
    });
});
