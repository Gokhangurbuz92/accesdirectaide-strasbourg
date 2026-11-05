/**
 * R46 (B02 weekly/monthly availability, accessible mobile journey, 6 languages) — the booking page reaches every bookable fortnight up to 60 days ahead:
 * the period is named, « previous » is disabled on the first window and « next » on the last one, each move asks the API for exactly that Paris window,
 * the list shows that period's slots; Arabic is right to left; axe WCAG 2.1 A/AA serious+critical = 0; no sideways scroll at 375 px. Mock API only.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const LANGS = ['fr', 'en', 'tr', 'ar', 'de', 'uk'];
const PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockApi(page, asked) {
  await page.route('**/*', (route) => { const u = new URL(route.request().url()); return ['127.0.0.1', 'localhost'].includes(u.hostname) ? route.fallback() : route.abort(); });
  await page.route('**/api/auth/me', (r) => json(r, { session: { kind: 'user', authType: 'user_cookie', role: 'user' }, user: { id: 'user-1', role: 'user', emailVerified: true } }));
  await page.route('**/api/structures**', (r) => json(r, { id: 'struct-1', slug: 'structure-test', nom: 'Structure Test', statut: 'actif', is_pro_enabled: true, rdv: { isPublished: true, bookingMode: 'IN_PERSON' } }));
  await page.route('**/api/rdv/structures/structure-test/services', (r) => json(r, { structure: { slug: 'structure-test', name: 'Structure Test', bookingMode: 'IN_PERSON' },
    items: [{ id: 'svc-1', name: 'Accompagnement social', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, modes: ['IN_PERSON'], onlineBooking: 'OPEN' }] }));
  await page.route('**/api/rdv/structures/structure-test/slots**', (r) => {
    const u = new URL(r.request().url()); const from = u.searchParams.get('from'); const to = u.searchParams.get('to');
    asked.push({ from, to });
    const day = addDays(from, 2); const startAt = `${day}T08:00:00.000Z`; const endAt = `${day}T08:30:00.000Z`;
    return json(r, { timezone: 'Europe/Paris', confirmation: 'DIRECT', total: 1, slots: [{ startAt, endAt }], days: [{ date: day, slots: [{ startAt, endAt }] }] });
  });
}

for (const viewport of [{ name: 'desktop', size: { width: 1280, height: 900 } }, { name: 'mobile', size: { width: 375, height: 812 } }]) {
  for (const lang of LANGS) {
    if (viewport.name === 'mobile' && !['fr', 'ar', 'uk'].includes(lang)) continue;
    test(`${lang} ${viewport.name}: every fortnight up to 60 days is reachable, named and accessible`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: viewport.size, ...(viewport.name === 'mobile' ? { isMobile: true, hasTouch: true } : {}) });
      await context.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', 'true'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ accepted: true, date: new Date().toISOString() })); } catch { /* */ } }, lang);
      const page = await context.newPage();
      const asked = [];
      await mockApi(page, asked);
      await page.goto('/rdv/structure-test/booking');
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      await page.getByTestId('booking-service-svc-1').click();
      const prev = page.getByTestId('booking-period-prev'); const next = page.getByTestId('booking-period-next'); const label = page.getByTestId('booking-period-label');
      await expect(page.getByTestId('booking-slot').first()).toBeVisible({ timeout: 30000 });
      await expect(prev).toBeDisabled(); await expect(next).toBeEnabled();
      const today = PARIS.format(new Date());
      expect(asked.at(-1)).toEqual({ from: today, to: addDays(today, 13) });
      const first = await label.textContent();
      if (lang !== 'fr') { expect(await prev.textContent()).not.toContain('jours'); expect(await next.textContent()).not.toContain('jours'); }
      const axe = async (what) => {
        const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id), `axe ${what}`).toEqual([]);
      };
      await axe('first window');
      for (let k = 1; k <= 4; k += 1) {
        await next.click();
        await expect.poll(() => asked.length).toBeGreaterThan(k);
        await expect(page.getByTestId('booking-slot').first()).toBeVisible();
        expect(asked.at(-1)).toEqual({ from: addDays(today, 14 * k), to: addDays(today, 14 * k + 13) });
      }
      await expect(next).toBeDisabled();   // the window starting 56 days ahead holds the 60th day: nothing beyond
      expect(await label.textContent()).not.toBe(first);
      await prev.click();
      await expect.poll(() => asked.at(-1)?.from).toBe(addDays(today, 42));
      await expect(next).toBeEnabled();
      await axe('later window');
      if (viewport.name === 'mobile') expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'no sideways scroll').toBeLessThanOrEqual(0);
      // keyboard: the controls are reachable and operable without a pointer
      await prev.focus(); await page.keyboard.press('Enter');
      await expect.poll(() => asked.at(-1)?.from).toBe(addDays(today, 28));
      await context.close();
    });
  }
}
