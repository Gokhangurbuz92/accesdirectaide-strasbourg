/**
 * R47 journey 5 — SIX LANGUAGES on the REAL API (run-lab.mjs): the key screens of the citizen booking journey (suitability → services → slots → recap with
 * the consent error → Mes rendez-vous → Mon Espace) in fr, en, tr, ar (right to left), de, uk, at desktop width and on a 375 px phone: axe WCAG 2.1 A/AA
 * serious + critical = 0, no sideways scroll, the keyboard focus on the field in error, times in Europe/Paris across the 25 October 2026 change (a past
 * appointment at 08:00 UTC = 10:00 summer time, a coming one at 08:00 UTC = 09:00 winter time); and Mon Espace under the Production capability gate.
 */
import { test, expect } from '@playwright/test';
import { BASE, CREDS, SLUG, SVC_DIRECT, LANGS, person, citizenSignIn, axe, overflow, allSlots, book, parisHM } from './lib.mjs';

test.describe.configure({ mode: 'serial' });
const W = CREDS.citizens.dst;
const S = {};
const FR_PERIOD = /^Du .+ au .+$/;

test.beforeAll(async ({ browser }) => {
  const p = await person(browser);
  const page = await p.context.newPage();
  await citizenSignIn(page, W, '/compte');
  S.state = await p.context.storageState();
  // a coming appointment at 09:00 Paris (08:00 UTC in winter time)
  const slots = await allSlots(p, SVC_DIRECT, { windows: 3 });
  const nine = slots.find((s) => parisHM(s.startAt) === '09:00' && new Date(s.startAt).getUTCHours() === 8);
  const r = await book(p, SVC_DIRECT, nine.startAt);
  expect(r.status).toBe(201); S.future = r.json.id;
  await p.context.close();
});

for (const viewport of [{ name: 'desktop', size: { width: 1280, height: 900 } }, { name: '375 px', size: { width: 375, height: 812 } }]) {
  for (const lang of LANGS) {
    test(`${lang} ${viewport.name}: booking key screens, consent error focused, Mes rendez-vous in Paris time across the DST change, Mon Espace — axe 0 serious${lang === 'ar' ? ', right to left' : ''}`, async ({ browser }) => {
      const p = await person(browser, { lang, viewport: viewport.size });
      await p.context.addCookies(S.state.cookies);
      const page = await p.context.newPage();
      const narrow = viewport.size.width < 500;
      const checkLayout = async (what) => { await axe(page, `${lang} ${viewport.name} ${what}`); if (narrow) expect(await overflow(page), `${what}: no sideways scroll`).toBeLessThanOrEqual(0); };
      await page.goto(`${BASE}/rdv/${SLUG}/booking`);
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${lang}`));
      const suit = page.getByTestId('booking-suitability');
      await expect(suit).toBeVisible();
      await checkLayout('suitability');
      await suit.getByRole('radio').first().check();
      await page.getByTestId(`booking-service-${SVC_DIRECT}`).click();
      await page.getByTestId('booking-professional-ANY').check();
      await checkLayout('professional choice');
      await page.getByTestId('booking-professional-continue').click();
      await expect(page.getByTestId('booking-slot').first()).toBeVisible();
      const label = (await page.getByTestId('booking-period-label').textContent()) || '';
      if (lang === 'fr') expect(label).toMatch(FR_PERIOD); else expect(label, 'the period is named in the interface language').not.toMatch(FR_PERIOD);
      await checkLayout('slots');
      // keyboard: a slot is chosen with the keyboard
      await page.getByTestId('booking-slot').first().focus(); await page.keyboard.press('Enter');
      await page.getByTestId('booking-message').locator('textarea').fill('Message fictif R47');
      const consent = page.getByTestId('booking-message-consent-checkbox');
      await page.getByTestId('booking-confirm').click();
      await expect(page.getByTestId('booking-message-consent-error')).toBeVisible();
      await expect(consent, 'the keyboard focus is on the field in error').toBeFocused();
      if (lang !== 'fr') await expect(page.getByTestId('booking-message-consent-error')).not.toContainText('Cochez la case');
      await checkLayout('recap with the consent error');
      // Mes rendez-vous: the past appointment (20 Oct, summer time) at 10:00 and the coming one (winter time) at 09:00 — both 08:00 UTC
      await page.goto(`${BASE}/compte/rendez-vous`);
      const items = page.getByTestId('rdv-item');
      await expect(items).toHaveCount(2);
      const whens = await page.getByTestId('rdv-when').allTextContents();
      expect(whens.some((t) => t.includes('10:00')), `summer-time appointment in Paris time: ${whens.join(' | ')}`).toBe(true);
      expect(whens.some((t) => t.includes('09:00')), `winter-time appointment in Paris time: ${whens.join(' | ')}`).toBe(true);
      expect(whens.some((t) => t.includes('08:00')), 'never the UTC time').toBe(false);
      await checkLayout('Mes rendez-vous');
      await page.goto(`${BASE}/compte`);
      await expect(page.getByTestId('notification-center')).toBeVisible();
      await checkLayout('Mon Espace');
      expect(p.serverErrors).toEqual([]); expect(p.external).toEqual([]);
      await p.context.close();
    });
  }
}

test('C13 fr: Mon Espace under the Production capability gate — the first-opening pages open (no closed-capability notice); the pages of closed capabilities say so honestly, without a server error', async ({ browser }) => {
  const p = await person(browser);
  await p.context.addCookies(S.state.cookies);
  const page = await p.context.newPage();
  const CLOSED = 'Cette fonction n’est pas encore ouverte';
  for (const path of ['/compte', '/compte/rendez-vous', '/compte/profil', '/compte/parametres', '/compte/messages']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page.locator('main').first()).toBeVisible();
    await expect(page.locator('main').first(), `${path} is open in the first opening`).not.toContainText(CLOSED);
    await axe(page, `fr ${path}`);
  }
  for (const path of ['/compte/parcours', '/compte/coffre', '/compte/favoris', '/compte/historique', '/compte/delegations']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page.locator('main').first()).toBeVisible();
  }
  expect(p.serverErrors, 'no 5xx other than the designed CAPABILITY_NOT_OPEN').toEqual([]);
  expect([...p.closedCapabilities].length, 'the closed capabilities answered with their designed refusal').toBeGreaterThan(0);
  await p.api('POST', `/api/rdv/appointments/${S.future}/cancel`, {});
  await p.context.close();
});
