import { describe, it, expect } from 'vitest';
import { FALC_SYSTEM_PROMPT } from '../../api/lib/agents/falc-writer.js';
import { CLASSIFIER_SYSTEM_PROMPT } from '../../api/lib/agents/classifier.js';
import { CURATOR_SYSTEM_PROMPT } from '../../api/lib/agents/resource-curator.js';

describe('Agent prompts quality', () => {
    describe('FALC prompt', () => {
        it('mentions word limit', () => {
            expect(FALC_SYSTEM_PROMPT).toMatch(/15 mots|courte/i);
        });
        it('mentions simple words', () => {
            expect(FALC_SYSTEM_PROMPT).toMatch(/simple|jargon/i);
        });
        it('mentions active voice', () => {
            expect(FALC_SYSTEM_PROMPT).toMatch(/active/i);
        });
        it('mentions accessibility', () => {
            expect(FALC_SYSTEM_PROMPT).toMatch(/facile|comprendre|accessible/i);
        });
        it('has structured output format', () => {
            expect(FALC_SYSTEM_PROMPT).toMatch(/TITRE|DESCRIPTION|COMMENT FAIRE/i);
        });
        it('is at least 200 chars (comprehensive)', () => {
            expect(FALC_SYSTEM_PROMPT.length).toBeGreaterThan(200);
        });
    });

    describe('Classifier prompt', () => {
        it('lists all 12 categories', () => {
            const cats = [
                'EMPLOI', 'LOGEMENT', 'SANTE', 'FAMILLE',
                'HANDICAP', 'ETUDES', 'MOBILITE', 'ENERGIE',
                'ALIMENTATION', 'NUMERIQUE', 'JUSTICE', 'SENIORS',
            ];
            cats.forEach(cat => {
                expect(CLASSIFIER_SYSTEM_PROMPT).toContain(cat);
            });
        });
        it('lists audiences', () => {
            expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/JEUNES/);
            expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/TOUS/);
            expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/FAMILLES/);
        });
        it('asks for confidence score', () => {
            expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/confiance/);
        });
        it('asks for JSON format', () => {
            expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/JSON/);
        });
        it('includes urgence levels', () => {
            expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/NORMALE/);
            expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/HAUTE/);
            expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/CRITIQUE/);
        });
    });

    describe('Curator prompt', () => {
        it('mentions official sources', () => {
            expect(CURATOR_SYSTEM_PROMPT).toMatch(/gouv\.fr/);
        });
        it('lists 4 content types', () => {
            expect(CURATOR_SYSTEM_PROMPT).toMatch(/RESSOURCE/);
            expect(CURATOR_SYSTEM_PROMPT).toMatch(/OUTIL/);
            expect(CURATOR_SYSTEM_PROMPT).toMatch(/DISPOSITIF/);
        });
        it('forbids non-official sources', () => {
            expect(CURATOR_SYSTEM_PROMPT).toMatch(/JAMAIS/);
        });
        it('asks for JSON format', () => {
            expect(CURATOR_SYSTEM_PROMPT).toMatch(/JSON/);
        });
    });
});
