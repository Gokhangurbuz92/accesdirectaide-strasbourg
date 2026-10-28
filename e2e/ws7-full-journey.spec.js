import { test, expect } from '@playwright/test';
import { isWs8AllowedNetworkUrl } from '../tests/helpers/ws8-strict-offline.js';

test('WS7 Strasbourg diagnostic to confirmed appointment journey', async ({ page }) => {
  const remoteRequests = [];

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (isWs8AllowedNetworkUrl(url)) {
      await route.continue();
    } else {
      remoteRequests.push(url);
      await route.abort();
    }
  });

  // DTA S1E: since S1D the diagnostic POST goes through csrfFetch, which REQUIRES the double-submit cookie (the real server issues it on any GET, e.g. /api/health) and never sends a protected
  // POST without the header.  This mock harness has no backend to issue it, so the test models a browser that already holds the server-issued cookie, and asserts that the product sends it.
  // (The cold-start bootstrap itself is covered by the real-browser DTA-B suite and by tests/unit/dta-s1c-csrf-bootstrap.test.jsx.)
  const CSRF = 'ws7-e2e-csrf-token';
  await page.context().addCookies([{ name: '__csrf', value: CSRF, url: test.info().project.use.baseURL }]);
  let diagnosticCsrfHeader = null;

  await page.route('**/api/diagnostic', async (route) => {
    diagnosticCsrfHeader = route.request().headers()['x-csrf-token'] || null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        // DTA S1 2b: the diagnostic now answers with the assessment contract (state + provenance, no eligible flag, no amount).
        assessment: {
          contract: 'ADA_ASSESSMENT_CONTRACT_V1', authoritative: false, leadsEnabled: false, dataStatus: 'UNVERIFIED', referenceDate: null, totals: null,
          items: [{
            code: 'aide-test-strasbourg', label: 'Aide test Strasbourg', state: 'CHECK_REQUIRED', authoritative: false, amount: null, amountStatus: 'NOT_PROVIDED_NO_AUTHORITY',
            missingFacts: [], whoToAsk: 'votre CAF',
            explanation: 'Ceci est une pré-orientation indicative : ce n\'est ni une réponse ni un refus. Faites vérifier votre situation auprès de votre CAF.',
            explanationFalc: 'Ce résultat n\'est pas une décision. Demandez à votre CAF de regarder votre situation.',
            provenance: { source: null, verifiedAt: null, territory: null, rule: null, uncertainty: 'ORIENTATION_NON_OFFICIELLE', display: {
              source: 'Source : aucune — simulation locale, pas une source officielle', verifiedAt: 'Vérifié le : non vérifié', territory: 'Territoire : non précisé',
              rule: 'Règle : aucune règle officielle appliquée (repère indicatif local)', uncertainty: 'Incertitude : ORIENTATION_NON_OFFICIELLE' } },
          }],
        },
        provenance: { source: 'local-rules-engine', engineVersion: 'ws3-local-rules-v1', referenceDate: '2026-09-01', authoritative: false, dataStatus: 'UNVERIFIED' },
        period: '2026-09',
        meta: { requestId: 'ws7-e2e', duration_ms: 5 },
      }),
    });
  });

  const jsonRoute = (matches, body, status = 200) =>
    page.route((url) => matches(url), async (route) => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });

  // Authentic verified citizen session: PublicBookingAccessGate still classifies it via /api/auth/me.
  await jsonRoute((url) => url.pathname === '/api/auth/me', {
    session: { kind: 'user' },
    user: { id: 'user-ws7', emailVerified: true },
  });

  await jsonRoute((url) => url.pathname === '/api/aides/aide-test-strasbourg', {
    id: 'aide-test-strasbourg-id',
    slug: 'aide-test-strasbourg',
    titre: 'Aide test Strasbourg',
    categorie: 'logement',
    cest_quoi: 'Aide de test pour le parcours WS7.',
  });

  await jsonRoute((url) => url.pathname === '/api/structures', {
    items: [
      {
        id: 'structure-ccas-strasbourg',
        slug: 'ccas-strasbourg',
        nom: 'CCAS Strasbourg',
        ville: 'Strasbourg',
        categories_aidees: ['logement'],
      },
    ],
  });

  await jsonRoute((url) => url.pathname === '/api/rdv/structures/ccas-strasbourg/slots', {
    days: [{ date: '2030-01-10', slots: [{ startAt: '2030-01-10T09:00:00.000Z' }] }],
  });

  await page.route('**/api/rdv/structures/ccas-strasbourg/services', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        structure: {
          slug: 'ccas-strasbourg',
          name: 'CCAS Strasbourg',
          bookingMode: 'IN_PERSON',
        },
        items: [
          {
            id: 'service-social',
            name: 'Accompagnement social',
            durationMinutes: 30,
          },
        ],
      }),
    });
  });


  await page.route('**/api/rdv/appointments', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'appointment-ws7-12345678',
        status: 'CONFIRMED',
        startsAt: '2030-01-10T09:00:00.000Z',
        endsAt: '2030-01-10T09:30:00.000Z',
        calendar: {
          filename: 'acces-direct-aide-rdv.ics',
          contentType: 'text/calendar; charset=utf-8',
          content: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n',
        },
      }),
    });
  });

  await page.goto('/diagnostic');
  await page.locator('#diag-birthdate').fill('1992-02-03');
  await page.getByRole('radio', { name: 'Locataire', exact: true }).click();
  await page.locator('#diag-zip').fill('67000');
  await page.locator('#diag-calculate-btn').click();

  // DTA S2B: since S2A the aide name ALSO appears in the plan d'action (step sentence, details, information link), so the bare text matched 4 elements (strict-mode violation, native run 95f97e).
  // The assertion keeps its intent (the diagnostic result shows this aide) but targets the result card itself.
  await expect(page.getByTestId('assessment-item-aide-test-strasbourg').getByText('Aide test Strasbourg', { exact: true })).toBeVisible();
  await expect(page.getByTestId('action-plan')).toContainText('Aide test Strasbourg');   // and the plan d'action built from the same state mentions it
  expect(diagnosticCsrfHeader, 'the diagnostic POST carries the double-submit header equal to the cookie').toBe(CSRF);

  await page.getByTestId(/^diagnostic-open-aide-/).first().click();
  await page.getByTestId(/^aide-booking-/).first().click();

  await page.getByRole('button', { name: /Accompagnement social/ }).click();
  await page.getByTestId('booking-slot').first().click();
  await page.getByTestId('booking-confirm').click();

  await expect(page.getByTestId('booking-success')).toBeVisible();
  await expect(page.getByTestId('booking-download-ics')).toBeVisible();
  await expect(page.getByTestId('booking-return-to-journey')).toHaveAttribute(
    'href',
    '/aides/aide-test-strasbourg',
  );

  expect(remoteRequests, 'WS8 strict-offline journey gate detected remote requests').toEqual([]);
});
