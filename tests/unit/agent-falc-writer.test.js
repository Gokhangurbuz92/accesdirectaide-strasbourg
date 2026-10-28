import { describe, it, expect } from 'vitest';
import { FALC_SYSTEM_PROMPT, FalcWriter } from '../../api/lib/agents/falc-writer.js';

describe('FALC Writer Agent', () => {
    it('has system prompt', () => {
        expect(FALC_SYSTEM_PROMPT).toBeDefined();
        expect(FALC_SYSTEM_PROMPT.length).toBeGreaterThan(100);
    });

    it('prompt mentions FALC rules', () => {
        expect(FALC_SYSTEM_PROMPT).toMatch(/15 mots|courtes/i);
        expect(FALC_SYSTEM_PROMPT).toMatch(/simple|jargon/i);
        expect(FALC_SYSTEM_PROMPT).toMatch(/active/i);
    });

    it('prompt has output format', () => {
        expect(FALC_SYSTEM_PROMPT).toMatch(/titre|description|comment faire/i);
    });

    it('exports FalcWriter class', () => {
        expect(FalcWriter).toBeDefined();
        const writer = new FalcWriter({});
        expect(writer.name).toBe('falc-writer');
    });
});
