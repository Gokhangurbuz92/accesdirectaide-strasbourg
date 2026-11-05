/**
 * R46 pro — browser journeys on the BUILT app with the REAL API entry (e2e-r46/pro/serve.mjs) and a disposable LAB PostgreSQL seeded with the fictional
 * « CDGG Conseil » (scripts/lab/seed-cdgg-conseil.mjs seed + enrol), against a LOCAL mock ProConnect issuer (e2e-r46/pro/mock-proconnect.mjs). Synthetic only.
 *   N09: sign-in page shows « S'identifier avec ProConnect » → federation (mock) → back → the ADA second factor (TOTP) → dashboard; logout ends at the federation;
 *        an identity without an invited account gets the honest « no account » message; Arabic right to left on a 375 px phone; axe WCAG 2.1 A/AA = 0 serious.
 *   R22: on a dossier shared WITH the SIAO purpose the professional prepares the manual handover sheet (status line « non connectée »); without the purpose
 *        the card says the person did not allow it. Nothing leaves the loopback.
 * Env: R46_BASE (default http://127.0.0.1:5186), R46_CREDS (the seed's credentials file, outside the repository — never printed), R46_MOCK_PC
 * (default http://127.0.0.1:5197), DATABASE_URL (the LAB database, for the dossier fixtures only).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { generateCode } from '../../api/lib/totp.js';

const BASE = process.env.R46_BASE || 'http://127.0.0.1:5186';
const MOCK = process.env.R46_MOCK_PC || 'http://127.0.0.1:5197';
const CREDS = JSON.parse(fs.readFileSync(process.env.R46_CREDS || '', 'utf8'));
const P1 = CREDS.pros.p1;
const lastStep = { v: -1 };
const totp = async () => { let s = Math.floor(Date.now() / 30000); while (s === lastStep.v) { await new Promise((r) => setTimeout(r, 1000)); s = Math.floor(Date.now() / 30000); } lastStep.v = s; return generateCode(P1.totpSecret, s); };
const axe = async (page, label) => {
  await page.waitForTimeout(300);
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(bad, `axe serious/critical — ${label}`).toEqual([]);
};
const setIdentity = (email) => fetch(`${MOCK}/__identity`, { method: 'POST', body: JSON.stringify({ email }) });
async function ctx(browser, lang = 'fr', viewport = { width: 1280, height: 900 }, storageState = undefined) {
  const context = await browser.newContext({ viewport, ...(storageState ? { storageState } : {}), ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const external = []; context.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(u.host); });
  await context.addInitScript((l) => { try { localStorage.setItem('ada_lang', l); localStorage.setItem('ada_onboarding_done', '1'); localStorage.setItem('ada_cookie_consent', JSON.stringify({ necessary: true, analytics: false, date: new Date().toISOString() })); } catch { /* */ } }, lang);
  return { context, external };
}

test.describe.configure({ mode: 'serial' });

test('N09 fr desktop: ProConnect identifies, the ADA second factor is still asked, dashboard; logout goes through the federation', async ({ browser }) => {
  await setIdentity(P1.email);
  const { context, external } = await ctx(browser);
  const page = await context.newPage();
  await page.goto(`${BASE}/pro/login?next=/pro/dashboard`);
  const start = page.getByTestId('pro-proconnect-start');
  await expect(start).toBeVisible({ timeout: 30000 }); await expect(start).toHaveText('S’identifier avec ProConnect');
  await expect(page.getByRole('button', { name: /Se connecter/ })).toHaveCount(1);   // the password button is unchanged (launcher specs click it by name)
  await axe(page, 'sign-in with ProConnect available');
  await start.click();
  await page.waitForURL((u) => u.pathname === '/pro/login', { timeout: 30000 });
  const code = page.locator('#mfa-code');
  await expect(code, 'back from the federation: the ADA second factor, not a session').toBeVisible({ timeout: 30000 });
  expect(page.url()).not.toMatch(/token|code=|state=/);
  expect(await page.evaluate(() => localStorage.getItem('pro_token'))).toBeNull();
  await axe(page, 'MFA step after ProConnect');
  await code.fill(await totp()); await page.getByRole('button', { name: 'Vérifier' }).click();
  await page.waitForURL((u) => u.pathname === '/pro/dashboard', { timeout: 30000 });
  expect(await page.evaluate(() => localStorage.getItem('pro_login_via'))).toBe('proconnect');
  await page.getByRole('button', { name: 'Déconnexion' }).first().click();
  await page.waitForURL((u) => u.pathname === '/pro/login', { timeout: 30000 });
  expect(await page.evaluate(() => localStorage.getItem('pro_token'))).toBeNull();
  expect(external).toEqual([]);
  await context.close();
});

