/**
 * Journey 7 — P2b (owner decision 08/11/2026, D2 V2 option B) on the REAL API (run-lab.mjs): the display preferences stay ON THE DEVICE.
 * A signed-in person sets FALC, high contrast, reduced motion and a very large text size from « Mon profil »: the whole site follows at once, the choice
 * survives a reload, a sign-out and a new sign-in on the same device, and is never sent to the server (no request carries it; the profile row keeps {}).
 * The same account on ANOTHER device (another browser) starts with the defaults: nothing synchronises. « Réinitialiser l'affichage » puts everything back.
 */
import { test, expect } from '@playwright/test';
import { BASE, CREDS, db, person, citizenSignIn, axe } from './lib.mjs';

test.describe.configure({ mode: 'serial' });
const W = CREDS.citizens.dst;
const PREF_WORDS = /falc|highContrast|reduceMotion|textScale|accessibilit/i;

const bodyState = (page) => page.evaluate(() => ({
  falc: document.body.classList.contains('falc-mode'), contrast: document.body.classList.contains('high-contrast'),
  motion: document.body.classList.contains('reduce-motion'), size: document.documentElement.style.fontSize,
}));
const ON = { falc: true, contrast: true, motion: true, size: '130%' };
const OFF = { falc: false, contrast: false, motion: false, size: '100%' };
// (the header's accessibility panel is lazy-loaded: index.html applies the text size at once, the body classes follow when the panel mounts — hence polling)

test('device-only display preferences: applied at once, kept after reload and sign-out/sign-in, never sent, not synchronised to another device, reset in one click', async ({ browser }) => {
  const device = await person(browser);
  const sent = [];
  device.context.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && r.method() !== 'GET' && PREF_WORDS.test(r.postData() || '')) sent.push(`${r.method()} ${u.pathname}`); });
  const page = await device.context.newPage();
  await citizenSignIn(page, W, '/compte/profil');
  await expect(page.getByTestId('pf-display-note')).toContainText('ne se synchronisent donc pas');
  await expect(page.getByTestId('pf-falc')).not.toBeChecked();

  // set them from the profile: the whole site follows at once
  await page.getByTestId('pf-falc').check();
  await page.getByTestId('pf-contrast').check();
  await page.getByTestId('pf-motion').check();
  await page.getByTestId('pf-scale').selectOption('xlarge');
  await expect.poll(() => bodyState(page)).toEqual(ON);
  await axe(page, 'profile with device display preferences');

  // « Enregistrer » saves the account profile WITHOUT the display preferences; the row keeps {}
  const [put] = await Promise.all([page.waitForRequest((r) => new URL(r.url()).pathname === '/api/citizen/profile' && r.method() === 'PUT'), page.getByTestId('profil-save').click()]);
  expect(put.postData() || '').not.toMatch(PREF_WORDS);
  const row = (await db(`SELECT p."accessibilityPrefs" a FROM "CitizenProfile" p JOIN "CitizenUser" u ON u.id = p."userId" WHERE u.email = $1`, [W.email]))[0];
  expect(row?.a ?? {}).toEqual({});

  // a reload, then another page of the site
  await page.reload();
  await expect(page.getByTestId('pf-falc')).toBeChecked();
  await expect(page.getByTestId('pf-motion')).toBeChecked();
  await expect.poll(() => bodyState(page)).toEqual(ON);
  await page.goto(`${BASE}/`);
  await expect.poll(() => bodyState(page)).toEqual(ON);

  // sign out from the header's account menu (the real sign-out: the server session ends, the page reloads signed out) — same display on this device
  await page.getByRole('button', { name: new RegExp(W.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
  await page.getByRole('menuitem', { name: 'Déconnexion' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await expect.poll(async () => (await device.api('GET', '/api/auth/me')).json?.user?.email ?? null, 'signed out').toBeNull();
  await expect.poll(() => bodyState(page)).toEqual(ON);
  // sign in again on the same device: nothing is fetched or overwritten
  await citizenSignIn(page, W, '/compte/profil');
  await expect(page.getByTestId('pf-falc')).toBeChecked();
  await expect.poll(() => bodyState(page)).toEqual(ON);

  // the same account on ANOTHER device: the defaults (nothing synchronises)
  const other = await person(browser);
  const op = await other.context.newPage();
  await citizenSignIn(op, W, '/compte/profil');
  await expect(op.getByTestId('pf-falc')).not.toBeChecked();
  await expect(op.getByTestId('pf-contrast')).not.toBeChecked();
  await expect.poll(() => bodyState(op)).toEqual(OFF);
  // and an untouched browser keeps no display key at all (written only after a choice of the person — art. 82 LIL)
  expect(await op.evaluate(() => ['accessibilitySettings', 'falc-mode', 'ada_reader_prefs'].map((k) => localStorage.getItem(k)))).toEqual([null, null, null]);
  await other.context.close();

  // reset on the first device: everything back, announced, and it stays reset after a reload
  await page.getByTestId('pf-display-reset').click();
  await expect(page.getByTestId('pf-display-status')).toHaveText('Affichage réinitialisé sur cet appareil.');
  await expect.poll(() => bodyState(page)).toEqual(OFF);
  await page.reload();
  await expect(page.getByTestId('pf-falc')).not.toBeChecked();
  await expect.poll(() => bodyState(page)).toEqual(OFF);

  expect(sent, 'no request carried a display preference').toEqual([]);
  expect(device.serverErrors).toEqual([]);
  await device.context.close();
});
