/**
 * R44-BOOK — the account booking journey on the BUILT app with the REAL API (api/index.js) and a disposable LAB PostgreSQL seeded with the fictional
 * « CDGG Conseil » (scripts/lab/seed-cdgg-conseil.mjs; its « démarches » service made two-modality in that LAB database only; video = jitsi-jwt SANDBOX on
 * video.lab.invalid). Six languages (ar right to left), desktop and a 375 px phone:
 *   signed out → sign-in with the booking context kept in `next` (service + modality) → A5 on the sign-in form → signed in → professional choice →
 *   modality BEFORE the slots (recorded address marked unverified, video said to be a test environment, telephone not bookable) → slots of that modality →
 *   recap with the place → (fr, en, ar) booking confirmed with the place; axe WCAG 2.1 A/AA serious+critical = 0 at each step; no sideways scroll at 375 px.
 * Env: R44_BASE (default http://127.0.0.1:5185), R44_CREDS (the seed's credentials file, outside the repository — never printed).
 */
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.R44_BASE || 'http://127.0.0.1:5185';
const CREDS = JSON.parse(fs.readFileSync(process.env.R44_CREDS || '', 'utf8'));
const SLUG = CREDS.structure.slug; const SVC = CREDS.services.direct.id;
const LANGS = ['fr', 'en', 'tr', 'ar', 'de', 'uk'];
const LEGEND = { fr: 'Comment souhaitez-vous être reçu(e) ?', en: 'How would you like to be received?', tr: 'Nasıl karşılanmak istersiniz?', ar: 'كيف تفضّل أن يتم استقبالك؟', de: 'Wie möchten Sie empfangen werden?', uk: 'Як ви хочете, щоб вас прийняли?' };
const settle = async (page) => { await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(150); };
const axeSerious = async (page, label) => {
  await settle(page);
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `axe serious/critical — ${label}`).toEqual([]);
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const evidence = [];
test.afterAll(() => { if (process.env.R44_EVIDENCE) fs.writeFileSync(process.env.R44_EVIDENCE, JSON.stringify(evidence, null, 2)); });

// one real sign-in of the LAB citizen (the sign-in route is rate-limited), its session reused by every test
let session = null;
async function signIn(context) {
  if (!session) {
    const c = CREDS.citizens.client;
    const r = await context.request.post(`${BASE}/api/auth/login`, { data: { email: c.email, password: c.password } });
    expect(r.status(), 'LAB citizen sign-in').toBe(200);
    session = (await context.storageState()).cookies;
    return;
  }
  await context.addCookies(session);
}
/** the professional choice appears only when the structure offers it for this service */
async function passProfessionalStep(page) {
  const next = page.getByTestId('booking-professional-continue'); const modality = page.getByTestId('booking-modality'); const slots = page.getByTestId('booking-slot-modality');
  await expect(next.or(modality).or(slots).first()).toBeVisible({ timeout: 30000 });
  if (await next.isVisible()) await next.click();
}