test('N09 fr: an identity without an invited ADA account — honest message, no account created, no session', async ({ browser }) => {
  await setIdentity(`inconnu-${crypto.randomBytes(3).toString('hex')}@example.test`);
  const { context } = await ctx(browser);
  const page = await context.newPage();
  await page.goto(`${BASE}/pro/login`);
  await page.getByTestId('pro-proconnect-start').click();
  const msg = page.getByTestId('pro-proconnect-message');
  await expect(msg).toContainText('Aucun compte professionnel actif ne correspond à cette identité', { timeout: 30000 });
  await expect(page.locator('#mfa-code')).toHaveCount(0);
  await axe(page, 'no account message');
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  try { expect((await c.query(`SELECT count(*)::int n FROM "ProUser" WHERE email LIKE 'inconnu-%'`)).rows[0].n).toBe(0); } finally { await c.end(); }
  await context.close();
});

for (const lang of ['ar', 'en', 'tr', 'de', 'uk']) {
  test(`N09 ${lang}${lang === 'ar' ? ' phone 375 px, right to left' : ''}: the ProConnect entry is translated and accessible`, async ({ browser }) => {
    const { context } = await ctx(browser, lang, lang === 'ar' ? { width: 375, height: 812 } : { width: 1280, height: 900 });
    const page = await context.newPage();
    await page.goto(`${BASE}/pro/login`);
    const start = page.getByTestId('pro-proconnect-start');
    await expect(start).toBeVisible({ timeout: 30000 });
    expect(await start.textContent()).not.toBe('S’identifier avec ProConnect');
    if (lang === 'ar') {
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
    await axe(page, `${lang} sign-in`);
    await context.close();
  });
}

test('R22 fr: the SIAO card — disconnected status; with the SIAO purpose the manual sheet is prepared; without it, refused', async ({ browser }) => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const ids = [`r46pw-siao-${crypto.randomBytes(4).toString('hex')}`, `r46pw-nosiao-${crypto.randomBytes(4).toString('hex')}`];
  try {
    for (const [i, id] of ids.entries()) {
      await c.query(`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount", "createdAt") VALUES ($1, NOW() + interval '2 days', $2, '{}'::jsonb, 0, NOW())`, [id, JSON.stringify({ zipCode: '67000', isUrgent: true })]);
      await c.query(`INSERT INTO "SharedDossierGrant" (id, "sharedDiagnosticId", "structureId", "grantedByProUserId", purposes, "createdAt") VALUES ($1, $2, $3, $4, $5, NOW())`,
        [crypto.randomUUID(), id, CREDS.structure.id, P1.id, i === 0 ? 'PURP-06,PURP-07' : 'PURP-06']);
    }
    const { context, external } = await ctx(browser);
    const page = await context.newPage();
    // the password sign-in of the real page (+ the second factor)
    await page.goto(`${BASE}/pro/login?next=/pro/dashboard`);
    await page.locator('#email').fill(P1.email); await page.locator('#password').fill(P1.password); await page.getByRole('button', { name: /Se connecter/ }).click();
    await page.locator('#mfa-code').fill(await totp()); await page.getByRole('button', { name: 'Vérifier' }).click();
    await page.waitForURL((u) => u.pathname === '/pro/dashboard', { timeout: 30000 });
    expect(await page.evaluate(() => localStorage.getItem('pro_login_via'))).toBeNull();
    await page.goto(`${BASE}/pro/dossier/${ids[0]}`);
    const card = page.getByTestId('pro-siao-card');
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('pro-siao-status')).toContainText('non connectée');
    await page.getByTestId('pro-siao-prepare').click();
    const sheet = page.getByTestId('pro-siao-sheet');
    await expect(sheet).toBeVisible({ timeout: 30000 });
    await expect(sheet).toContainText('67000'); await expect(sheet).toContainText(/ADA-SIAO-[0-9A-F]{12}/); await expect(sheet).not.toContainText(ids[0]);
    await axe(page, 'SIAO sheet');
    const audit = (await c.query(`SELECT details FROM "AuditLog" WHERE action = 'SIAO_HANDOVER_PREPARED' AND entity_id = $1`, [ids[0]])).rows;
    expect(audit).toHaveLength(1); expect(audit[0].details).toMatchObject({ purpose: 'PURP-07', transmissionStatus: 'NOT_TRANSMITTED' });
    await page.goto(`${BASE}/pro/dossier/${ids[1]}`);
    await expect(page.getByTestId('pro-siao-not-allowed')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('pro-siao-prepare')).toHaveCount(0);
    expect(external).toEqual([]);
    await context.close();
  } finally {
    for (const id of ids) { await c.query(`DELETE FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = $1`, [id]); await c.query(`DELETE FROM "ProCaseEvent" WHERE "caseId" IN (SELECT id FROM "ProCase" WHERE "sharedDiagnosticId" = $1)`, [id]); await c.query(`DELETE FROM "ProCase" WHERE "sharedDiagnosticId" = $1`, [id]); await c.query(`DELETE FROM "SharedDiagnostic" WHERE id = $1`, [id]).catch(() => {}); }
    await c.end();
  }
});

