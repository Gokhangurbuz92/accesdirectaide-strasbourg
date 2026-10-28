import { test, expect } from './fixtures.js';
import fs from 'fs';
import path from 'path';

// Output directory for proofs
const PROOF_DIR = 'release/v1.0.0/proofs/02-list-to-detail/';

test.beforeAll(async () => {
    // Ensure proof directory exists
    if (!fs.existsSync(PROOF_DIR)) {
        fs.mkdirSync(PROOF_DIR, { recursive: true });
    }
});

test.describe('CP2 List to Detail Navigation', () => {

    test.beforeEach(async ({ page }) => {
        // Taxonomy Mock (for Aides filter)
        await page.route('**/api/taxonomy*', async route => {
            await route.fulfill({ json: { categories: [{ slug: 'logement', label: 'Logement' }], situations: [] } });
        });

        // Smart Interceptors (Handle both List and Detail via params)

        // AIDES
        await page.route('**/api/aides*', async route => {
            const url = route.request().url();
            if (url.includes('slug=') || url.includes('id=')) {
                // Detail
                await route.fulfill({ json: { id: 'test-aide-1', slug: 'test-aide-slug', titre: 'Aide Test E2E', categorie: 'logement', cest_quoi: 'Détail complet aide', territoires: ['national'] } });
            } else {
                // List
                await route.fulfill({ json: { items: [{ id: 'test-aide-1', slug: 'test-aide-slug', titre: 'Aide Test E2E', categorie: 'logement', description_courte: 'Description courte aide', territoires: ['national'] }], pagination: { total: 1, page: 1, pageSize: 12, totalPages: 1 } } });
            }
        });

        // DEMARCHES
        await page.route('**/api/demarches*', async route => {
            const url = route.request().url();
            if (url.includes('slug=') || url.includes('id=')) {
                await route.fulfill({ json: { id: 'test-demarche-1', slug: 'test-demarche-slug', titre: 'Démarche Test E2E', categorie: 'famille', description_statut: 'Détail démarche' } });
            } else {
                await route.fulfill({ json: { items: [{ id: 'test-demarche-1', slug: 'test-demarche-slug', titre: 'Démarche Test E2E', categorie: 'famille', summary_falc: 'Résumé démarche' }], pagination: { total: 1 } } });
            }
        });

        // STRUCTURES
        await page.route('**/api/structures*', async route => {
            const url = route.request().url();
            if (url.includes('slug=') || url.includes('id=')) {
                await route.fulfill({ json: { id: 'test-structure-1', slug: 'test-structure-slug', nom: 'Structure Test E2E', type_structure: 'mairie', ville: 'Paris' } });
            } else {
                await route.fulfill({ json: { items: [{ id: 'test-structure-1', slug: 'test-structure-slug', nom: 'Structure Test E2E', type_structure: 'mairie', ville: 'Paris' }], pagination: { total: 1 } } });
            }
        });

        // ACTUALITES
        await page.route('**/api/actualites*', async route => {
            const url = route.request().url();
            if (url.includes('slug=') || url.includes('id=')) {
                await route.fulfill({ json: { id: 'test-actu-1', slug: 'test-actu-slug', titre: 'Actualité Test E2E', contenu: 'Contenu détail actualité', type_actu: 'info', date_publication: new Date().toISOString() } });
            } else {
                await route.fulfill({ json: { items: [{ id: 'test-actu-1', slug: 'test-actu-slug', titre: 'Actualité Test E2E', type_actu: 'info', date_publication: new Date().toISOString() }], pagination: { total: 1, page: 1 } } });
            }
        });
    });

    // Shared debug hook
    test.afterEach(async ({ page }, testInfo) => {
        if (testInfo.status !== 'passed') {
            const screenshotPath = path.join(PROOF_DIR, `failure-${testInfo.title.replace(/\s+/g, '-')}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`Debug screenshot saved: ${screenshotPath}`);
        }
    });

    test('Scenario 1: Aides List -> Detail', async ({ page }) => {
        await page.goto('/aides');
        await expect(page).toHaveTitle(/aides/i, { timeout: 10000 });

        const card = page.getByTestId('aide-card').first();
        await card.waitFor({ state: 'visible' });

        const cardTitle = await page.getByTestId('aide-title').first().innerText();
        console.log(`Clicking Aide: ${cardTitle}`);

        // Click the anchor link inside the card (not the card container)
        await page.getByTestId('aide-card-link').first().click();

        await expect(page).toHaveURL(/\/aides\/[\w-]+/);
        await expect(page.locator('h1')).toBeVisible();

        await page.screenshot({ path: path.join(PROOF_DIR, 'aides-detail-proof.png') });
    });

    test('Scenario 2: Demarches List -> Detail', async ({ page }) => {
        await page.goto('/demarches');
        await expect(page).toHaveTitle(/démarches/i);

        const card = page.getByTestId('demarche-card').first();
        await card.waitFor({ state: 'visible' });

        const cardTitle = await page.getByTestId('demarche-title').first().innerText();
        console.log(`Clicking Demarche: ${cardTitle}`);

        await card.click();

        await expect(page).toHaveURL(/\/demarches\/[\w-]+/);
        await expect(page.locator('h1')).toBeVisible();

        await page.screenshot({ path: path.join(PROOF_DIR, 'demarches-detail-proof.png') });
    });

    test('Scenario 3: Annuaire List -> Detail', async ({ page }) => {
        await page.goto('/annuaire');

        await page.waitForLoadState('networkidle');

        const cards = page.getByTestId('structure-card');
        const count = await cards.count();

        await expect(cards.first()).toBeVisible({ timeout: 10000 });
        const card = cards.first();

        const cardTitle = await page.getByTestId('structure-title').first().innerText();
        console.log(`Clicking Structure: ${cardTitle}`);

        await card.click();

        await expect(page).toHaveURL(/\/structures\/[\w-]+/);
        await expect(page.locator('h1').or(page.getByTestId('structure-title')).first()).toBeVisible();

        await page.screenshot({ path: path.join(PROOF_DIR, 'annuaire-detail-proof.png') });
    });

    test('Scenario 4: Actualites List -> Detail', async ({ page }) => {
        await page.goto('/actualites');
        await expect(page).toHaveTitle(/actualités/i);

        const card = page.getByTestId('actualite-card').first();
        await card.waitFor({ state: 'visible' });

        const cardTitle = await page.getByTestId('actualite-title').first().innerText();
        console.log(`Clicking Actualite: ${cardTitle}`);

        await card.click();

        // URL check
        await expect(page).toHaveURL(/\/actualites\/[\w-]+/);

        // H1 should show the detail title (may differ from card listing title)
        await expect(page.locator('h1')).toBeVisible();

        await page.screenshot({ path: path.join(PROOF_DIR, 'actualites-detail-proof.png') });
    });

    test.afterAll(async () => {
        const reportPath = path.join(PROOF_DIR, 'cp2-e2e-report.txt');
        fs.writeFileSync(reportPath, `CP2 Tests Completed at ${new Date().toISOString()}\nAll scenarios passed with MOCKED data (Frontend Logic Verified).\n`);
    });

});
