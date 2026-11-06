/**
 * R47 / A18 — the privacy-safe audience pipeline OFF / ON switch, end to end in LAB: the BUILT app (three builds of the same commit) served by
 * scripts/lab-server.mjs with the SHIPPED vercel.json headers (CSP) and the REAL API, in real Chrome.
 *   R47_A18_MODE=off     default build (VITE_AUDIENCE_MEASUREMENT unset — Production today): no measurement script, no request to /_vercel/*, no queue
 *   R47_A18_MODE=on      VITE_AUDIENCE_MEASUREMENT=on: both components load their script from the SAME origin under the unchanged CSP (no violation);
 *                        the page view reported is the reduced address (no query, no fragment, the private segment replaced); the self-service objection
 *                        on /cookies stops events at once, and on the next visit no script is requested at all
 *   R47_A18_MODE=onbeta  VITE_AUDIENCE_MEASUREMENT=on with VITE_PUBLIC_BETA=true: the beta keeps it OFF
 * The hosting's /_vercel/* endpoints do not exist on a LAB: the browser's requests to them are answered here by a TEST DOUBLE of the Vercel script (it drains
 * the component's queue, applies the beforeSend the app registered, and posts the page view to the same origin), which is what lets the switch, the
 * reduced address and the objection be observed end to end. Nothing leaves 127.0.0.1.
 */
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';

const BASE = process.env.R47_BASE || 'http://127.0.0.1:5194';
const MODE = process.env.R47_A18_MODE || 'off';
// looks like a capability (>= 16 characters with a digit); made at run time so no literal token sits in the public repository
const SECRET_SEGMENT = `7${crypto.randomBytes(10).toString('hex')}`;

/** a test double of /_vercel/insights/script.js: queue drain, beforeSend, page view POST (same origin) */
const FAKE_INSIGHTS = `(function () {
  var before = null; var q = window.vaq || [];
  function send(e) { var x = before ? before(e) : e; if (!x) { window.__vaDropped = (window.__vaDropped || 0) + 1; return; } fetch('/_vercel/insights/view', { method: 'POST', body: JSON.stringify(x), keepalive: true }); }
  window.va = function (cmd, arg) { if (cmd === 'beforeSend') before = arg; else if (cmd === 'event') send({ type: 'event', name: arg && arg.name, url: location.href }); };
  for (var i = 0; i < q.length; i += 1) window.va.apply(null, q[i]);
  window.__vaLoaded = true; send({ type: 'pageview', url: location.href });
})();`;
const FAKE_SPEED = 'window.__siLoaded = true;';

