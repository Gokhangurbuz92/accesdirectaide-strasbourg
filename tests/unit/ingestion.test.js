import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");


import { describe, it, expect } from 'vitest';
import { GrandEstConnector } from '../../api/lib/ingestion/GrandEstConnector.js';
import { AgefiphConnector } from '../../api/lib/ingestion/AgefiphConnector.js';

describe('Ingestion Connectors', () => {

    describe('GrandEstConnector', () => {
        const connector = new GrandEstConnector();
        const mockHtml = `
            <html>
                <body>
                    <h1>Aide au permis de conduire</h1>
                    <p>Cette aide permet de financer le permis pour les jeunes.</p>
                    <a href="/demande-permis" class="btn">Faire la demande en ligne</a>
                </body>
            </html>
        `;
        const mockUrl = 'https://www.grandest.fr/aides/permis';

        it('should extract title correctly', async () => {
            const item = await connector.parse(mockHtml, mockUrl);
            expect(item.title).toBe('Aide au permis de conduire');
        });

        it('should detect apply_url', async () => {
            const item = await connector.parse(mockHtml, mockUrl);
            expect(item.apply_url).toBe('https://www.grandest.fr/demande-permis');
        });

        it('should map theme based on keywords', async () => {
            const item = await connector.parse(mockHtml, mockUrl);
            // "permis" should match Transports
            expect(item.theme).toBe('transports');
        });

        it('should extract relative URLs from listing', async () => {
            const mockListing = `<html><a href="/vos-aides-regionales/relative" class="card aide">Relative</a><a href="https://www.grandest.fr/appel-a-projet/absolute" class="card aide">Absolute</a></html>`;

            // Mock global fetch so the module-level fetchHtml returns our HTML
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                status: 200,
                text: async () => mockListing,
            });

            try {
                const urls = await connector.getDetailUrls();
                expect(urls).toContain('https://www.grandest.fr/vos-aides-regionales/relative');
                expect(urls).toContain('https://www.grandest.fr/appel-a-projet/absolute');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });

    describe('AgefiphConnector', () => {
        const connector = new AgefiphConnector();
        const mockHtml = `
            <html>
                <body>
                    <h1>Aide à la création d'entreprise</h1>
                    <p>Pour les personnes handicapées souhaitant créer leur entreprise.</p>
                    <a href="https://services.agefiph.fr/demande">Déposer une demande</a>
                </body>
            </html>
        `;
        const mockUrl = 'https://www.agefiph.fr/aides/creation';

        it('should extract title correctly', async () => {
            const item = await connector.parse(mockHtml, mockUrl);
            expect(item.title).toBe("Aide à la création d'entreprise");
        });

        it('should detect apply_url', async () => {
            const item = await connector.parse(mockHtml, mockUrl);
            expect(item.apply_url).toBe('https://services.agefiph.fr/demande');
        });

        it('should map theme (Handicap/Travail implies Travail-Formation or Social-Sante)', async () => {
            const item = await connector.parse(mockHtml, mockUrl);
            // Default logic might pick travail-formation or entreprises or social-sante depending on keywords
            // "entreprise" -> Entreprises or Travail-Formation
            // "handicap" -> Social-Santé
            // My keyword list for Social-Santé includes "handicap".
            // My keyword list for Entreprises includes "création".
            // The logic takes the FIRST match in taxonomy list.
            // Let's check taxonomy order: Famille, Social-Sante, Travail-Formation... Entreprises is last.
            // So "handicap" in Social-Santé should hit first.
            expect(item.theme).toBe('handicap');
        });
    });
});
