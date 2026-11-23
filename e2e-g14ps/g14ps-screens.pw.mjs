/**
 * G14-PS — Passeport Social (local-first) and the social referral screens in a real browser, on a build with VITE_PASSEPORT_SOCIAL=local served by
 * e2e-g4/serve-dist.mjs (no backend; it records every request into G14PS_SERVER_LOG).
 *   1. Passeport, French, desktop: create, add a PDF, fill the situation, show on screen, export .adapass (+ separate code), lock, wrong passphrase, unlock,
 *      delete-all — and NO request carries the document bytes, the passphrase or the summary; nothing is sent to /api at all. axe 0 serious/critical.
 *   2. Passeport, Arabic (RTL), 320 px: no sideways scroll, axe 0 serious/critical.
 *   3. « Mes orientations sociales » and the professional page with mocked API answers (synthetic data): axe 0 serious/critical, screenshots.
 * Env: G14PS_BASE, G14PS_SERVER_LOG, G14PS_SHOTS (screenshot directory).
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.G14PS_BASE || 'http://127.0.0.1:5241';
const SHOTS = process.env.G14PS_SHOTS || 'g14ps-shots';
const SERVER_LOG = process.env.G14PS_SERVER_LOG || '';
fs.mkdirSync(SHOTS, { recursive: true });
const MARK = 'G14PS-SECRET-DOC-BYTES-7f3a';
const PDF = Buffer.from(`%PDF-1.4\n% ${MARK}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
const PASS = 'phrase secrète de test 2026';

const prepare = (context, lang) => context.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* */ } }, lang);
const settle = async (page) => { await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(200); };
const axeSerious = async (page, label) => {
  await settle(page);
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `axe serious/critical — ${label}`).toEqual([]);
};
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const record = (page) => { const log = []; page.on('request', (r) => log.push({ method: r.method(), url: r.url(), body: r.postDataBuffer() ? r.postDataBuffer().toString('latin1') : '' })); return log; };

