/**
 * G14-LITE — Mon Parcours without Internet, in a real browser with the real service worker (public/sw.js) on a production build.
 * The citizen API is answered here (synthetic person, synthetic steps); nothing else is mocked.
 *   1. The switch « Garder Mon Parcours sur cet appareil » is unticked by default; while it is off, Mon Parcours offline shows the static offline page.
 *   2. Ticked: the device keeps the copy (IndexedDB) and the worker the static shell; offline, /compte/parcours shows the READ-ONLY copy with the notice,
 *      no control that changes a step; another account page offline still shows the static offline page; nothing from /api is in Cache Storage.
 *   3. Unticked again (online): the copy and the shell are erased; offline, Mon Parcours is the static offline page again.
 *   4. Logout erases the copy (the header's « Déconnexion »).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const USER = { id: 'g14-e2e-user', email: 'personne-fictive@example.test' };
const STEP_TYPES = {
  version: 1, domains: { ressources: 'Ressources' },
  types: [{ code: 'RSA_DEMANDE', domain: 'ressources', label: 'Demander le RSA', structureKinds: [],
    sources: [{ id: 'F19778', url: 'https://www.service-public.fr/particuliers/vosdroits/F19778', title: 'Revenu de solidarité active (RSA)' }] }],
};
const PARCOURS = { contract: 'limited', stepTypes: STEP_TYPES, planSteps: true, planImport: false, emailReminders: false, sensitiveSteps: 'excluded', notes: true,
  items: [{ id: 'g14-step-1', origin: 'MANUAL', stepKind: 'custom', stepType: 'RSA_DEMANDE', title: 'Demander le RSA', status: 'IN_PROGRESS', closure: null,
    dueDate: '2026-12-15', note: 'NOTE-PRIVEE-JAMAIS-GARDEE', itemCodes: ['steptype:RSA_DEMANDE'], records: [], available: true }] };

async function answerApi(context, state) {
  await context.route('**/api/**', async (route) => {
    if (state.offline) return route.abort('internetdisconnected');   // a route answers even offline: the network is cut here too
    const url = new URL(route.request().url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/me') return state.loggedIn ? json(200, { authenticated: true, session: { kind: 'user' }, user: USER }) : json(401, { error: 'unauthorized' });
    if (url.pathname === '/api/auth/logout') { state.loggedIn = false; return json(200, { ok: true }); }
    if (url.pathname === '/api/citizen/parcours' && route.request().method() === 'GET') return state.loggedIn ? json(200, PARCOURS) : json(401, { error: 'unauthorized' });
    if (url.pathname === '/api/csrf-token' || url.pathname === '/api/csrf') return json(200, { csrfToken: 'x' });
    return json(404, { error: 'not_found' });
  });
}
const prepare = (context) => context.addInitScript(() => { try { localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* */ } });

/** the page is controlled by the worker (first visit installs it; a reload puts the page under its control) */
async function underWorker(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}
const shellKept = (page) => page.evaluate(async () => (await caches.has('ada-offline-parcours-shell-v1')) && Boolean(await (await caches.open('ada-offline-parcours-shell-v1')).match('/__ada/offline-parcours-shell')));
const cachedUrls = (page) => page.evaluate(async () => { const out = []; for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(r.url); return out; });
const idbCopy = (page) => page.evaluate(() => new Promise((resolve) => {
  if (localStorage.getItem('ada_offline_parcours') !== '1') return resolve(null);
  const r = indexedDB.open('ada-offline-parcours', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { const tx = r.result.transaction('kv', 'readonly'); const g = tx.objectStore('kv').get('current'); g.onsuccess = () => { r.result.close(); resolve(g.result || null); }; g.onerror = () => resolve(null); };
  r.onerror = () => resolve(null);
}));

test('Mon Parcours offline: default off, opt-in read-only copy, erased on « off » and on logout', async ({ context, page }) => {
  const state = { loggedIn: true, offline: false };
  await prepare(context); await answerApi(context, state);

  await page.goto('/compte/parcours');
  await underWorker(page);
  await expect(page.getByTestId('parcours-item')).toHaveCount(1);
  const toggle = page.getByTestId('parcours-offline-toggle');
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('parcours-offline-state')).toContainText('n’est pas gardé');
  expect(await idbCopy(page)).toBeNull();

  // 1. off: offline, Mon Parcours is the static offline page
  state.offline = true; await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1')).toContainText('pas connecté à Internet');
  await expect(page.getByTestId('parcours-offline')).toHaveCount(0);
  state.offline = false; await context.setOffline(false);
  await page.goto('/compte/parcours');
  await expect(page.getByTestId('parcours-item')).toHaveCount(1);

  // 2. on: the copy and the shell are kept; offline the read-only copy is shown
  await page.getByTestId('parcours-offline-toggle').check();
  await expect(page.getByTestId('parcours-offline-state')).toContainText('est gardé sur cet appareil');
  const axs = await new AxeBuilder({ page }).include('[data-testid="parcours-offline-switch"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axs.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  await expect.poll(() => shellKept(page), { timeout: 30000 }).toBe(true);
  const copy = await idbCopy(page);
  expect(copy?.enabled).toBe(true);
  expect(JSON.stringify(copy)).not.toContain('NOTE-PRIVEE-JAMAIS-GARDEE');
  expect(JSON.stringify(copy)).not.toContain(USER.id);
  expect((await cachedUrls(page)).filter((u) => new URL(u).pathname.startsWith('/api/'))).toEqual([]);

  state.offline = true; await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('parcours-offline-banner')).toContainText('Vous n’êtes pas connecté à Internet.');
  await expect(page.getByTestId('parcours-offline-item')).toHaveCount(1);
  await expect(page.getByTestId('parcours-offline-item')).toContainText('Demander le RSA');
  await expect(page.getByTestId('parcours-add')).toHaveCount(0);
  await expect(page.getByTestId('parcours-offline').getByRole('button')).toHaveText(['Réessayer']);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await page.waitForTimeout(1500);   // the route's fade-in (page transition) is over before colours are measured
  const ax = await new AxeBuilder({ page }).include('[data-testid="parcours-offline"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(ax.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => [v.id, v.nodes.map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message || ''))])).toEqual([]);
  // another account page stays the static offline page
  await page.goto('/compte/messages');
  await expect(page.locator('h1')).toContainText('pas connecté à Internet');
  state.offline = false; await context.setOffline(false);

  // 3. unticked: everything is erased
  await page.goto('/compte/parcours');
  await expect(page.getByTestId('parcours-offline-toggle')).toBeChecked();
  await page.getByTestId('parcours-offline-toggle').uncheck();
  await expect(page.getByTestId('parcours-offline-state')).toContainText('n’est pas gardé');
  await expect.poll(() => shellKept(page)).toBe(false);
  expect(await idbCopy(page)).toBeNull();
  state.offline = true; await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1')).toContainText('pas connecté à Internet');
  await expect(page.getByTestId('parcours-offline')).toHaveCount(0);
  state.offline = false; await context.setOffline(false);

  // 4. logout erases a kept copy
  await page.goto('/compte/parcours');
  await page.getByTestId('parcours-offline-toggle').check();
  await expect.poll(() => shellKept(page), { timeout: 30000 }).toBe(true);
  const menu = page.getByRole('button', { name: new RegExp(USER.email.replace(/[.]/g, '\\.')) });
  if (await menu.count()) await menu.first().click();
  await page.getByText('Déconnexion').first().click();
  await expect.poll(() => idbCopy(page)).toBeNull();
  await expect.poll(() => shellKept(page)).toBe(false);
});
