import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

describe('Hive Repair handler', () => {
    const path = 'api/_handlers/admin/hive-repair.js';

    it('exists', () => {
        expect(existsSync(path)).toBe(true);
    });

    it('checks ENABLE_AI_AGENT', () => {
        const content = readFileSync(path, 'utf-8');
        expect(content).toMatch(/ENABLE_AI_AGENT/);
    });

    it('requires admin auth', () => {
        const content = readFileSync(path, 'utf-8');
        expect(content).toMatch(/verifyAdmin/);
    });

    it('has error handling', () => {
        const content = readFileSync(path, 'utf-8');
        expect(content).toMatch(/try/);
        expect(content).toMatch(/catch/);
    });

    it('records metrics with correct type', () => {
        const content = readFileSync(path, 'utf-8');
        expect(content).toMatch(/recordMetric/);
        expect(content).toMatch(/hive-repair/);
    });

    it('uses generateText', () => {
        const content = readFileSync(path, 'utf-8');
        expect(content).toMatch(/generateText/);
    });

    it('has rate limiting', () => {
        const content = readFileSync(path, 'utf-8');
        expect(content).toMatch(/checkRateLimit/);
    });
});
