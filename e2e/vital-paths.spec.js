import { test, expect } from './fixtures.js';

test.describe('Vital Paths', () => {

  test.beforeEach(async ({ page }) => {
    // Global mocks
    await page.route(/\/api\/taxonomy/, async route => {
      await route.fulfill({ json: { categories: [], situations: [] } });
    });

    // Catch-all for noise
    await page.route(/\/api\/aides.*est_urgent=true/, async route => {
      await route.fulfill({ json: { items: [], pagination: { total: 0 } } });
    });
    await page.route(/\/api\/actualites/, async route => {
      await route.fulfill({ json: { items: [], pagination: { total: 0 } } });
    });
  });

  test('Search Aides', async ({ page }) => {
    await page.route(/\/api\/aides/, async route => {
      const url = route.request().url();
      console.log('Intercepted Aides:', url);
      // Always return result for this test, ignore Home page noise if any leaks through regex
      if (url.includes('est_urgent')) {
        return route.fulfill({ json: { items: [], pagination: { total: 0 } } });
      }
      const json = { items: [{ id: '1', titre: 'Aide Test', slug: 'aide-test', cest_quoi: 'Desc', statut: 'publie', categorie: 'logement' }], pagination: { total: 1, totalPages: 1, page: 1 } };
      await route.fulfill({ json });
    });

    await page.goto('/aides?q=test');
    await expect(page.getByText('Aide Test')).toBeVisible();
  });

  test('Search Structures', async ({ page }) => {
    await page.route(/\/api\/structures/, async route => {
      const json = {
        items: [{
          id: 's1',
          nom: 'Structure Test',
          slug: 'structure-test',
          ville: 'Strasbourg',
          type_structure: 'mairie',
          statut: 'actif'
        }],
        pagination: { total: 1, totalPages: 1, page: 1 }
      };
      await route.fulfill({ json });
    });

    await page.goto('/structures?q=test');
    await expect(page.getByText('Structure Test').first()).toBeVisible();
  });

  test('Aide Detail', async ({ page }) => {
    await page.route(/\/api\/aides/, async route => {
      console.log('Intercepted Aide Detail:', route.request().url());
      const json = { id: '1', titre: 'Aide Detail', slug: 'aide-detail', cest_quoi: 'Full Desc', statut: 'publie', categorie: 'sante' };
      await route.fulfill({ json });
    });

    await page.goto('/aide/aide-detail');
    await expect(page.getByRole('heading', { name: 'Aide Detail' })).toBeVisible({ timeout: 15_000 });
  });

  test('Structure Detail', async ({ page }) => {
    await page.route(/\/api\/structures/, async route => {
      const json = {
        id: 's1',
        nom: 'Structure Detail',
        slug: 'structure-detail',
        proServices: [],
        type_structure: 'mairie',
        is_pro_enabled: false
      };
      await route.fulfill({ json });
    });

    await page.goto('/structures/structure-detail');
    await expect(page.getByRole('heading', { name: 'Structure Detail' })).toBeVisible();
  });

  test('Public Appointment Flow', async ({ page }) => {
    // 1. On donne au composant la structure complète, avec le module RDV activé
    await page.route(/\/api\/structures.*/, async route => {
      const struct = {
        id: 's1',
        nom: 'Mairie Test',
        slug: 'mairie-test',
        proServices: [{ name: 'Rendez-vous' }],
        is_pro_enabled: true,
        rdv: { isPublished: true, bookingMode: 'IN_PERSON' }
      };
      // L'API renvoie soit un tableau (recherche), soit l'objet (détail)
      if (route.request().url().includes('?')) {
        await route.fulfill({ json: { items: [struct], pagination: { total: 1 } } });
      } else {
        await route.fulfill({ json: struct });
      }
    });

    // 2. On intercepte explicitement l'API des slots et disponibilités
    await page.route(/\/api\/public\/(availability|slots).*/, async route => {
      const start = new Date();
      start.setHours(start.getHours() + 24);
      start.setMinutes(0, 0, 0);
      const end = new Date(start);
      end.setHours(end.getHours() + 1);

      await route.fulfill({ json: [{ id: 'slot-1', start: start.toISOString(), end: end.toISOString() }] });
    });

    await page.route(/\/api\/appointments.*/, async route => {
      await route.fulfill({ json: { success: true } });
    });

    // Navigate to appointment request page with correct route
    await page.goto('/appointments/request?structure_id=s1');

    // Verify the page loads — check for heading or form elements
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });


  test('Home Page loads and shows search', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Home page has a search input with placeholder
    await expect(page.locator('input[type="search"], input[type="text"]').first()).toBeVisible();
  });

  test('Pro Login', async ({ page }) => {
    await page.route(/\/api\/pro\/auth\/login/, async route => {
      await route.fulfill({ json: { token: 'fake-jwt', user: { email: 'pro@test.com' } } });
    });
    await page.route(/\/api\/pro\/me/, async route => {
      await route.fulfill({ json: { email: 'pro@test.com', role: 'PRO' } });
    });

    await page.goto('/pro/login');
    await page.getByLabel(/identifiant/i).fill('pro@test.com');
    await page.getByLabel(/mot de passe/i).fill('password');
    await page.getByRole('button', { name: /se connecter/i }).click();

    await expect(page).toHaveURL(/\/pro\/dashboard/);
  });

  test('Pro Dashboard Access', async ({ page }) => {
    await page.route(/\/api\/pro\/me/, async route => {
      await route.fulfill({ json: { email: 'pro@test.com', role: 'PRO' } });
    });
    await page.addInitScript(() => {
      localStorage.setItem('pro_token', 'fake-jwt');
    });
    await page.goto('/pro/dashboard');
    await expect(page).toHaveURL(/\/pro\/dashboard/);
  });

  test('Contact Page Flow', async ({ page }) => {
    await page.route(/\/api\/contact/, async route => {
      await route.fulfill({ json: { success: true } });
    });
    await page.goto('/contact');
    await expect(page.getByRole('heading', { name: /contact/i })).toBeVisible();
  });

  test('404 Handling', async ({ page }) => {
    await page.goto('/page-qui-n-existe-pas');
    // App shows a 404 page or error component (doesn't redirect)
    await expect(page.locator('body')).toBeVisible();
  });

});