for (const viewport of [{ name: 'desktop', size: { width: 1280, height: 900 } }, { name: 'mobile', size: { width: 375, height: 812 } }]) {
  for (const lang of LANGS) {
    if (viewport.name === 'mobile' && !['fr', 'ar'].includes(lang)) continue;
    test(`${lang} ${viewport.name}: context kept through sign-in; modality before slots with place, honest video, telephone not bookable; recap shows the place`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: viewport.size, ...(viewport.name === 'mobile' ? { isMobile: true, hasTouch: true } : {}) });
      const external = []; context.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(u.host); });
      await context.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* */ } }, lang);
      const page = await context.newPage();
      const row = { lang, viewport: viewport.name };
      try {
        // 1. signed out: the booking link names the service and the modality; the gate sends to sign-in with that context as a same-origin `next`
        await page.goto(`${BASE}/rdv/${SLUG}/booking?serviceId=${SVC}&mode=IN_PERSON`);
        await page.waitForURL((u) => u.pathname === '/auth/login', { timeout: 30000 });
        const next = new URL(page.url()).searchParams.get('next');
        expect(next).toBe(`/rdv/${SLUG}/booking?serviceId=${SVC}&mode=IN_PERSON`);
        row.loginNext = next;
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        // A5 on the sign-in form: an empty submit is said on the fields, the summary takes the focus, nothing is sent
        let posted = 0; const onReq = (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/auth/login') posted += 1; }; page.on('request', onReq);
        await page.locator('#main-content form button[type="submit"]').click();
        await expect(page.getByTestId('auth-error-summary')).toBeFocused();
        await expect(page.locator('#auth-email')).toHaveAttribute('aria-invalid', 'true');
        expect(String(await page.locator('#auth-email').getAttribute('aria-describedby'))).toContain('auth-email-error');
        expect(posted, 'nothing sent').toBe(0); page.off('request', onReq);
        await axeSerious(page, `${lang} sign-in with errors`);
        if (viewport.name === 'mobile') expect(await overflow(page), 'no sideways scroll (sign-in)').toBeLessThanOrEqual(0);

        // 2. signed in: back to the same booking context (the page itself uses the validated `next`)
        await signIn(context);
        await page.goto(`${BASE}${next}`.replace('mode=IN_PERSON', 'mode='));   // the modality is asked again: the service has two
        await passProfessionalStep(page);

        // 3. modality before the slots
        const modality = page.getByTestId('booking-modality');
        await expect(modality).toBeVisible({ timeout: 30000 });
        await expect(page.getByRole('radiogroup')).toHaveAccessibleName(LEGEND[lang]);
        await expect(page.getByTestId('booking-modality-location')).toContainText('Adresse fictive');   // the recorded LAB address, as recorded (lang="fr")
        await expect(page.getByTestId('booking-video-sandbox')).toBeVisible();
        await expect(page.getByTestId('booking-modality-unavailable-PHONE')).toBeVisible();
        expect(await page.getByRole('radio').count(), 'two bookable modalities, no telephone radio').toBe(2);
        if (lang !== 'fr') await expect(modality).not.toContainText('Comment souhaitez-vous');
        await page.getByTestId('booking-modality-continue').click();
        await expect(page.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByRole('radiogroup')).toBeFocused();
        await axeSerious(page, `${lang} modality with error`);
        if (viewport.name === 'mobile') expect(await overflow(page), 'no sideways scroll (modality)').toBeLessThanOrEqual(0);
        await page.getByTestId('booking-modality-IN_PERSON').check();
        const slotsResp = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/rdv/structures/${SLUG}/slots`);
        await page.getByTestId('booking-modality-continue').click();
        const sr = await slotsResp; expect(sr.status()).toBe(200);
        expect(new URL(sr.url()).searchParams.get('mode'), 'the slots of the chosen modality').toBe('IN_PERSON');
        row.slotsMode = 'IN_PERSON';

        // 4. slots: the place shown with them; then the recap with the place, before any commitment
        await expect(page.getByTestId('booking-slot-location')).toContainText('Adresse fictive', { timeout: 30000 });
        await page.getByTestId('booking-slot').first().click();
        await expect(page.getByTestId('booking-recap-location')).toContainText('Adresse fictive');
        await axeSerious(page, `${lang} recap`);
        if (viewport.name === 'mobile') expect(await overflow(page), 'no sideways scroll (recap)').toBeLessThanOrEqual(0);

        // 5. (fr / en / ar desktop) the booking itself: confirmed, the place said again
        if (viewport.name === 'desktop' && ['fr', 'en', 'ar'].includes(lang)) {
          const created = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/rdv/appointments');
          await page.getByTestId('booking-confirm').click();
          const cr = await created; expect([200, 201]).toContain(cr.status());
          expect(JSON.parse(cr.request().postData() || '{}')).toMatchObject({ mode: 'IN_PERSON', serviceId: SVC });
          await expect(page.getByTestId('booking-success')).toBeVisible({ timeout: 30000 });
          await expect(page.getByTestId('booking-confirmation-location')).toContainText('Adresse fictive');
          await axeSerious(page, `${lang} confirmation`);
          row.booked = cr.status();
        }
        expect(external, 'no request leaves 127.0.0.1').toEqual([]);
        row.result = 'PASS';
      } finally { evidence.push(row); await context.close(); }
    });
  }
}

test('video path (fr): the modality in the link goes straight to the VIDEO slots; the agreement is said on its field, nothing sent without it', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => { try { localStorage.setItem('ada_lang', 'fr'); localStorage.setItem('ada_onboarding_done', '1'); } catch { /* */ } });
  await signIn(context);
  const page = await context.newPage();
  await page.goto(`${BASE}/rdv/${SLUG}/booking?serviceId=${SVC}&mode=VIDEO`);
  await passProfessionalStep(page);
  await expect(page.getByTestId('booking-slot-mode')).toHaveText('À distance, en visio', { timeout: 30000 });
  await expect(page.getByTestId('booking-slot-video')).toContainText('Aucun lien n’est envoyé par e-mail');
  await page.getByTestId('booking-slot').first().click();
  let posted = 0; page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/rdv/appointments') posted += 1; });
  await page.getByTestId('booking-confirm').click();
  await expect(page.getByTestId('booking-video-consent-checkbox')).toBeFocused();
  await expect(page.getByTestId('booking-video-consent-checkbox')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('booking-video-consent-error')).toBeVisible();
  expect(posted).toBe(0);
  expect(await page.getByText('Jitsi').count(), 'no provider presented as live').toBe(0);
  await axeSerious(page, 'video recap with error');
  evidence.push({ lang: 'fr', viewport: 'desktop', path: 'video', result: 'PASS' });
  await context.close();
});
