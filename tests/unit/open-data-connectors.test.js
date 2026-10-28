import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");


import { describe, it, expect } from 'vitest';
import { AidesTerritoiresConnector } from '../../api/lib/ingestion/AidesTerritoiresConnector.js';
import { DreesConnector } from '../../api/lib/ingestion/DreesConnector.js';

describe('Open Data Connectors (Phase 3)', () => {

    describe('AidesTerritoiresConnector', () => {
        const connector = new AidesTerritoiresConnector();

        it('should have correct name and baseUrl', () => {
            expect(connector.name).toBe('aides-territoires');
            expect(connector.baseUrl).toBe('https://aides-territoires.beta.gouv.fr');
        });

        it('should parse an API item correctly', async () => {
            const mockItem = {
                name: 'Aide à la mobilité durable',
                description: '<p>Cette aide finance les <strong>transports</strong> propres.</p>',
                url: 'https://aides-territoires.beta.gouv.fr/aides/mobilite-durable/',
                application_url: 'https://demarches.example.fr/mobilite',
                categories: ['transports'],
                date_updated: '2025-06-15T10:00:00Z',
                perimeter: 'Région Grand Est',
            };

            // Manually populate cache
            const virtualUrl = `${connector.baseUrl}/aides/mobilite-durable/`;
            connector._cache.set(virtualUrl, mockItem);

            const json = await connector.fetch(virtualUrl);
            const parsed = await connector.parse(json, virtualUrl);

            expect(parsed.title).toBe('Aide à la mobilité durable');
            expect(parsed.description).toContain('transports propres');
            expect(parsed.description).not.toContain('<p>');
            expect(parsed.source_url).toBe(mockItem.url);
            expect(parsed.apply_url).toBe(mockItem.application_url);
            expect(parsed.theme).toBe('transports');
            expect(parsed._territory_scope).toBe('REGIONAL');
            expect(parsed._source_last_modified).toBeInstanceOf(Date);
        });

        it('should strip HTML entities from description', async () => {
            const mockItem = {
                name: 'Test aide',
                description: 'L&rsquo;aide &amp; le &quot;dispositif&quot;',
                url: 'https://example.com',
            };
            const virtualUrl = 'https://example.com/test';
            connector._cache.set(virtualUrl, mockItem);
            const json = await connector.fetch(virtualUrl);
            const parsed = await connector.parse(json, virtualUrl);
            expect(parsed.description).not.toContain('&amp;');
        });

        it('should map perimeters correctly', () => {
            expect(connector._mapPerimeter(null)).toBe('NATIONAL');
            expect(connector._mapPerimeter('France entière')).toBe('NATIONAL');
            expect(connector._mapPerimeter('Région Grand Est')).toBe('REGIONAL');
            expect(connector._mapPerimeter('Département du Bas-Rhin')).toBe('DEPARTMENTAL');
            expect(connector._mapPerimeter('Commune de Strasbourg')).toBe('COMMUNAL');
        });

        it('should generate stable IDs', () => {
            const id = connector.getStableId({ source_url: 'https://test.fr/aide' });
            expect(id).toHaveLength(32);
            // Same URL = same ID
            const id2 = connector.getStableId({ source_url: 'https://test.fr/aide' });
            expect(id).toBe(id2);
        });
    });

    describe('DreesConnector', () => {
        const connector = new DreesConnector();

        it('should have correct name', () => {
            expect(connector.name).toBe('drees');
        });

        it('should return curated aide URLs', async () => {
            const urls = await connector.getDetailUrls();
            expect(urls.length).toBeGreaterThanOrEqual(5);
            expect(urls).toContain('https://www.service-public.fr/particuliers/vosdroits/F10009');
            expect(urls).toContain('https://www.service-public.fr/particuliers/vosdroits/F14202');
        });

        it('should parse APA aide correctly', async () => {
            const urls = await connector.getDetailUrls();
            const apaUrl = urls.find(u => u.includes('F10009'));
            const json = await connector.fetch(apaUrl);
            const parsed = await connector.parse(json, apaUrl);

            expect(parsed.title).toContain('APA');
            expect(parsed.theme).toBe('personnes-agees');
            expect(parsed._territory_scope).toBe('NATIONAL');
            expect(parsed.apply_url).toBeTruthy();
        });

        it('should parse PCH aide correctly', async () => {
            const urls = await connector.getDetailUrls();
            const pchUrl = urls.find(u => u.includes('F14202'));
            const json = await connector.fetch(pchUrl);
            const parsed = await connector.parse(json, pchUrl);

            expect(parsed.title).toContain('PCH');
            expect(parsed.theme).toBe('handicap');
        });

        it('should throw for unknown URL', async () => {
            await connector.getDetailUrls();
            await expect(connector.fetch('https://unknown.example.com'))
                .rejects.toThrow('No cached item');
        });
    });
});