test('Passeport Social — local only, French, desktop', async ({ page, context }) => {
  await prepare(context, 'fr');
  const log = record(page);
  await page.goto(`${BASE}/passeport-social`);
  await expect(page.getByRole('heading', { name: 'Créer mon passeport sur cet appareil' })).toBeVisible();
  await axeSerious(page, 'create'); await shot(page, '01_passeport_create_fr');
  await page.getByLabel('Phrase secrète', { exact: true }).fill(PASS);
  await page.getByLabel('Écrivez-la encore une fois').fill(PASS);
  await page.getByRole('button', { name: 'Créer mon passeport' }).click();
  await expect(page.getByRole('heading', { name: 'Mes documents' })).toBeVisible({ timeout: 30000 });
  await page.getByLabel('Ajouter un document (PDF ou photo, 10 Mo au plus)').setInputFiles({ name: 'avis-imposition-fixture.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByTestId('passeport-docs')).toContainText('avis-imposition-fixture.pdf');
  await page.getByLabel('Locataire (HLM)').check(); await page.getByLabel('En recherche d’emploi').check(); await page.getByLabel('RSA').check();
  await page.getByRole('button', { name: 'Enregistrer ma situation' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'enregistrée' })).toBeVisible();
  await expect(page.getByTestId('passeport-health-warning')).toBeVisible();
  await axeSerious(page, 'open'); await shot(page, '02_passeport_open_fr');
  await page.getByRole('button', { name: 'Montrer ma situation à l’écran' }).click();
  await expect(page.getByTestId('passeport-show')).toBeVisible(); await axeSerious(page, 'show'); await shot(page, '03_passeport_show_on_screen_fr');
  await page.getByRole('button', { name: 'Fermer' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Créer le fichier chiffré' }).click();
  const file = await dl; const pkgPath = path.join(SHOTS, 'export.adapass.tmp'); await file.saveAs(pkgPath);
  expect(file.suggestedFilename()).toMatch(/\.adapass$/);
  const pkg = fs.readFileSync(pkgPath, 'utf8'); fs.rmSync(pkgPath);
  expect(pkg).not.toContain(MARK); expect(pkg).not.toContain('avis-imposition');
  await expect(page.getByTestId('passeport-export-code')).toBeVisible(); await shot(page, '04_passeport_export_code_fr');
  await page.getByRole('button', { name: 'Verrouiller maintenant' }).click();
  await page.getByLabel('Phrase secrète').fill('mauvaise phrase secrète');
  await page.getByRole('button', { name: 'Ouvrir', exact: true }).click();
  await expect(page.getByTestId('passeport-problem')).toContainText('incorrecte'); await shot(page, '05_passeport_wrong_passphrase_fr');
  await page.getByLabel('Phrase secrète').fill(PASS);
  await page.getByRole('button', { name: 'Ouvrir', exact: true }).click();
  await expect(page.getByTestId('passeport-docs')).toContainText('avis-imposition-fixture.pdf', { timeout: 30000 });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Tout effacer de cet appareil' }).click();
  await expect(page.getByRole('heading', { name: 'Créer mon passeport sur cet appareil' })).toBeVisible();
  // nothing left the device: no /api request at all, and no request (browser log, server log) carries the document, the passphrase or the summary
  const all = [...log.map((l) => `${l.url} ${l.body}`), ...(SERVER_LOG && fs.existsSync(SERVER_LOG) ? fs.readFileSync(SERVER_LOG, 'utf8').split('\n') : [])].join('\n');
  // the only API call is the site shell's own session probe (GET /api/auth/me, no body) — the passport itself calls nothing
  expect(log.filter((l) => /\/api\//.test(l.url) && !/\/api\/auth\/me$/.test(l.url))).toEqual([]);
  expect(log.filter((l) => /\/api\//.test(l.url)).every((l) => l.method === 'GET' && !l.body)).toBe(true);
  for (const s of [MARK, 'avis-imposition', PASS, 'tenant_social', 'job_seeker']) expect(all.includes(s), s).toBe(false);
  expect(log.filter((l) => l.method !== 'GET')).toEqual([]);
});

test('Passeport Social — Arabic, 320 px', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
  await prepare(context, 'ar'); const page = await context.newPage();
  await page.goto(`${BASE}/passeport-social`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('passeport-local-notice')).toBeVisible();
  await axeSerious(page, 'ar create');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await shot(page, '06_passeport_create_ar_320');
  await context.close();
});

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('Mes orientations sociales — citizen (mocked API, synthetic data)', async ({ page, context }) => {
  await prepare(context, 'fr');
  await page.route('**/api/citizen/social-referrals', (r) => json(r, { available: true, referrals: [
    { id: 'r1', status: 'PENDING_CITIZEN', reasonCodes: ['HOUSING', 'INCOME_BUDGET'], from: 'CCAS de Strasbourg (fixture)', to: 'Association Logement Fixture', createdAt: '2026-11-23T09:00:00Z' },
    { id: 'r2', status: 'ACCEPTED', reasonCodes: ['EMPLOYMENT'], from: 'CCAS de Strasbourg (fixture)', to: 'Mission locale Fixture', createdAt: '2026-11-10T09:00:00Z', canWithdraw: true },
    { id: 'r3', status: 'DECLINED', responseCode: 'NO_CAPACITY', reasonCodes: ['FOOD'], from: 'Association Fixture', to: 'Épicerie solidaire Fixture', createdAt: '2026-10-02T09:00:00Z', canWithdraw: false },
  ] }));
  await page.route('**/api/auth/me**', (r) => json(r, { authenticated: true, kind: 'citizen', user: { id: 'c1', email: 'fixture@example.test' } }));
  await page.route('**/api/citizen/espace**', (r) => json(r, {}));
  await page.route('**/api/citizen/notifications**', (r) => json(r, { notifications: [] }));
  await page.goto(`${BASE}/compte/orientations-sociales`);
  await expect(page.getByTestId('social-pending')).toBeVisible();
  await axeSerious(page, 'citizen'); await shot(page, '07_mes_orientations_sociales_fr');
});

test('Orientations sociales — professional (mocked API, synthetic data)', async ({ page, context }) => {
  await prepare(context, 'fr');
  await context.addInitScript(() => { try { localStorage.setItem('pro_token', 'fixture-token'); } catch { /* */ } });
  await page.route('**/api/pro/**', (r) => json(r, {}));   // registered FIRST: Playwright tries the most recent route first
  await page.route('**/api/pro/me**', (r) => json(r, { user: { id: 'p1', email: 'pro@example.test', role: 'PRO', structureId: 's1', structureName: 'CCAS Fixture' }, modules: { socialReferrals: true }, session: { mfa: true } }));
  await page.route('**/api/pro/social-referrals**', (r) => {
    const u = new URL(r.request().url());
    if (u.searchParams.has('receivers')) return json(r, { receivers: [{ id: 's2', name: 'Association Logement Fixture', city: 'Strasbourg' }, { id: 's3', name: 'Bailleur social Fixture', city: 'Strasbourg' }] });
    if (r.request().method() === 'POST') return json(r, { referral: { id: 'r9', status: 'PENDING_CITIZEN', to: 'Association Logement Fixture' }, code: 'K7M2P-Q9XWZ' }, 201);
    return json(r, { box: 'outbox', referrals: [
      { id: 'r1', status: 'PENDING_CITIZEN', reasonCodes: ['HOUSING'], from: 'CCAS Fixture', to: 'Association Logement Fixture', createdAt: '2026-11-23T09:00:00Z' },
      { id: 'r2', status: 'SENT', reasonCodes: ['EMPLOYMENT', 'DIGITAL'], from: 'CCAS Fixture', to: 'Mission locale Fixture', createdAt: '2026-11-20T09:00:00Z', consentChannel: 'ASSISTED_ON_SCREEN' },
    ] });
  });
  await page.goto(`${BASE}/pro/orientations-sociales`);
  await expect(page.getByTestId('pro-social-referrals')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Chercher' }).click();
  await page.getByLabel('Association Logement Fixture — Strasbourg').check();
  await page.getByRole('checkbox', { name: 'Logement', exact: true }).check(); await page.getByRole('checkbox', { name: 'Ressources et budget' }).check();
  await axeSerious(page, 'pro new'); await shot(page, '08_pro_orientations_sociales_new_fr');
  await page.getByRole('button', { name: 'Proposer et obtenir le code' }).click();
  await expect(page.getByTestId('social-code')).toContainText('K7M2P-Q9XWZ');
  await page.getByRole('button', { name: 'Accord sur cet écran' }).first().click();
  await expect(page.getByTestId('social-assisted')).toBeVisible();
  await axeSerious(page, 'pro assisted'); await shot(page, '09_pro_code_and_assisted_consent_fr');
});
