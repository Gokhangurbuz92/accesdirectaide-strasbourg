import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
vi.mock('../../src/db/index.js', () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
            { id: '1', titre: 'Test Aide', description: 'Description test' },
        ]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../../api/_utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

describe('AgentOrchestrator', () => {
    let AgentOrchestrator;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../../api/lib/agent-orchestrator.js');
        AgentOrchestrator = mod.AgentOrchestrator;
    });

    it('creates with default 12 categories', () => {
        const orch = new AgentOrchestrator();
        expect(orch.categories.length).toBe(12);
        expect(orch.dryRun).toBe(false);
    });

    it('creates with custom options', () => {
        const orch = new AgentOrchestrator({ dryRun: true, categories: ['EMPLOI'] });
        expect(orch.dryRun).toBe(true);
        expect(orch.categories).toEqual(['EMPLOI']);
    });

    it('runs pipeline in dry-run mode', async () => {
        const orch = new AgentOrchestrator({ dryRun: true });
        const results = await orch.run();

        expect(results.started).toBeDefined();
        expect(results.finished).toBeDefined();
        expect(results.steps).toBeInstanceOf(Array);
        expect(results.steps.length).toBe(6);
        expect(results.summary).toBeDefined();
    });

    it('records step names', async () => {
        const orch = new AgentOrchestrator({ dryRun: true });
        const results = await orch.run();

        const stepNames = results.steps.map(s => s.name);
        expect(stepNames).toEqual(['discovery', 'enrichment', 'validation', 'classification', 'falc', 'alerting']);
    });

    it('handles errors gracefully', async () => {
        const orch = new AgentOrchestrator({ dryRun: true });
        orch.runDiscovery = async () => { throw new Error('DB down'); };

        const results = await orch.run();
        expect(results.errors.length).toBeGreaterThan(0);
        expect(results.errors[0].step).toBe('discovery');
    });

    it('categories include all schema types', () => {
        const orch = new AgentOrchestrator();
        expect(orch.categories).toContain('EMPLOI');
        expect(orch.categories).toContain('HANDICAP');
        expect(orch.categories).toContain('SENIORS');
        expect(orch.categories).toContain('ENERGIE');
    });

    it('summary includes all 6 agent fields', async () => {
        const orch = new AgentOrchestrator({ dryRun: true });
        const results = await orch.run();
        expect(results.summary).toHaveProperty('discovered');
        expect(results.summary).toHaveProperty('enriched');
        expect(results.summary).toHaveProperty('validated');
        expect(results.summary).toHaveProperty('classified');
        expect(results.summary).toHaveProperty('falcified');
        expect(results.summary).toHaveProperty('alerted');
    });
});
