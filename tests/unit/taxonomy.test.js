import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");


import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Taxonomy Data', () => {
    const taxonomyPath = path.join(process.cwd(), 'api/data/taxonomy.json');

    it('should exist', () => {
        expect(fs.existsSync(taxonomyPath)).toBe(true);
    });

    it('should be valid JSON and follow the schema', () => {
        const content = fs.readFileSync(taxonomyPath, 'utf-8');
        const data = JSON.parse(content);

        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);

        data.forEach(item => {
            expect(item).toHaveProperty('slug');
            expect(item).toHaveProperty('label');
            expect(item).toHaveProperty('keywords');
            expect(Array.isArray(item.keywords)).toBe(true);
            expect(item).toHaveProperty('sub_themes');
            expect(Array.isArray(item.sub_themes)).toBe(true);

            item.sub_themes.forEach(sub => {
                expect(sub).toHaveProperty('slug');
                expect(sub).toHaveProperty('label');
            });
        });
    });

    it('should have unique slugs', () => {
        const content = fs.readFileSync(taxonomyPath, 'utf-8');
        const data = JSON.parse(content);
        const slugs = data.map(i => i.slug);
        const uniqueSlugs = new Set(slugs);
        expect(slugs.length).toBe(uniqueSlugs.size);
    });
});
