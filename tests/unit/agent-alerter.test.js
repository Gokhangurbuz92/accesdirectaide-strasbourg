import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { Alerter } from '../../api/lib/agents/alerter.js';

describe('Alerter Agent', () => {
    it('module exists', () => {
        expect(existsSync('api/lib/agents/alerter.js')).toBe(true);
    });

    it('exports Alerter class', () => {
        expect(Alerter).toBeDefined();
        const a = new Alerter();
        expect(a.name).toBe('alerter');
    });

    it('notify returns ok with empty changes', async () => {
        const a = new Alerter();
        const result = await a.notify([]);
        expect(result.ok).toBe(true);
        expect(result.notified).toBe(0);
    });

    it('notify handles null input', async () => {
        const a = new Alerter();
        const result = await a.notify(null);
        expect(result.ok).toBe(true);
        expect(result.notified).toBe(0);
    });
});
