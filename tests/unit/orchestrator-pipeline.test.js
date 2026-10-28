import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
vi.mock('../../src/db/index.js', () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
            { id: '1', titre: 'RSA', description: 'Revenu de solidarité active' },
            { id: '2', titre: 'APL', description: 'Aide personnalisée au logement' },
        ]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../api/_utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Mock Gemini so real agents can call generateText
vi.mock('../../api/lib/gemini.js', () => ({
    generateText: vi.fn().mockResolvedValue(
        '{"categories":["EMPLOI"],"audiences":["TOUS"],"besoins":["revenu"],"urgence":"HAUTE","confiance":0.9}'
    ),
}));

describe('Orchestrator pipeline integration', () => {
    let AgentOrchestrator;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../../api/lib/agent-orchestrator.js');
        AgentOrchestrator = mod.AgentOrchestrator;
    });

    it('dry-run completes all 6 steps without errors', async () => {
        const orch = new AgentOrchestrator({ dryRun: true });
        const results = await orch.run();

        expect(results.steps.length).toBe(6);
        expect(results.finished).toBeDefined();
        expect(results.errors.length).toBe(0);
    });

    it('each step has name, status, and durationMs', async () => {
        const orch = new AgentOrchestrator({ dryRun: true });
        const results = await orch.run();

        results.steps.forEach(step => {
            expect(step.name).toBeDefined();
            expect(step.status).toBe('ok');
            expect(step.durationMs).toBeGreaterThanOrEqual(0);
        });
    });

    it('step names follow correct order', async () => {
        const orch = new AgentOrchestrator({ dryRun: true });
        const results = await orch.run();

        const names = results.steps.map(s => s.name);
        expect(names).toEqual([
            'discovery', 'enrichment', 'validation',
            'classification', 'falc', 'alerting',
        ]);
    });

    it('summary has all agent counts', async () => {
        const orch = new AgentOrchestrator({ dryRun: true });
        const results = await orch.run();

        expect(results.summary).toHaveProperty('discovered');
        expect(results.summary).toHaveProperty('enriched');
        expect(results.summary).toHaveProperty('validated');
        expect(results.summary).toHaveProperty('classified');
        expect(results.summary).toHaveProperty('falcified');
        expect(results.summary).toHaveProperty('alerted');
        expect(results.summary).toHaveProperty('errors');
    });

    it('started and finished timestamps are valid ISO', async () => {
        const orch = new AgentOrchestrator({ dryRun: true });
        const results = await orch.run();

        expect(new Date(results.started).toISOString()).toBe(results.started);
        expect(new Date(results.finished).toISOString()).toBe(results.finished);
    });

    it('handles step failure gracefully', async () => {
        const orch = new AgentOrchestrator({ dryRun: true });
        orch.runDiscovery = async () => { throw new Error('DB offline'); };
        const results = await orch.run();

        expect(results.errors.length).toBe(1);
        expect(results.errors[0].step).toBe('discovery');
        // Other steps should still run
        expect(results.steps.length).toBe(6);
    });

    it('custom categories are respected', async () => {
        const orch = new AgentOrchestrator({ dryRun: true, categories: ['EMPLOI'] });
        expect(orch.categories).toEqual(['EMPLOI']);
    });
});
