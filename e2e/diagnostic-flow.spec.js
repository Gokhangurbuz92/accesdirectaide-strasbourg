import { test, expect } from './fixtures.js';

/**
 * E2E tests for the diagnostic flow (OpenFisca integration).
 *
 * These tests navigate through the 5-step wizard on /orientation,
 * mock the /api/diagnostic endpoint response, and verify:
 * - Wizard step progression
 * - Result cards rendering
 * - FALC toggle functionality
 * - CTA links to aides/demarches pages
 *
 * The API is mocked to ensure tests run in CI without OpenFisca dependency.
 */

// --- Mock responses for /api/diagnostic ---
// P16 overlay v1 (STRASBOURG_FULL_PRODUCT_PLAN/P16_WIZARD_OVERLAY_V1.md): the frozen version mocked the LEGACY shape (`rights[]` with amounts, « éligible »,
// « non applicables »). The real /api/diagnostic answers the assessment contract (SIMULATION_MODE: seven states, no amount, no eligibility), so the wizard showed
// « Aucun droit calculé » to real users while this suite passed. The mocks are now built by the product's own contract builder from the answers the wizard sends.
import { buildAssessment } from '../api/lib/assessmentContract.js';
import { UNSUPPORTED_RIGHTS } from '../api/lib/diagnosticAssessment.js';

const simulationResponse = (answers, requestId) => ({
    mode: 'SIMULATION_MODE',
    authoritative: false,
    period: '2026-02',
    assessment: buildAssessment({ answers, unsupportedRights: UNSUPPORTED_RIGHTS }),
    provenance: { source: 'local-rules-engine', engineVersion: 'qa', referenceDate: '2026-02-01', authoritative: false, dataStatus: 'UNVERIFIED' },
    meta: { source: 'local-rules-engine', engineVersion: 'qa', referenceDate: '2026-02-01', requestId },
});
// what the person must never be shown by a simulation (PRODUCT_FLOW_CONTRACT §2)
const FORBIDDEN = /€|\d+,\d{2}|droits auxquels|non applicable|vous avez droit|éligible|estimation totale/i;
// the real server issues the double-submit cookie on any GET; the mock backend does not, so it is set here exactly as in ws7-full-journey.spec.js
const CSRF = 'p16-e2e-csrf-token';
async function withCsrfCookie(page) { await page.context().addCookies([{ name: '__csrf', value: CSRF, url: test.info().project.use.baseURL }]); }
async function mockDiagnostic(page, requestId, sent) {
    await withCsrfCookie(page);
    await page.route('**/api/diagnostic', async (route) => {
        if (route.request().method() !== 'POST') return route.fulfill({ json: {} });
        const body = JSON.parse(route.request().postData() || '{}'); body.csrfHeader = route.request().headers()['x-csrf-token'] || null; sent.push(body);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(simulationResponse(body.answers || {}, requestId)) });
    });
    await page.route('**/api/assistant/recommendations', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }));
}

// --- Helper: fill wizard steps 1–4 (need, territory, profile, urgency) ---

async function fillWizardSteps1To4(page) {
    // Step 1: StepNeed — clicking a need button auto-advances (no Continue button)
    const needBtn = page.locator('button', { hasText: /logement/i }).first();
    await needBtn.waitFor({ state: 'visible', timeout: 10000 });
    await needBtn.click();

    // Step 2: StepTerritory — fill postal code and submit the form
    const territoryInput = page.locator('input[aria-label="Ville ou code postal"]');
    await territoryInput.waitFor({ state: 'visible', timeout: 5000 });
    await territoryInput.fill('67000');
    // Submit the form (button is type="submit")
    const submitBtn2 = page.locator('button[type="submit"]', { hasText: /continuer|passer/i });
    await submitBtn2.click();

    // Step 3: StepProfile — must select BOTH situation AND statut
    // Situation familiale radiogroup
    const situationRadio = page.locator('[role="radiogroup"][aria-label="Situation familiale"] button[role="radio"]').first();
    await situationRadio.waitFor({ state: 'visible', timeout: 5000 });
    await situationRadio.click();

    // Statut actuel radiogroup
    const statutRadio = page.locator('[role="radiogroup"][aria-label="Statut actuel"] button[role="radio"]').first();
    await statutRadio.waitFor({ state: 'visible', timeout: 5000 });
    await statutRadio.click();

    // Now "Continuer" should be enabled
    const continueBtn3 = page.locator('button', { hasText: /continuer/i });
    await expect(continueBtn3).toBeEnabled({ timeout: 3000 });
    await continueBtn3.click();

    // Step 4: StepUrgency — select urgency level
    const urgencyRadio = page.locator('[role="radiogroup"][aria-label*="urgence" i] button[role="radio"]').first();
    await urgencyRadio.waitFor({ state: 'visible', timeout: 5000 });
    await urgencyRadio.click();

    // P16 overlay: the button now says what it does (« Continuer » to the last step)
    const continueBtn4 = page.locator('button', { hasText: /^continuer$/i });
    await expect(continueBtn4).toBeEnabled({ timeout: 3000 });
    await continueBtn4.click();
}

// --- Helper: fill Step 5 (diagnostic data) ---

