import { describe, it, expect } from 'vitest';
import { CLASSIFIER_SYSTEM_PROMPT, Classifier } from '../../api/lib/agents/classifier.js';

describe('Classifier Agent', () => {
    it('has system prompt', () => {
        expect(CLASSIFIER_SYSTEM_PROMPT).toBeDefined();
        expect(CLASSIFIER_SYSTEM_PROMPT.length).toBeGreaterThan(100);
    });

    it('prompt lists 12 categories', () => {
        expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/EMPLOI/);
        expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/LOGEMENT/);
        expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/HANDICAP/);
        expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/SENIORS/);
        expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/ENERGIE/);
    });

    it('prompt lists audiences', () => {
        expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/JEUNES/);
        expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/FAMILLES/);
        expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/TOUS/);
    });

    it('prompt asks for JSON response', () => {
        expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/JSON/);
        expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/categories/);
        expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/confiance/);
    });

    it('exports Classifier class', () => {
        expect(Classifier).toBeDefined();
        const c = new Classifier({});
        expect(c.name).toBe('classifier');
    });
});