/** @param {import('@playwright/test').BrowserContext} context */
async function instrument(context) {
  const requests = []; const events = [];
  await context.addInitScript(() => {
    try { localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_lang', 'fr'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* storage refused */ }
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => { window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`); });
  });
  await context.route('**/_vercel/**', async (route) => {
    const u = new URL(route.request().url());
    requests.push({ path: u.pathname, origin: u.origin });
    if (u.pathname === '/_vercel/insights/script.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_INSIGHTS });
    if (u.pathname === '/_vercel/speed-insights/script.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SPEED });
    if (u.pathname === '/_vercel/insights/view') { events.push(JSON.parse(route.request().postData() || '{}')); return route.fulfill({ status: 200, body: '' }); }
    return route.fulfill({ status: 204, body: '' });
  });
  return { requests, events };
}
const settle = (page) => page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

test.describe(`A18 audience pipeline — build « ${MODE} »`, () => {
  test.skip(!['off', 'on', 'onbeta'].includes(MODE), 'unknown R47_A18_MODE');

  test('switch: scripts loaded only in the ON build, same origin, no CSP violation', async ({ browser }) => {
    const context = await browser.newContext(); const { requests } = await instrument(context);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.goto(`${BASE}/`); await settle(page); await page.goto(`${BASE}/aides`); await settle(page);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30000 });
    const state = await page.evaluate(() => ({ va: typeof window.va, vaq: Array.isArray(window.vaq), loaded: Boolean(window.__vaLoaded), si: Boolean(window.__siLoaded), csp: window.__csp }));
    // the shipped CSP is really applied by the LAB server (otherwise « no violation » would prove nothing)
    const csp = (await (await context.request.get(`${BASE}/`)).headers())['content-security-policy'] || '';
    expect(csp).toMatch(/script-src 'self'/); expect(csp).toMatch(/connect-src 'self'/); expect(csp).not.toContain('va.vercel-scripts.com');
    expect(state.csp, 'no CSP violation').toEqual([]);
    expect(errors).toEqual([]);
    if (MODE === 'on') {
      const paths = [...new Set(requests.map((r) => r.path))];
      expect(paths).toEqual(expect.arrayContaining(['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js']));
      expect(requests.every((r) => r.origin === new URL(BASE).origin), 'every measurement request is same-origin').toBe(true);
      expect(state.loaded && state.si).toBe(true);
    } else {
      expect(requests, 'no request to the measurement endpoints').toEqual([]);
      expect(state).toEqual({ va: 'undefined', vaq: false, loaded: false, si: false, csp: [] });
    }
    await context.close();
  });

  test('the page view reported is the reduced address (no query, no fragment, no capability segment)', async ({ browser }) => {
    test.skip(MODE !== 'on', 'ON build only');
    const context = await browser.newContext(); const { events } = await instrument(context);
    const page = await context.newPage();
    await page.goto(`${BASE}/aides?token=${SECRET_SEGMENT}#mfa=1`); await settle(page);
    await page.goto(`${BASE}/share/${SECRET_SEGMENT}#k=${SECRET_SEGMENT}`); await settle(page);
    await expect.poll(() => events.length, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
    const urls = events.map((e) => e.url);
    expect(urls).toEqual(expect.arrayContaining([`${new URL(BASE).origin}/aides`, `${new URL(BASE).origin}/share/:id`]));
    for (const u of urls) { expect(u).not.toContain(SECRET_SEGMENT); expect(u).not.toMatch(/[?#]/); }
    await context.close();
  });

  test('objection on /cookies: events stop at once, and the next visit loads no script', async ({ browser }) => {
    const context = await browser.newContext(); const { requests, events } = await instrument(context);
    const page = await context.newPage();
    await page.goto(`${BASE}/cookies`); await settle(page);
    const box = page.getByTestId('audience-objection');
    await expect(box).toBeVisible({ timeout: 30000 });
    if (MODE === 'on') {
      await expect(box).toContainText('La mesure d\'audience est active sur cet appareil.');
      await expect.poll(() => events.length, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
      const before = events.length;
      await page.getByTestId('audience-objection-toggle').click();
      await expect(page.getByTestId('audience-objection-message')).toHaveText('Opposition enregistrée sur cet appareil : la mesure d\'audience est arrêtée.');
      // an event during the same visit goes through the app's beforeSend: dropped, nothing posted
      await page.evaluate(() => window.va('event', { name: 'r47-probe' }));
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => window.__vaDropped || 0)).toBeGreaterThanOrEqual(1);
      expect(events.length).toBe(before);
      requests.length = 0;
      await page.reload(); await settle(page);
      expect(requests, 'after the objection no measurement script is requested').toEqual([]);
      expect(await page.evaluate(() => typeof window.va)).toBe('undefined');
    } else {
      await expect(box).toContainText('La mesure d\'audience n\'est pas activée sur ce site.');
      await page.getByTestId('audience-objection-toggle').click();
      await expect(page.getByTestId('audience-objection-message')).toHaveText('Opposition enregistrée sur cet appareil : la mesure d\'audience ne sera pas activée pour vous.');
      await page.reload(); await settle(page);
      expect(requests).toEqual([]);
    }
    await context.close();
  });
});
