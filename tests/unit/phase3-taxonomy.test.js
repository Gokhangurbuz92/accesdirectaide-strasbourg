import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Phase 3 Taxonomy Unit Tests
 * Validates taxonomy.json structure and CategoryChip behaviour.
 */

// Load taxonomy.json
const taxonomyPath = resolve(__dirname, '../../api/data/taxonomy.json');
const taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf8'));
const slugs = taxonomy.map(c => c.slug);

describe('taxonomy.json', () => {
    it('contains exactly 13 categories', () => {
        expect(taxonomy).toHaveLength(13);
    });

    it('contains lgbtqi-plus', () => {
        expect(slugs).toContain('lgbtqi-plus');
    });

    it('contains personnes-agees', () => {
        expect(slugs).toContain('personnes-agees');
    });

    it('contains all expected categories', () => {
        const expected = [
            'papiers-citoyennete', 'famille', 'social-sante', 'personnes-agees',
            'handicap', 'travail-formation', 'logement', 'transports',
            'argent', 'justice', 'etranger', 'loisirs', 'lgbtqi-plus',
        ];
        expected.forEach(slug => {
            expect(slugs).toContain(slug);
        });
    });

    it('every category has slug, label, color, and keywords', () => {
        taxonomy.forEach(cat => {
            expect(cat).toHaveProperty('slug');
            expect(cat).toHaveProperty('label');
            expect(cat).toHaveProperty('color');
            expect(cat).toHaveProperty('keywords');
            expect(cat.slug).toBeTruthy();
            expect(cat.label).toBeTruthy();
            expect(cat.color).toBeTruthy();
            expect(Array.isArray(cat.keywords)).toBe(true);
        });
    });

    it('has no duplicate slugs', () => {
        const uniqueSlugs = new Set(slugs);
        expect(uniqueSlugs.size).toBe(slugs.length);
    });

    it('lgbtqi-plus has correct structure', () => {
        const lgbtqi = taxonomy.find(c => c.slug === 'lgbtqi-plus');
        expect(lgbtqi.label).toBe('LGBTQI+');
        expect(lgbtqi.color).toBe('bg-fuchsia-100 text-fuchsia-800');
        expect(lgbtqi.keywords).toContain('lgbt');
        expect(lgbtqi.keywords).toContain('queer');
        expect(lgbtqi.keywords).toContain('trans');
    });

    it('does not contain "autre" or "non vérifié" as a category', () => {
        const forbidden = ['autre', 'non-verifie', 'a-verifier', 'date-inconnue'];
        forbidden.forEach(slug => {
            expect(slugs).not.toContain(slug);
        });
    });
});

describe('CategoryChip - resolveCategory', () => {
    // We import dynamically since it's JSX
    let resolveCategory;
    let getAllCategories;

    beforeAll(async () => {
        const mod = await import('../../src/components/ui/CategoryChip.jsx');
        resolveCategory = mod.resolveCategory;
        getAllCategories = mod.getAllCategories;
    });

    it('resolves lgbtqi-plus', () => {
        const result = resolveCategory('lgbtqi-plus');
        expect(result).not.toBeNull();
        expect(result.label).toBe('LGBTQI+');
    });

    it('resolves lgbtqia via alias', () => {
        const result = resolveCategory('lgbtqia');
        expect(result).not.toBeNull();
        expect(result.slug).toBe('lgbtqi-plus');
    });

    it('resolves personnes-agees', () => {
        const result = resolveCategory('personnes-agees');
        expect(result).not.toBeNull();
        expect(result.label).toBe('Personnes âgées');
    });

    it('returns null for "autre"', () => {
        expect(resolveCategory('autre')).toBeNull();
    });

    it('returns null for null/undefined', () => {
        expect(resolveCategory(null)).toBeNull();
        expect(resolveCategory(undefined)).toBeNull();
        expect(resolveCategory('')).toBeNull();
    });

    it('getAllCategories returns 13 entries', () => {
        const cats = getAllCategories();
        expect(cats).toHaveLength(13);
        const lgbtqi = cats.find(c => c.slug === 'lgbtqi-plus');
        expect(lgbtqi).toBeTruthy();
    });
});
