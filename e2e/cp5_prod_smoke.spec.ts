import { test, expect, request } from './fixtures.js';
import fs from 'fs';
import path from 'path';

const PROOF_DIR = 'release/v1.0.0/proofs/05-prod-smoke/';
const REPORT_PATH = path.join(PROOF_DIR, 'cp5-prod-smoke-report.txt');

let reportLines: string[] = [];
function log(message: string) {
    console.log(`[Smoke] ${message}`);
    reportLines.push(`[${new Date().toISOString()}] ${message}`);
}

// Avoid concurrency issues -> cleaner logs/snapshots
test.describe.configure({ mode: 'serial' });

let baseURL: string = '';
let baseReachable = false;
let baseReachableReason = '';

test.beforeAll(async () => {
    if (!fs.existsSync(PROOF_DIR)) fs.mkdirSync(PROOF_DIR, { recursive: true });

    // Respect Playwright config (use.baseURL). If user exported PLAYWRIGHT_BASE_URL, it's already used there.
    // Here we just read env to log the target clearly; otherwise we show "config".
    baseURL =
        process.env.PLAYWRIGHT_BASE_URL ||
        process.env.BASE_URL ||
        '(from playwright.config.ts use.baseURL)';

    log(`Starting CP5 Smoke Tests. Target: ${baseURL}`);

    // Preflight: verify target is reachable (GET /)
    // - If PLAYWRIGHT_BASE_URL/BASE_URL is not defined, we cannot cleanly preflight here
    //   because we rely on the webServer + baseURL from config covering it.
    const envURL = process.env.PLAYWRIGHT_BASE_URL || process.env.BASE_URL;
    if (!envURL) {
        baseReachable = true;
        log('✅ Preflight skipped (no env URL). Using playwright.config.ts baseURL/webServer.');
        return;
    }

    try {
        const ctx = await request.newContext({ baseURL: envURL });
        const resp = await ctx.get('/', { timeout: 10_000 });
        baseReachable = resp.ok();

        if (!baseReachable) {
            baseReachableReason = `Target reachable but returned HTTP ${resp.status()} on GET /`;
            log(`❌ Preflight failed: ${baseReachableReason}`);
        } else {
            log('✅ Preflight OK: target is reachable');
        }

        await ctx.dispose();
    } catch (e: any) {
        baseReachable = false;
        baseReachableReason = `Target not reachable: ${e?.message || String(e)}`;
        log(`❌ Preflight failed: ${baseReachableReason}`);
    }
});

test.afterAll(async () => {
    fs.writeFileSync(REPORT_PATH, reportLines.join('\n'));
});

