import { test, expect } from './fixtures.js';

/**
 * SMOKE TEST CRITIQUE : Détection écran blanc
 * 
 * Ce test minimal vérifie que la home page se charge sans erreur fatale.
 * Il échoue si :
 * - Une erreur runtime survient (ex: Cannot read properties of undefined)
 * - La page reste blanche (aucun élément clé visible)
 * - Une erreur console fatale est détectée
 * 
 * Objectif : éviter la régression "écran blanc en production"
 */

test.describe('Smoke Test - Home Page', () => {

  test('Home page loads without white screen or runtime errors', async ({ page }) => {
    // Capturer les erreurs de page (uncaught exceptions)
    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    // Capturer les erreurs console critiques
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Naviguer vers la home
    await page.goto('/');

    // Vérifier qu'un élément clé de la home est visible
    // (header, titre principal, ou navigation)
    await expect(page.locator('header, nav, h1, [role="banner"]').first()).toBeVisible({
      timeout: 10000
    });

    // Vérifier qu'aucune erreur fatale n'est survenue
    expect(pageErrors, `Page errors detected: ${pageErrors.join(', ')}`).toHaveLength(0);

    // Vérifier qu'aucune erreur console critique liée à React/undefined n'est survenue
    const criticalErrors = consoleErrors.filter(err =>
      err.includes('undefined') ||
      err.includes('useLayoutEffect') ||
      err.includes('useMergeRef')
    );
    expect(criticalErrors, `Critical console errors: ${criticalErrors.join(', ')}`).toHaveLength(0);
  });

  test('Home page renders main content', async ({ page }) => {
    await page.goto('/');

    // Vérifier que le contenu principal est présent (pas juste le header)
    // Attendre qu'au moins un élément de contenu soit visible
    await expect(page.locator('main, [role="main"], article, section, .max-w-7xl').first()).toBeVisible({
      timeout: 15000
    });
  });

});
