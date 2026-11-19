/**
 * G4 — browser-only orientation, in a real browser on a PRODUCTION-CONFIG build (VITE_PUBLIC_BETA=true, VITE_PUBLIC_BETA_OPEN_SURFACES=admin,accounts,
 * VITE_ORIENTATION_BROWSER_ONLY=1) served by e2e-g4/serve-dist.mjs, which has no backend and records every request it receives.
 *   1. French, desktop, mouse: /orientation is open (no beta notice), the wizard is completed, the needs → fiches and the Plan d'action are shown;
 *      the browser's network log AND the server's own log hold no request carrying an answer, nothing to /api/diagnostic, /api/assistant, /api/share,
 *      /api/structures; localStorage / sessionStorage hold no answer; « Effacer mes réponses » empties the page.
 *   2. Arabic (right to left), 320 px, keyboard only: the same run, no sideways scroll, axe WCAG 2.1 A/AA serious+critical = 0 on each step and on the result.
 * Env: G4_BASE (default http://127.0.0.1:5231), G4_SERVER_LOG (the server's log file), G4_EVIDENCE (optional JSON evidence file).
 */
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.G4_BASE || 'http://127.0.0.1:5231';
const SERVER_LOG = process.env.G4_SERVER_LOG || '';
const evidence = [];
test.afterAll(() => { if (process.env.G4_EVIDENCE) fs.writeFileSync(process.env.G4_EVIDENCE, JSON.stringify(evidence, null, 2)); });

// answers chosen to be easy to find in any request: a postal code, a birth date and three amounts nobody else sends
const ZIP = '67000'; const BIRTH = '1987-04-12'; const SALARY = '1234'; const BENEFIT = '567'; const RENT = '789';
const SECRETS = [ZIP, BIRTH, '1987', SALARY, BENEFIT, RENT, 'handicap', 'logement', 'chomage', 'famille', 'tenant'];
const FORBIDDEN_PATHS = /\/api\/(diagnostic|assistant|share|structures|search|recommendations|parcours|citizen)/;
const fr = { need: 'Logement', zip: 'Ville ou code postal', next: 'Continuer', family: 'Avec enfant(s)', unemployed: 'Sans emploi', today: "Aujourd'hui",
  disability: 'Situation de handicap', tenant: 'Locataire', submit: 'Voir les pistes à vérifier', erase: 'Effacer mes réponses', firstQuestion: 'Quel est votre besoin principal ?' };
const AR = JSON.parse(fs.readFileSync('src/i18n/locales/ar/diagnostic.json', 'utf8'));
const ar = { need: AR['wizard.need.logement'], zip: AR['wizard.territory.label'], next: AR['wizard.continue'], family: AR['wizard.profile.children'], unemployed: AR['wizard.profile.unemployed'],
  today: AR['wizard.urgency.today'], disability: AR['wizard.urgency.disability'], tenant: AR['housing.tenant'], submit: AR['wizard.diag.submit'], erase: AR['wizard.local.erase'],
  firstQuestion: AR['wizard.need.title'] };

const prepare = (context, lang) => context.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* */ } }, lang);
const settle = async (page) => { await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(150); };
const axeSerious = async (page, label) => {
  await settle(page);
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `axe serious/critical — ${label}`).toEqual([]);
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const serverLines = () => (SERVER_LOG && fs.existsSync(SERVER_LOG) ? fs.readFileSync(SERVER_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const carries = (text) => SECRETS.filter((s) => String(text || '').includes(s));

/** every request the page makes, with its body */
const record = (page) => {
  const log = [];
  page.on('request', (r) => log.push({ method: r.method(), url: r.url(), body: r.postData() || '' }));
  page.on('websocket', (ws) => log.push({ method: 'WS', url: ws.url(), body: '' }));
  return log;
};
const storageOf = (page) => page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));

/** completes the wizard; `keys` = keyboard only (focus + Enter / Space / typing), `a11y` = axe on every step */
async function complete(page, L, { keys = false, a11y = false } = {}) {
  const press = async (loc, key = 'Enter') => { if (keys) { await loc.focus(); await page.keyboard.press(key); } else await loc.click(); };
  await expect(page.getByRole('heading', { name: L.firstQuestion })).toBeVisible();
  if (a11y) await axeSerious(page, 'step 1');
  await press(page.getByRole('button', { name: L.need, exact: true }));
  const zip = page.getByLabel(L.zip);
  if (keys) { await zip.focus(); await page.keyboard.type(ZIP); } else await zip.fill(ZIP);
  if (a11y) await axeSerious(page, 'step 2');
  await press(page.getByRole('button', { name: L.next }));
  await press(page.getByRole('radio', { name: L.family }));
  await press(page.getByRole('radio', { name: L.unemployed }));
  if (a11y) await axeSerious(page, 'step 3');
  await press(page.getByRole('button', { name: L.next }));
  await press(page.getByRole('radio', { name: L.today }));
  await press(page.getByRole('checkbox', { name: L.disability }), 'Space');
  if (a11y) await axeSerious(page, 'step 4');
  await press(page.getByRole('button', { name: L.next }));
  // a date input is typed the same way by mouse and keyboard users
  await page.locator('#diag-birthdate').fill(BIRTH);
  for (const [id, v] of [['#diag-household', '3'], ['#diag-salary', SALARY], ['#diag-unemployment', BENEFIT]]) {
    if (keys) { await page.locator(id).focus(); await page.keyboard.type(v); } else await page.locator(id).fill(v);
  }
  await press(page.getByRole('radio', { name: L.tenant, exact: true }));
  if (keys) { await page.locator('#diag-rent').focus(); await page.keyboard.type(RENT); } else await page.locator('#diag-rent').fill(RENT);
  if (a11y) await axeSerious(page, 'step 5');
  await press(page.getByRole('button', { name: L.submit }));
  await expect(page.getByTestId('wizard-diagnostic-results')).toBeVisible();
}

