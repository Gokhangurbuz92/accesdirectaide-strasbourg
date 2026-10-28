import { test, expect } from './fixtures.js';
import { setupPublicMocks } from './_mocks/publicApiMocks';

test.describe('Public Core Routes', () => {
    test.beforeEach(async ({ page }) => {
        await setupPublicMocks(page);
    });

    test('Aides Flow: List -> Detail -> Refresh', async ({ page }) => {
        // 1. List
        await page.goto('/aides');
        await expect(page.getByRole('heading', { name: 'Aides', level: 1 })).toBeVisible();

        // 2. Click Detail
        // We look for a link or card containing the text.
        await page.getByRole('link', { name: /Aide Test/ }).first().click({ force: true });

        // 3. Check Detail
        await expect(page).toHaveURL(/\/aides\/aide-test/);
        await expect(page.getByRole('heading', { name: 'Aide Test', level: 1 })).toBeVisible();

        // 4. Refresh
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Aide Test', level: 1 })).toBeVisible();
    });

    test('Demarches Flow: List -> Detail -> Refresh', async ({ page }) => {
        // 1. List
        await page.goto('/demarches');
        await expect(page.getByRole('heading', { name: 'Démarches', level: 1 })).toBeVisible();

        // 2. Click Detail
        await page.getByRole('link', { name: /Demander le RSA/ }).first().click({ force: true });

        // 3. Check Detail
        await expect(page).toHaveURL(/\/demarches\/demarche-test/);
        await expect(page.getByRole('heading', { name: 'Demander le RSA', level: 1 })).toBeVisible();

        // 4. Refresh
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Demander le RSA', level: 1 })).toBeVisible();
    });

    test('Structures (Annuaire) Flow: List -> Detail -> Refresh', async ({ page }) => {
        // 1. List
        await page.goto('/annuaire');
        await expect(page.getByRole('heading', { name: 'Annuaire', level: 1 })).toBeVisible({ timeout: 15_000 });

        // 2. Click Detail
        // Use dispatchEvent to bypass potential overlay issues with the card link pattern
        await page.getByRole('link', { name: /Structure Test/ }).first().dispatchEvent('click');

        // 3. Check Detail
        await expect(page).toHaveURL(/\/structures\/structure-test/);
        await expect(page.getByRole('heading', { name: 'Structure Test', level: 1 })).toBeVisible();

        // 4. Refresh
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Structure Test', level: 1 })).toBeVisible();
    });

    test('Actualites Flow: List -> Detail -> Refresh', async ({ page }) => {
        // 1. List
        await page.goto('/actualites');
        await expect(page.getByRole('heading', { name: 'Actualités', level: 1 })).toBeVisible();

        // 2. Click Detail
        await page.getByRole('link', { name: /Actualité Test/ }).first().click({ force: true });

        // 3. Check Detail
        await expect(page).toHaveURL(/\/actualites\/actu-test/);
        await expect(page.getByRole('heading', { name: 'Actualité Test', level: 1 })).toBeVisible();

        // 4. Refresh
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Actualité Test', level: 1 })).toBeVisible();
    });
});