async function fillDiagnosticStep(page, { birthDate, salary, unemployment, rent, charges, housingStatus }) {
    // Birth date
    const dateInput = page.locator('#diag-birthdate');
    await dateInput.waitFor({ state: 'visible', timeout: 5000 });
    await dateInput.fill(birthDate);

    // Salary
    if (salary !== undefined) {
        await page.locator('#diag-salary').fill(String(salary));
    }

    // Unemployment
    if (unemployment !== undefined) {
        await page.locator('#diag-unemployment').fill(String(unemployment));
    }

    // Rent
    if (rent !== undefined) {
        await page.locator('#diag-rent').fill(String(rent));
    }

    // Charges
    if (charges !== undefined) {
        await page.locator('#diag-charges').fill(String(charges));
    }

    // Housing status — use exact matching to avoid 'Locataire' matching 'Locataire HLM'
    const housingBtn = page.getByRole('radio', { name: housingStatus, exact: true });
    await housingBtn.click();

    // Submit
    const submitBtn = page.locator('button', { hasText: /voir les pistes à vérifier/i });
    await submitBtn.click();
}

// ========================
// TEST SCENARIOS
// ========================

test.describe('Diagnostic Flow — OpenFisca Integration', () => {

    test('Scénario A — Célibataire sans revenus', async ({ page }) => {
        const sent = []; await mockDiagnostic(page, 'diag_test_001', sent);
        await page.goto('/orientation');
        await fillWizardSteps1To4(page);
        await fillDiagnosticStep(page, { birthDate: '1992-06-15', salary: 0, unemployment: 0, rent: 520, charges: 50, housingStatus: 'Locataire' });

        // the honest assessment is shown (before: « Aucun droit calculé »)
        await expect(page.getByTestId('assessment-item-rsa')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('assessment-state-rsa')).toHaveText(/À faire vérifier/);
        await expect(page.getByTestId('assessment-item-apl')).toBeVisible();
        // the request follows the /diagnostic contract: SIMULATION_MODE, explicit zeros kept, no free wizard fields
        expect(sent[0].mode).toBe('SIMULATION_MODE'); expect(sent[0].csrfHeader).toBe(CSRF);
        expect(sent[0].answers.income).toEqual({ salary: 0, unemployment: 0 });
        expect(sent[0].answers.territory).toBe('67000');
        expect(Object.keys(sent[0].answers)).not.toEqual(expect.arrayContaining(['need', 'urgency', 'options']));
        // « Pourquoi ce résultat ? » in FALC and standard, and the information page link
        await page.getByTestId('assessment-item-rsa').locator('summary').click();
        await expect(page.getByTestId('why-falc-rsa')).toContainText('En bref (facile à lire)');
        await expect(page.locator('a[href="/aides/rsa"]').first()).toBeVisible();
        expect(await page.getByTestId('diagnostic-results').innerText()).not.toMatch(FORBIDDEN);
    });

    test('Scénario B — Salarié', async ({ page }) => {
        const sent = []; await mockDiagnostic(page, 'diag_test_002', sent);
        await page.goto('/orientation');
        await fillWizardSteps1To4(page);
        await fillDiagnosticStep(page, { birthDate: '1985-03-20', salary: 1800, unemployment: '', rent: 750, charges: 100, housingStatus: 'Locataire' });

        await expect(page.getByTestId('assessment-item-rsa')).toBeVisible({ timeout: 10000 });
        expect(sent[0].answers.income).toEqual({ salary: 1800 });   // a blank amount is « not answered », never 0
        await expect(page.getByTestId('assessment-item-apl')).toBeVisible();
        expect(await page.getByTestId('diagnostic-results').innerText()).not.toMatch(FORBIDDEN);
    });

    test('Scénario C — Couple + enfants (V1 single adult, no crash)', async ({ page }) => {
        const sent = []; await mockDiagnostic(page, 'diag_test_003', sent);
        await page.goto('/orientation');
        await fillWizardSteps1To4(page);
        await page.locator('#diag-household').fill('');   // size unknown: left blank
        await fillDiagnosticStep(page, { birthDate: '1990-01-01', salary: '', unemployment: '', rent: '', charges: '', housingStatus: 'Locataire' });

        await expect(page.getByTestId('assessment-item-rsa')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('assessment-state-rsa')).toHaveText(/Informations manquantes/);
        await expect(page.getByTestId('assessment-item-rsa')).toContainText(/À préciser : .*composition du foyer/);
        expect(sent[0].answers.householdSize).toBeUndefined();
        await expect(page.locator('button', { hasText: /recommencer/i })).toBeVisible();
    });

    test('Gestion erreur — OpenFisca indisponible', async ({ page }) => {
        await withCsrfCookie(page);
        await page.route('**/api/diagnostic', async (route) => {
            if (route.request().method() === 'POST') {
                await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'OPENFISCA_UNAVAILABLE', message: 'raw server text must not be shown' }) });
            } else {
                await route.fulfill({ json: {} });
            }
        });
        await page.goto('/orientation');
        await fillWizardSteps1To4(page);
        await fillDiagnosticStep(page, { birthDate: '1992-06-15', salary: 0, unemployment: 0, rent: 520, charges: 50, housingStatus: 'Locataire' });

        const errorMsg = page.getByTestId('wizard-diagnostic-error');
        await expect(errorMsg).toContainText(/indisponible/i, { timeout: 10000 });
        await expect(errorMsg).not.toContainText('raw server text');
        await expect(page.locator('button', { hasText: /réessayer/i })).toBeVisible();
        await expect(page.locator('button', { hasText: /recommencer/i })).toBeVisible();
    });
});