const SWEEP = ['/pro/dashboard', '/pro/dossiers', '/pro/orientations', '/pro/selections', '/pro/messages', '/pro/team', '/pro/audit', '/pro/reports', '/pro/structure', '/pro/regional', '/pro/rdv/agenda'];
for (const lang of ['fr', 'en', 'ar']) {
  test(`R03–R20 ${lang}: the professional console of a structure administrator — every page answers without a server error or a page error, axe 0 serious`, async ({ browser }) => {
    test.setTimeout(240000);
    const A = CREDS.pros.admin;
    // one real sign-in of the administrator (the sign-in route is rate-limited per address), its session reused by the three languages
    const { context, external } = await ctx(browser, lang, undefined, adminState.v);
    const page = await context.newPage();
    const errors = []; const api5xx = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => { if (new URL(r.url()).pathname.startsWith('/api/') && r.status() >= 500) api5xx.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    if (!adminState.v) {
      await page.goto(`${BASE}/pro/login?next=/pro/dashboard`);
      await page.locator('#email').fill(A.email); await page.locator('#password').fill(A.password);
      await page.locator('form button[type="submit"]').first().click();
      await page.locator('#mfa-code').fill(generateCode(A.totpSecret, Math.floor(Date.now() / 30000))); await page.locator('form button[type="submit"]').first().click();
      await page.waitForURL((u) => u.pathname === '/pro/dashboard', { timeout: 30000 });
      adminState.v = await context.storageState();
    }
    for (const p of SWEEP) {
      await page.goto(BASE + p); await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await expect(page.locator('main').first()).toBeVisible({ timeout: 30000 });
      if (lang === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await axe(page, `${lang} ${p}`);
    }
    expect(errors, 'page errors').toEqual([]); expect(api5xx, 'API 5xx').toEqual([]); expect(external).toEqual([]);
    await context.close();
  });
}
const adminState = { v: null };