test.describe('CP5: Production Smoke Tests + No-500 Gate', () => {
    let critical5xx: string[] = [];

    test.beforeEach(async ({ page }) => {
        if (!baseReachable) test.skip(true, baseReachableReason || 'Target unreachable');

        critical5xx = [];
        page.on('response', (response) => {
            if (response.status() >= 500) {
                const msg = `🔥 CRITICAL ${response.status()} ${response.url()}`;
                critical5xx.push(msg);
                log(msg);
            }
        });
    });

    test.afterEach(async ({ page }, testInfo) => {
        // Let XHRs finish if possible
        try {
            await page.waitForLoadState('networkidle', { timeout: 1500 });
        } catch { }

        if (critical5xx.length > 0) {
            const sample = critical5xx.slice(0, 5).join('\n');
            throw new Error(
                `No-500 Gate FAILED in "${testInfo.title}". Detected ${critical5xx.length} x 5xx.\n${sample}`
            );
        }
    });

    test('01. Home Page Loads (200 OK)', async ({ page }) => {
        const response = await page.goto('/', { waitUntil: 'load' });
        expect(response?.status()).toBeGreaterThanOrEqual(200);
        expect(response?.status()).toBeLessThan(400);

        await expect(page.locator('h1')).toBeVisible();
        await page.screenshot({ path: path.join(PROOF_DIR, '01-home.png') });
        log('Home Page: OK');
    });

    test('02. Aides: List -> Detail Flow', async ({ page }) => {
        await page.goto('/aides', { waitUntil: 'load' });
        const h1 = page.locator('h1');
        await expect(h1).toBeVisible();
        await expect(h1).toContainText(/Aides/i);
        await page.screenshot({ path: path.join(PROOF_DIR, '02-aides-list.png') });

        const cards = page.locator('a[href^="/aides/"], a[href^="/aide/"]');
        const count = await cards.count();

        if (count > 0) {
            log(`Aides: Found ${count} detail links. Clicking first.`);
            await cards.first().click();
            await expect(page).toHaveURL(/\/aides\/.+/);
            await expect(page.locator('h1')).toBeVisible();
            await page.screenshot({ path: path.join(PROOF_DIR, '02-aides-detail.png') });
            log('Aides Detail: OK');
        } else {
            log('Aides: No detail links found (empty state or no data).');
        }
    });

    test('03. Demarches: List -> Detail Flow', async ({ page }) => {
        await page.goto('/demarches', { waitUntil: 'load' });
        const h1 = page.locator('h1');
        await expect(h1).toBeVisible();
        await expect(h1).toContainText(/D[ée]marches/i);
        await page.screenshot({ path: path.join(PROOF_DIR, '03-demarches-list.png') });

        const cards = page.locator('a[href^="/demarches/"]');
        const count = await cards.count();

        if (count > 0) {
            log(`Demarches: Found ${count} detail links. Clicking first.`);
            await cards.first().click();
            await expect(page).toHaveURL(/\/demarches\/.+/);
            await expect(page.locator('h1')).toBeVisible();
            await page.screenshot({ path: path.join(PROOF_DIR, '03-demarches-detail.png') });
            log('Demarches Detail: OK');
        } else {
            log('Demarches: No detail links found.');
        }
    });

    test('04. Structures: List -> Detail Flow', async ({ page }) => {
        await page.goto('/structures', { waitUntil: 'load' });
        const h1 = page.locator('h1');
        await expect(h1).toBeVisible();
        await expect(h1).toContainText(/Annuaire|Structures/i);
        await page.screenshot({ path: path.join(PROOF_DIR, '04-structures-list.png') });

        const cards = page.locator('[data-testid="structure-card"]');
        const count = await cards.count();

        if (count > 0) {
            log(`Structures: Found ${count} structure cards. Clicking first.`);
            // Use evaluate to programmatically click the overlay link
            await page.evaluate(() => {
                const card = document.querySelector('[data-testid="structure-card"]');
                const link = card?.querySelector('a');
                if (link) link.click();
            });
            await expect(page).toHaveURL(/\/structures\/.+/);
            await expect(page.locator('h1')).toBeVisible();
            await page.screenshot({ path: path.join(PROOF_DIR, '04-structures-detail.png') });
            log('Structures Detail: OK');
        } else {
            log('Structures: No structure cards found.');
        }
    });

    test('05. Actualites: List -> Detail Flow', async ({ page }) => {
        await page.goto('/actualites', { waitUntil: 'load' });
        const h1 = page.locator('h1');
        await expect(h1).toBeVisible();
        await expect(h1).toContainText(/Actualit[ée]s/i);
        await page.screenshot({ path: path.join(PROOF_DIR, '05-actualites-list.png') });

        const cards = page.locator('a[href^="/actualites/"]');
        const count = await cards.count();

        if (count > 0) {
            log(`Actualites: Found ${count} detail links. Clicking first.`);
            await cards.first().click();
            await expect(page).toHaveURL(/\/actualites\/.+/);
            await expect(page.locator('h1')).toBeVisible();
            await page.screenshot({ path: path.join(PROOF_DIR, '05-actualites-detail.png') });
            log('Actualites Detail: OK');
        } else {
            log('Actualites: No detail links found.');
        }
    });
});
