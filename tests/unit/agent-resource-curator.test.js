import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { INITIAL_RESOURCES } from '../../api/lib/seed-resources.js';
import {
    ResourceCurator,
    CURATOR_SYSTEM_PROMPT,
    ALLOWED_DOMAINS,
    RESOURCE_TYPES,
} from '../../api/lib/agents/resource-curator.js';

describe('Resource Curator Agent', () => {
    it('module exists', () => {
        expect(existsSync('api/lib/agents/resource-curator.js')).toBe(true);
    });

    it('exports ResourceCurator class', () => {
        const c = new ResourceCurator({});
        expect(c.name).toBe('resource-curator');
    });

    it('has system prompt', () => {
        expect(CURATOR_SYSTEM_PROMPT).toBeDefined();
        expect(CURATOR_SYSTEM_PROMPT.length).toBeGreaterThan(100);
    });

    it('prompt mentions official sources only', () => {
        expect(CURATOR_SYSTEM_PROMPT).toMatch(/gouv\.fr/);
        expect(CURATOR_SYSTEM_PROMPT).toMatch(/JAMAIS/);
    });

    it('has allowed domains whitelist', () => {
        expect(ALLOWED_DOMAINS.length).toBeGreaterThanOrEqual(5);
        expect(ALLOWED_DOMAINS).toContain('gouv.fr');
        expect(ALLOWED_DOMAINS).toContain('caf.fr');
        expect(ALLOWED_DOMAINS).toContain('ameli.fr');
    });

    it('has 4 resource types', () => {
        expect(RESOURCE_TYPES).toContain('RESSOURCE');
        expect(RESOURCE_TYPES).toContain('BONNE_PRATIQUE');
        expect(RESOURCE_TYPES).toContain('OUTIL');
        expect(RESOURCE_TYPES).toContain('DISPOSITIF');
    });

    it('isAllowedSource validates domains', () => {
        const c = new ResourceCurator({});
        expect(c.isAllowedSource('https://www.service-public.fr/foo')).toBe(true);
        expect(c.isAllowedSource('https://www.caf.fr/bar')).toBe(true);
        expect(c.isAllowedSource('https://www.random-blog.com/bar')).toBe(false);
        expect(c.isAllowedSource(null)).toBe(false);
    });
});

describe('Seed Resources', () => {
    it('has 12+ initial resources', () => {
        expect(INITIAL_RESOURCES.length).toBeGreaterThanOrEqual(12);
    });

    it('all resources have required fields', () => {
        INITIAL_RESOURCES.forEach(r => {
            expect(r.type).toBeDefined();
            expect(r.category).toBeDefined();
            expect(r.title).toBeDefined();
            expect(r.description).toBeDefined();
            expect(r.source).toBeDefined();
        });
    });

    it('all URLs are official sources', () => {
        INITIAL_RESOURCES
            .filter(r => r.url)
            .forEach(r => {
                expect(r.url).toMatch(/gouv\.fr|service-public|caf\.fr|ameli\.fr|francetravail/);
            });
    });

    it('has all 4 types', () => {
        const types = [...new Set(INITIAL_RESOURCES.map(r => r.type))];
        expect(types).toContain('RESSOURCE');
        expect(types).toContain('OUTIL');
        expect(types).toContain('DISPOSITIF');
        expect(types).toContain('BONNE_PRATIQUE');
    });

    it('bonnes pratiques have content field', () => {
        const bp = INITIAL_RESOURCES.filter(r => r.type === 'BONNE_PRATIQUE');
        expect(bp.length).toBeGreaterThanOrEqual(1);
        bp.forEach(r => {
            expect(r.content).toBeDefined();
            expect(r.content.length).toBeGreaterThan(10);
        });
    });
});