async function checkNothingLeft(page, log, label) {
  const browserHits = log.filter((r) => carries(`${r.url} ${r.body}`).length || FORBIDDEN_PATHS.test(r.url) || (r.method !== 'GET' && r.method !== 'HEAD'));
  expect(browserHits, `${label}: browser requests carrying an answer / to a closed API / not a GET`).toEqual([]);
  const serverHits = serverLines().filter((r) => carries(`${r.url} ${r.body}`).length || FORBIDDEN_PATHS.test(r.url) || r.body);
  expect(serverHits, `${label}: what the server received`).toEqual([]);
  expect(carries(await storageOf(page)), `${label}: browser storage`).toEqual([]);
  evidence.push({ label, requests: log.length, apiRequests: log.filter((r) => r.url.includes('/api/')).map((r) => `${r.method} ${new URL(r.url).pathname}`), serverRequests: serverLines().length });
}

test.beforeEach(() => { if (SERVER_LOG) fs.writeFileSync(SERVER_LOG, ''); });

test('fr, desktop, mouse: complete the wizard, get a plan — no request carries an answer, nothing stored, « Effacer » empties the page', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await prepare(context, 'fr');
  const page = await context.newPage();
  const log = record(page);
  await page.goto(`${BASE}/orientation`);
  await expect(page.getByTestId('wizard-privacy-notice')).toHaveAttribute('data-mode', 'browser-only');
  await expect(page.getByText('fonctionne entièrement dans votre navigateur')).toBeVisible();
  await complete(page, fr);
  await expect(page.getByTestId('local-topic').first()).toBeVisible();
  expect(await page.getByTestId('local-topic').evaluateAll((els) => els.map((e) => e.getAttribute('data-need')))).toEqual(expect.arrayContaining(['aides-logement', 'mdph-droits']));
  await expect(page.getByTestId('action-plan')).toBeVisible();
  await expect(page.getByTestId('plan-step-verify').first()).toBeVisible();
  await expect(page.getByTestId('plan-step-share')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Partager le dossier/ })).toHaveCount(0);
  await expect(page.getByTestId('diagnostic-ask-assistant')).toHaveCount(0);
  const text = await page.getByTestId('wizard-diagnostic-results').innerText();
  expect(text).not.toMatch(/vous avez droit|vous êtes éligible|\d\s?€/i);
  await page.waitForLoadState('networkidle');
  await checkNothingLeft(page, log, 'fr desktop, result');
  await page.getByRole('button', { name: fr.erase }).first().click();
  await expect(page.getByTestId('wizard-erased')).toBeVisible();
  await expect(page.getByRole('heading', { name: fr.firstQuestion })).toBeVisible();
  expect(carries(await page.locator('main').innerText()).filter((s) => /\d/.test(s))).toEqual([]);
  await checkNothingLeft(page, log, 'fr desktop, after erase');
  await context.close();
});

test('ar (RTL), 320 px, keyboard only: same run, no sideways scroll, axe serious/critical = 0', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, hasTouch: false });
  await prepare(context, 'ar');
  const page = await context.newPage();
  const log = record(page);
  await page.goto(`${BASE}/orientation?lang=ar`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('wizard-privacy-notice')).toHaveAttribute('data-mode', 'browser-only');
  await complete(page, ar, { keys: true, a11y: true });
  expect(await overflow(page), 'sideways scroll at 320 px').toBeLessThanOrEqual(0);
  await expect(page.getByTestId('action-plan')).toBeVisible();
  await axeSerious(page, 'result (ar, 320 px)');
  await page.waitForLoadState('networkidle');
  await checkNothingLeft(page, log, 'ar 320 keyboard, result');
  const erase = page.getByRole('button', { name: ar.erase }).first();
  await erase.focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('wizard-erased')).toBeVisible();
  await expect(page.getByRole('heading', { name: ar.firstQuestion })).toBeVisible();
  await checkNothingLeft(page, log, 'ar 320 keyboard, after erase');
  await context.close();
});
