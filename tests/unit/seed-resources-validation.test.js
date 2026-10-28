import { describe, it, expect } from 'vitest';
import { INITIAL_RESOURCES } from '../../api/lib/seed-resources.js';
import { ALLOWED_DOMAINS } from '../../api/lib/agents/resource-curator.js';

describe('Seed resources validation', () => {
    it('has 10+ resources', () => {
        expect(INITIAL_RESOURCES.length).toBeGreaterThanOrEqual(10);
    });

    it('covers all 4 types', () => {
        const types = [...new Set(INITIAL_RESOURCES.map(r => r.type))];
        expect(types).toContain('RESSOURCE');
        expect(types).toContain('OUTIL');
        expect(types).toContain('DISPOSITIF');
        expect(types).toContain('BONNE_PRATIQUE');
    });

    it('all URLs are official sources', () => {
        INITIAL_RESOURCES
            .filter(r => r.url)
            .forEach(r => {
                const isAllowed = ALLOWED_DOMAINS.some(d => r.url.includes(d));
                expect(isAllowed, `${r.url} should be an allowed domain`).toBe(true);
            });
    });

    it('no empty titles', () => {
        INITIAL_RESOURCES.forEach(r => {
            expect(r.title.length).toBeGreaterThan(3);
        });
    });

    it('no empty descriptions', () => {
        INITIAL_RESOURCES.forEach(r => {
            expect(r.description.length).toBeGreaterThan(10);
        });
    });

    it('all have source', () => {
        INITIAL_RESOURCES.forEach(r => {
            expect(r.source).toBeDefined();
            expect(r.source.length).toBeGreaterThan(3);
        });
    });

    it('covers multiple categories', () => {
        const cats = [...new Set(INITIAL_RESOURCES.map(r => r.category))];
        expect(cats.length).toBeGreaterThanOrEqual(4);
    });

    it('bonnes pratiques have content field', () => {
        const bp = INITIAL_RESOURCES.filter(r => r.type === 'BONNE_PRATIQUE');
        expect(bp.length).toBeGreaterThanOrEqual(1);
        bp.forEach(r => {
            expect(r.content).toBeDefined();
            expect(r.content.length).toBeGreaterThan(10);
        });
    });

    it('no duplicate titles', () => {
        const titles = INITIAL_RESOURCES.map(r => r.title);
        const unique = new Set(titles);
        expect(unique.size).toBe(titles.length);
    });
});
