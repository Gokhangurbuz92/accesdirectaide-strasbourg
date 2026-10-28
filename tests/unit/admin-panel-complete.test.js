import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { readFileSync } from 'fs';

describe('Admin panel completeness', () => {
    const corePages = [
        'src/pages/AdminDashboard.jsx',
        'src/pages/AdminAides.jsx',
        'src/pages/AdminStructures.jsx',
        'src/pages/AdminDemarches.jsx',
        'src/pages/AdminMessages.jsx',
        'src/pages/AdminSources.jsx',
        'src/pages/AdminAppointments.jsx',
        'src/pages/AdminReview.jsx',
        'src/pages/AdminFeatures.jsx',
        'src/pages/AdminConversations.jsx',
        'src/pages/AdminSync.jsx',
        'src/pages/AdminAudit.jsx',
        'src/pages/AdminAiMetrics.jsx',
        'src/pages/AdminLogs.jsx',
    ];

    const subPages = [
        'src/pages/admin/AdminLayout.jsx',
        'src/pages/admin/ReviewQueue.jsx',
        'src/pages/admin/Health.jsx',
        'src/pages/admin/Observability.jsx',
        'src/pages/admin/Runs.jsx',
        'src/pages/admin/Inbox.jsx',
        'src/pages/admin/AIOrchestrator.jsx',
        'src/pages/admin/NationalDashboard.jsx',
        'src/pages/admin/AdminParametres.jsx',
    ];

    corePages.forEach(page => {
        it(`${page.split('/').pop()} exists`, () => {
            expect(existsSync(page)).toBe(true);
        });
    });

    subPages.forEach(page => {
        it(`admin/${page.split('/').pop()} exists`, () => {
            expect(existsSync(page)).toBe(true);
        });
    });

    it('index.jsx has ai-metrics route', () => {
        const content = readFileSync('src/pages/index.jsx', 'utf-8');
        expect(content).toContain('ai-metrics');
    });

    it('index.jsx has logs route', () => {
        const content = readFileSync('src/pages/index.jsx', 'utf-8');
        expect(content).toContain('"logs"');
    });

    it('AdminLayout has sidebar link for AI Metrics', () => {
        const content = readFileSync('src/pages/admin/AdminLayout.jsx', 'utf-8');
        expect(content).toContain('/admin/ai-metrics');
    });

    it('AdminLayout has sidebar link for Logs', () => {
        const content = readFileSync('src/pages/admin/AdminLayout.jsx', 'utf-8');
        expect(content).toContain('/admin/logs');
    });
});
