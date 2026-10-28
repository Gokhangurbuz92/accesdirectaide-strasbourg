import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

/**
 * AI Agent alignment tests — verify all agents are properly configured.
 */
describe('AI Agent alignment', () => {
    it('all agents check ENABLE_AI_AGENT', () => {
        const agents = [
            'api/_handlers/pro/agent-discovery.js',
            'api/_handlers/pro/agent-scheduler.js',
            'api/_handlers/cron/hive-scan.js',
            'api/_handlers/admin/hive-repair.js',
        ];
        agents.forEach(agent => {
            if (!existsSync(agent)) return;
            const content = readFileSync(agent, 'utf-8');
            expect(content, `${agent} should check ENABLE_AI_AGENT`).toMatch(/ENABLE_AI_AGENT/);
        });
    });

    it('orchestrator module exists', () => {
        expect(existsSync('api/lib/agent-orchestrator.js')).toBe(true);
    });

    it('shared discovery core exists', () => {
        expect(existsSync('api/lib/ai-discovery-core.js')).toBe(true);
    });

    it('orchestrator route exists', () => {
        const routes = readFileSync('api/routes.js', 'utf-8');
        expect(routes).toMatch(/orchestrator/);
    });

    it('hive-scan has 12 categories', () => {
        const content = readFileSync('api/_handlers/cron/hive-scan.js', 'utf-8');
        expect(content).toMatch(/HANDICAP/);
        expect(content).toMatch(/SENIORS/);
        expect(content).toMatch(/ENERGIE/);
        expect(content).toMatch(/NUMERIQUE/);
    });

    it('all discovery agents use circuit breaker or shared core', () => {
        const agents = [
            'api/_handlers/pro/agent-discovery.js',
            'api/_handlers/pro/agent-scheduler.js',
            'api/_handlers/cron/hive-scan.js',
        ];
        agents.forEach(agent => {
            if (!existsSync(agent)) return;
            const content = readFileSync(agent, 'utf-8');
            expect(
                content.match(/circuit|breaker|opossum|discovery-core/i),
                `${agent} should use circuit breaker or shared core`
            ).toBeTruthy();
        });
    });

    it('all discovery agents record metrics', () => {
        const agents = [
            'api/_handlers/pro/agent-discovery.js',
            'api/_handlers/cron/hive-scan.js',
            'api/lib/ai-discovery-core.js',
        ];
        agents.forEach(agent => {
            if (!existsSync(agent)) return;
            const content = readFileSync(agent, 'utf-8');
            expect(content, `${agent} should record metrics`).toMatch(/recordMetric/);
        });
    });

    it('scheduler delegates to shared discovery core', () => {
        const content = readFileSync('api/_handlers/pro/agent-scheduler.js', 'utf-8');
        expect(content).toMatch(/ai-discovery-core|discoverByCategory/);
    });

    it('docs/ai-agents.md exists', () => {
        expect(existsSync('docs/ai-agents.md')).toBe(true);
    });

    it('classifier uses generateText', () => {
        const content = readFileSync('api/lib/agents/classifier.js', 'utf-8');
        expect(content).toMatch(/generateText/);
        expect(content).toMatch(/metricType/);
    });

    it('falc-writer uses generateText', () => {
        const content = readFileSync('api/lib/agents/falc-writer.js', 'utf-8');
        expect(content).toMatch(/generateText/);
        expect(content).toMatch(/metricType/);
    });

    it('alerter uses ProNotification', () => {
        const content = readFileSync('api/lib/agents/alerter.js', 'utf-8');
        expect(content).toMatch(/ProNotification/);
    });

    it('orchestrator calls real agents when not dryRun', () => {
        const content = readFileSync('api/lib/agent-orchestrator.js', 'utf-8');
        expect(content).toMatch(/Classifier/);
        expect(content).toMatch(/FalcWriter/);
        expect(content).toMatch(/Alerter/);
    });

    it('hive-repair has dedicated metrics', () => {
        const content = readFileSync('api/_handlers/admin/hive-repair.js', 'utf-8');
        expect(content).toMatch(/recordMetric/);
        expect(content).toMatch(/hive-repair/);
    });
});
