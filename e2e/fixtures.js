/**
 * Global Playwright fixtures with auto-mock support.
 *
 * When USE_MOCKS=true (set in CI), every test automatically gets
 * API mocks injected via setupPublicMocks. Tests that register their
 * own page.route() calls will override the global mock for that route
 * (Playwright uses the last-registered handler).
 *
 * WS8_STRICT_OFFLINE=1 additionally blocks and records every non-loopback
 * browser request. The test fails after execution if any remote request
 * was attempted, even when the request was successfully aborted.
 *
 * Usage: replace `import { test, expect } from '@playwright/test'`
 * with   `import { test, expect } from './fixtures'`
 */
import { test as base, expect, request } from '@playwright/test';
import { setupPublicMocks } from './_mocks/publicApiMocks.js';
import { isWs8AllowedNetworkUrl } from '../tests/helpers/ws8-strict-offline.js';

const test = base.extend({
    page: async ({ page }, use) => {
        const remoteRequests = [];

        if (process.env.WS8_STRICT_OFFLINE === '1') {
            await page.route('**/*', async (route) => {
                const url = route.request().url();
                if (isWs8AllowedNetworkUrl(url)) {
                    await route.continue();
                } else {
                    remoteRequests.push(url);
                    await route.abort();
                }
            });
        }

        // Dismiss the OnboardingTour welcome dialog and cookie banner
        // so they don't block clicks or add unexpected role="dialog" elements
        await page.addInitScript(() => {
            window.localStorage.setItem('ada_onboarding_done', 'true');
            window.localStorage.setItem('ada_cookie_consent', JSON.stringify({ accepted: true, date: new Date().toISOString() }));
        });

        if (process.env.USE_MOCKS === 'true') {
            await setupPublicMocks(page);
        }

        await use(page);

        if (process.env.WS8_STRICT_OFFLINE === '1') {
            expect(remoteRequests, 'WS8 strict-offline browser gate detected remote requests').toEqual([]);
        }
    },
});

export { test, expect, request };
